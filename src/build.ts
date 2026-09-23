import type { CleanEntry, CleanVolume } from "./cleanse.ts";
import type { SkkDict } from "./resources.ts";

/**
 * クレンジング結果から SKK 辞書を作る。
 *
 * - SKK-JISYO.dainihonkokugojisyo: 検証済み（L・JMdict・Unihan で読みと表記が確かめられた）のエントリ
 * - SKK-JISYO.dainihonkokugojisyo.noL: 上から SKK-JISYO.L にある候補を除いたもの
 * - SKK-JISYO.dainihonkokugojisyo.unverified: 検証できなかったエントリ（誤りの見積もり用）
 */

/** 候補の注釈: 歴史的仮名遣いの読み（現代の読みと同じなら ""）→ 品詞 */
type Notes = Map<string, Set<string>>;

/** 見出し → 候補 → 注釈 */
type Dict = {
  ari: Map<string, Map<string, Notes>>;
  nasi: Map<string, Map<string, Notes>>;
};

const skeleton = (w: string) => w.replaceAll(/[ぁ-ゖァ-ヺー]/g, "");

const POS_LABELS: Record<string, string> = {
  noun: "名",
  pronoun: "代",
  numeral: "数",
  adjective: "形",
  adverb: "副",
  makura: "枕",
  interjection: "感",
  conjunction: "接",
  prefix: "接頭",
  suffix: "接尾",
};

function posLabel(e: CleanEntry): string {
  return e.pos.categories.map((c) => {
    if (c === "verb") return /^(自動|他動)/.exec(e.pos.raw)?.[0] ?? "動";
    return POS_LABELS[c] ?? "";
  }).filter(Boolean).join("・");
}

/** 現代の読みと違う場合の歴史的仮名遣いの読み */
const historicalOf = (e: CleanEntry) => {
  const h = e.reading.replaceAll("-", "");
  return h !== e.modern ? h : "";
};

/**
 * 候補の注釈。現代の読みと違う場合は底本の歴史的仮名遣いの読みを、続けて品詞を付ける
 * （ちょうちょう /蝶蝶;てふてふ（名）/、あしば /足場;（名）/）。
 * 同じ候補が複数の項目から来た場合は、読みごとに品詞をまとめる（あふぐ（自動・他動））
 */
export function renderNotes(notes: Notes): string {
  return [...notes].map(([h, labels]) => {
    const l = [...labels].filter(Boolean).join("・");
    return h + (l ? `（${l}）` : "");
  }).filter(Boolean).join("、");
}

export const annotation = (e: CleanEntry) =>
  renderNotes(new Map([[historicalOf(e), new Set([posLabel(e)])]]));

function addEntry(dict: Dict, e: CleanEntry) {
  if (!e.skkKey || !e.shinjitai || !e.notation) return;
  const map = e.okuri ? dict.ari : dict.nasi;
  const historical = historicalOf(e);
  const label = posLabel(e);
  for (const key of [e.skkKey, ...(e.altSkkKeys ?? [])]) {
    const words = map.get(key) ?? new Map<string, Notes>();
    for (const w of [e.shinjitai, e.notation]) {
      const notes = words.get(w) ?? new Map<string, Set<string>>();
      const labels = notes.get(historical) ?? new Set<string>();
      labels.add(label);
      notes.set(historical, labels);
      words.set(w, notes);
    }
    map.set(key, words);
  }
}

function inL(L: SkkDict, key: string, word: string, okuri: boolean): boolean {
  const words = (okuri ? L.okuriAri : L.okuriNasi).get(key) ?? [];
  return words.some((w) => w === word || (!okuri && skeleton(w) === word));
}

function withoutL(dict: Dict, L: SkkDict): Dict {
  const filter = (map: Dict["ari"], okuri: boolean): Dict["ari"] =>
    new Map(
      [...map]
        .map(([k, ws]) => [k, new Map([...ws].filter(([w]) => !inL(L, k, w, okuri)))] as const)
        .filter(([, ws]) => ws.size > 0),
    );
  return { ari: filter(dict.ari, true), nasi: filter(dict.nasi, false) };
}

const HEADER = (title: string, description: string, count: number) =>
  `;; -*- mode: fundamental; coding: utf-8 -*-
;; ${title}
;; ${description}
;;
;; 大日本国語辞典（上田万年・松井簡治 著、金港堂書籍、1915-1919）を元に作成した SKK 辞書（ベータ版）。
;; OCR の誤りを含む。
;;
;; 底本: 国立国会図書館デジタルコレクション info:ndljp/pid/954645, 954646, 954647, 954648
;;   （保護期間満了 / Public Domain Mark）
;; テキスト: NDLOCR-Lite（国立国会図書館, CC BY 4.0）による OCR 結果、
;;   国立国会図書館「次世代デジタルライブラリー」全文テキスト
;; 照合・補正と除外に SKK-JISYO.L（SKK Development Team, GPL-2.0-or-later）を使用。
;; 照合・補正に JMdict（Electronic Dictionary Research and Development Group, CC BY-SA 4.0）を使用。
;;   This publication has included material from the JMdict (EDICT, etc.) dictionary files
;;   in accordance with the licence provisions of the Electronic Dictionaries Research Group.
;;   https://www.edrdg.org/edrdg/licence.html
;; 照合・字体の変換に Unihan Database（Copyright © 1991-2026 Unicode, Inc., Unicode License v3）を使用。
;; 各データの権利表示とライセンスの全文は、配布元の NOTICE と LICENSES/ を参照。
;;   https://github.com/tett23/SKK-JISYO.dainihonkokugojisyo
;; 本辞書は上記を元に加工したものであり、原著者および国立国会図書館が作成したものではない。
;;
;; This dictionary is free software; you can redistribute it and/or modify it under the
;; terms of the GNU General Public License as published by the Free Software Foundation;
;; either version 3, or (at your option) any later version.
;;
;; Generated: ${new Date().toISOString()}  Entries: ${count}
;;
`;

export function renderDict(dict: Dict, title: string, description: string): string {
  const line = ([k, ws]: [string, Map<string, Notes>]) =>
    `${k} /${
      [...ws].map(([w, notes]) => {
        const n = renderNotes(notes);
        return n ? `${w};${n}` : w;
      }).join("/")
    }/`;
  // SKK の慣習: 送りありは降順、送りなしは昇順
  const ari = [...dict.ari].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0)).map(line);
  const nasi = [...dict.nasi].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(line);
  return HEADER(title, description, ari.length + nasi.length) +
    ";; okuri-ari entries.\n" + ari.join("\n") + (ari.length ? "\n" : "") +
    ";; okuri-nasi entries.\n" + nasi.join("\n") + "\n";
}

export function buildDicts(volumes: CleanVolume[], L: SkkDict) {
  const verified: Dict = { ari: new Map(), nasi: new Map() };
  const unverified: Dict = { ari: new Map(), nasi: new Map() };
  for (const v of volumes) {
    for (const e of v.entries) {
      if (e.status === "accepted") addEntry(verified, e);
      else if (e.status === "unverified") addEntry(unverified, e);
    }
  }
  return { verified, noL: withoutL(verified, L), unverified };
}

const iiifCrop = (pid: string, e: CleanEntry) => {
  const pad = 20;
  const x = Math.max(0, e.bbox.x - pad);
  const y = Math.max(0, e.bbox.y - pad);
  return `https://dl.ndl.go.jp/api/iiif/${pid}/R${String(e.frame).padStart(7, "0")}/${x},${y},${
    e.bbox.width + pad * 2
  },${Math.min(e.bbox.height, 400) + pad * 2}/full/0/default.jpg`;
};

export function renderTsv(volumes: CleanVolume[]): string {
  const cols = [
    "id",
    "status",
    "method",
    "reason",
    "skk_key",
    "shinjitai",
    "notation",
    "reading",
    "modern",
    "pos",
    "order",
    "ndl_agree",
    "fixes",
    "suggestions",
    "line",
    "image",
  ];
  const rows = volumes.flatMap((v) =>
    v.entries.map((e) =>
      [
        e.id,
        e.status,
        e.method,
        e.reason ?? "",
        e.skkKey ?? "",
        e.shinjitai ?? "",
        e.notation ?? "",
        e.reading,
        e.modern ?? "",
        e.pos.raw,
        e.order,
        e.ndl ? String(e.ndl.agree) : "",
        e.fixes.map((f) => `${f.field}:${f.from}→${f.to}(${f.reason})`).join("; "),
        e.suggestions.map((f) => `${f.field}:${f.from}→${f.to}(${f.reason})`).join("; "),
        e.source.line,
        iiifCrop(v.pid, e),
      ].map((s) => s.replaceAll(/[\t\n]/g, " ")).join("\t")
    )
  );
  return [cols.join("\t"), ...rows].join("\n") + "\n";
}

function count<T>(xs: T[], f: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[f(x)] = (out[f(x)] ?? 0) + 1;
  return out;
}

export function renderReport(
  volumes: CleanVolume[],
  dicts: ReturnType<typeof buildDicts>,
): string {
  const all = volumes.flatMap((v) => v.entries);
  const table = (title: string, rec: Record<string, number>) =>
    `### ${title}\n\n| 値 | 件数 | 割合 |\n| --- | ---: | ---: |\n` +
    Object.entries(rec).sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `| ${k} | ${n} | ${(n / all.length * 100).toFixed(1)}% |`).join("\n") +
    "\n";
  const size = (d: Dict) => {
    const words = [...d.ari.values(), ...d.nasi.values()].reduce((s, w) => s + w.size, 0);
    return `送りあり ${d.ari.size} 見出し / 送りなし ${d.nasi.size} 見出し / 候補 ${words}`;
  };
  return `# ビルドレポート

生成日時: ${new Date().toISOString()}

対象: ${volumes.map((v) => v.pid).join(", ")}（候補 ${all.length} 件）

## 辞書

- SKK-JISYO.dainihonkokugojisyo: ${size(dicts.verified)}
- SKK-JISYO.dainihonkokugojisyo.noL: ${size(dicts.noL)}
- SKK-JISYO.dainihonkokugojisyo.unverified: ${size(dicts.unverified)}

## 候補の内訳

${table("状態", count(all, (e) => e.status))}
${table("検証方法（accepted の根拠）", count(all, (e) => e.method))}
${table("除外理由", count(all.filter((e) => e.status === "excluded"), (e) => e.reason ?? ""))}
${table("品詞", count(all, (e) => e.pos.category))}
${table("五十音順", count(all, (e) => e.order))}
${table("NDL 側 OCR との一致", count(all, (e) => (e.ndl ? String(e.ndl.agree) : "対応なし")))}
${table("補正の種類", count(all.flatMap((e) => e.fixes), (f) => `${f.field}: ${f.reason}`))}
${
    table(
      "適用しなかった補正の提案",
      count(all.flatMap((e) => e.suggestions), (f) => `${f.field}: ${f.reason}`),
    )
  }
`;
}
