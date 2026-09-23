import { alignReading } from "./align.ts";
import type { BBox, Candidate, ExtractVolume } from "./extract.ts";
import type { NdlCandidate } from "./extract_ndl.ts";
import type { RecheckResult } from "./recheck.ts";
import {
  collationKey,
  dictionaryForms,
  levenshtein,
  modernVariants,
  okuriChars,
  semiVoiced,
  voiced,
} from "./kana.ts";
import { normalizePos, type Pos } from "./pos.ts";
import type { SkkDict, Unihan } from "./resources.ts";
import { isAdjectivePos, isVerbPos, type Jmdict, type JmForm } from "./jmdict.ts";

/**
 * docs/cleansing.md の段階（正規化、二系統の突き合わせ、五十音順の検査、SKK-JISYO.L との照合、
 * 読みと表記の整合、現代仮名遣いへの変換、字体）を候補ごとに行う。
 */

export type Method =
  /** SKK-JISYO.L に同じ読み・表記がある */
  | "L"
  /** JMdict に同じ読み・表記がある（L には無い） */
  | "JMdict"
  /** L・JMdict の同じ表記の読みに合わせて読みを補正した */
  | "dict-reading"
  /** L の同じ読みの表記に合わせた表記の補正を提案した（適用はしない） */
  | "L-notation"
  /** Unihan の音訓で読みと表記が対応した */
  | "align"
  | "none";

export type Fix = {
  field: "reading" | "notation" | "modern";
  from: string;
  to: string;
  reason: string;
};

export type Status = "accepted" | "unverified" | "excluded";

export type CleanEntry = {
  id: string;
  frame: number;
  bbox: BBox;
  source: { reading: string; notation?: string; pos: string; line: string };
  /** 歴史的仮名遣いの読み（補正後） */
  reading: string;
  /** 底本の字体の表記（補正後） */
  notation?: string;
  /** 新字体の表記 */
  shinjitai?: string;
  pos: Pos;
  kango: boolean;
  /** 現代仮名遣いの読み（動詞・形容詞は現代語の辞書形） */
  modern?: string;
  /** SKK の見出し。送りありは "おどろかs" の形 */
  skkKey?: string;
  /**
   * 追加の見出し。読みを L・JMdict に合わせて補正した候補（dict-reading）には、補正前の読み
   * （底本の読みを現代仮名遣いにしたもの）も見出しとして出す。補正が底本の正しい別の読み
   * （はんにゃ-の-めん → はんにゃめん）を書き換えることがあるため
   */
  altSkkKeys?: string[];
  okuri?: boolean;
  ndl?: { reading: string; notation?: string; agree: boolean };
  order: "ok" | "outlier";
  method: Method;
  status: Status;
  reason?: string;
  fixes: Fix[];
  /** 適用しなかった補正の提案 */
  suggestions: Fix[];
};

export type CleanVolume = {
  schemaVersion: 1;
  pid: string;
  generatedAt: string;
  entries: CleanEntry[];
};

export type Context = {
  L: SkkDict;
  unihan: Unihan;
  skeletonReadings: Map<string, string[]>;
  jm?: Jmdict;
};

const HAN_RE = /[\p{Script=Han}々〆ヶ〻]/u;
const KANA_RE = /[ぁ-ゖァ-ヺ]/;
const skeleton = (w: string) => w.replaceAll(/[ぁ-ゖァ-ヺー]/g, "");

export function buildContext(L: SkkDict, unihan: Unihan, jm?: Jmdict): Context {
  const skeletonReadings = new Map<string, string[]>();
  for (const [reading, words] of L.okuriNasi) {
    for (const w of words) {
      const s = skeleton(w);
      if (!s || !HAN_RE.test(s)) continue;
      const list = skeletonReadings.get(s);
      if (list) list.includes(reading) || list.push(reading);
      else skeletonReadings.set(s, [reading]);
    }
  }
  return { L, unihan, skeletonReadings, jm };
}

export function toShinjitai(s: string, unihan: Unihan): string {
  return [...s].map((c) => unihan.newVariant.get(c) ?? c).join("");
}

// --- 1. 正規化

function normalizeReading(r: string): string {
  return r.replaceAll(/[・=＝‐－]/g, "-").replaceAll(/-+/g, "-").replace(/^-|-$/g, "");
}

/** 表記の前後に残った記号を除く。途中に漢字・かな以外が残るものは不正とする */
function normalizeNotation(n: string | undefined): { notation?: string; bad: boolean } {
  if (!n) return { bad: false };
  const trimmed = n.replace(/^[^\p{Script=Han}々〆ヶ]+/u, "").replace(
    /[^\p{Script=Han}々〆ヶぁ-ゖ]+$/u,
    "",
  );
  if (!trimmed) return { bad: true };
  const bad = /[^\p{Script=Han}々〆ヶ〻ぁ-ゖ]/u.test(trimmed);
  return { notation: trimmed, bad };
}

// --- 3. 五十音順

const ORDER_WINDOW = 6;
const ORDER_MAX_VIOLATIONS = 3;

/**
 * 五十音順から外れた候補を判定する。前後 ORDER_WINDOW 件と比べて順序が逆になっている相手が
 * ORDER_MAX_VIOLATIONS 件を超えるものを外れとする。
 * 同じ誤読（き→さ など）が続くと誤った候補同士が正しい順に並ぶので、全体の最長増加部分列では判定しない。
 */
export function orderOutliers(keys: string[]): boolean[] {
  return keys.map((k, i) => {
    let violations = 0;
    for (let j = Math.max(0, i - ORDER_WINDOW); j < i; j++) if (keys[j] > k) violations++;
    for (let j = i + 1; j <= Math.min(keys.length - 1, i + ORDER_WINDOW); j++) {
      if (keys[j] < k) violations++;
    }
    return violations > ORDER_MAX_VIOLATIONS;
  });
}

/** 前後の候補から、その位置に入るべき読みの範囲（前後それぞれの中央値）を求める */
function orderBounds(keys: string[], i: number): [string, string] {
  const med = (xs: string[]) => [...xs].sort()[Math.floor(xs.length / 2)];
  const before = keys.slice(Math.max(0, i - ORDER_WINDOW), i);
  const after = keys.slice(i + 1, i + 1 + ORDER_WINDOW);
  return [before.length ? med(before) : "", after.length ? med(after) : "\uffff"];
}

/** OCR で取り違えやすいかな */
const CONFUSABLE: string[] = [
  "あのめおわぬ",
  "いりこ",
  // ろ・る は古い語形と現代の語形の違い（わろし / わるし）になりやすいので入れない
  "うらちつ",
  "しくつ",
  "さきち",
  "はほけにば",
  "たなだ",
  "てそで",
  "ひびぴん",
  "まもよ",
  "ねれわ",
  "すおず",
  "かやが",
];

/**
 * この辞書の OCR（ndlocr-lite と NDL 側 OCR の両方）で特に頻繁な字形の取り違え。
 * 二系統の OCR が同じ読みを出していても、この取り違えは両方に起きる
 */
const SYSTEMATIC_CONFUSABLE: string[] = ["うらつ", "きさ", "あのめ"];

function confusables(c: string, groups: string[] = CONFUSABLE): string[] {
  const out = new Set<string>();
  for (const g of groups) if (g.includes(c)) { for (const x of g) out.add(x); }
  for (const v of [voiced(c), semiVoiced(c)]) if (v) out.add(v);
  const plain = c.normalize("NFD")[0];
  if (plain !== c) out.add(plain);
  out.delete(c);
  return [...out];
}

/**
 * 読みの 1 文字を取り違えやすいかなに置き換えた案。区切り "-" が「し」「ら」に化けたものは
 * 区切りに戻す案も出す（おほしぶさ → おほ-ぶさ）
 */
function repairAlternatives(reading: string, groups: string[] = CONFUSABLE): string[] {
  const chars = [...reading];
  const out = new Set<string>();
  chars.forEach((ch, i) => {
    if (ch === "-") return;
    const at = (c: string) => [...chars.slice(0, i), c, ...chars.slice(i + 1)].join("");
    for (const c of confusables(ch, groups)) out.add(at(c));
    if ((ch === "し" || ch === "ら") && i > 0 && i < chars.length - 1) out.add(at("-"));
  });
  out.delete(reading);
  return [...out];
}

/** 前後の候補の間に収まるように、先頭 2 文字のうち 1 文字を置き換えた読みを返す */
function orderAlternatives(reading: string, lo: string, hi: string): string[] {
  const out: string[] = [];
  const chars = [...reading];
  for (let i = 0; i < Math.min(2, chars.length); i++) {
    for (const c of confusables(chars[i])) {
      const alt = [...chars.slice(0, i), c, ...chars.slice(i + 1)].join("");
      const k = collationKey(alt);
      if (lo <= k && k <= hi) out.push(alt);
    }
  }
  return out;
}

// --- 4. SKK-JISYO.L との照合、5. 読みと表記の整合

type Resolved = {
  modern: string;
  skkKey: string;
  okuri: boolean;
  method: Method;
  notation: string;
  fix?: Fix;
};

const OKURI_CATEGORIES = new Set(["verb", "adjective"]);

/**
 * SKK の送り仮名として妥当か。1 文字のほかは、一段動詞の「え段・い段 + る」（消える = き|える）と
 * 形容詞の「しい」に限る（聞かす を 聞く の「きk」に当てないため）
 */
function validOkuri(okuri: string, category: string): boolean {
  if (okuri.length === 1) return true;
  if (category === "verb") {
    return okuri.length === 2 &&
      /^[えけげせぜてでねへべぺめれいきぎしじちぢにひびぴみり]る$/.test(okuri);
  }
  if (category === "adjective") return okuri === "しい";
  return false;
}

function notationForms(n: string, ctx: Context): string[] {
  return [...new Set([n, toShinjitai(n, ctx.unihan)])];
}

function matchL(reading: string, notation: string, pos: Pos, kango: boolean, ctx: Context) {
  const forms = notationForms(notation, ctx);
  const variants = modernVariants(reading, { kango });
  if (!OKURI_CATEGORIES.has(pos.category)) {
    for (const v of variants) {
      const words = ctx.L.okuriNasi.get(v);
      if (words?.some((w) => forms.includes(w) || forms.includes(skeleton(w)))) {
        return { modern: v, skkKey: v, okuri: false };
      }
    }
    return undefined;
  }
  for (const v of variants) {
    for (const f of dictionaryForms(v, pos.category)) {
      // 送り仮名が短い分け方から試す
      for (let k = f.length - 1; k >= 1; k--) {
        const okuri = f.slice(k);
        if (!validOkuri(okuri, pos.category)) continue;
        for (const oc of okuriChars(okuri)) {
          const key = f.slice(0, k) + oc;
          if (ctx.L.okuriAri.get(key)?.some((w) => forms.includes(w))) {
            return { modern: f, skkKey: key, okuri: true };
          }
        }
      }
    }
  }
  return undefined;
}

/** 漢字で始まり、漢字と送り仮名（ひらがな）だけからなる JMdict の表記（いい聞かす、かじか蛙 などを除く） */
const JM_FORM_RE = /^[\p{Script=Han}々〆ヶ][\p{Script=Han}々〆ヶぁ-ゖ]*$/u;

function jmForms(notation: string, ctx: Context): JmForm[] {
  if (!ctx.jm) return [];
  return notationForms(notation, ctx).flatMap((f) => ctx.jm!.bySkeleton.get(f) ?? [])
    .filter((f) => JM_FORM_RE.test(f.kanji));
}

/**
 * JMdict で照合する。名詞などは同じ漢字の並びの表記に同じ読みがあれば一致とする。
 * 古い仮名遣いの読み（&ok;）に歴史的仮名遣いの読みが一致すれば、同じ表記の現代の読みを使う。
 * 動詞・形容詞は JMdict の表記の送り仮名から SKK の送りありの見出しを作る（驚かす → おどろk）。
 */
function matchJM(reading: string, notation: string, pos: Pos, kango: boolean, ctx: Context) {
  const forms = jmForms(notation, ctx);
  if (forms.length === 0) return undefined;
  const variants = modernVariants(reading, { kango });
  const historical = plain(reading);
  if (!OKURI_CATEGORIES.has(pos.category)) {
    for (const v of variants) {
      if (forms.some((f) => f.readings.some((r) => !r.old && r.reading === v))) {
        const inL = ctx.L.okuriNasi.get(v)?.some((w) =>
          notationForms(notation, ctx).includes(skeleton(w))
        ) ?? false;
        return { modern: v, skkKey: v, okuri: false, inL };
      }
    }
    // JMdict の「古い読み」（&ok;）は旧仮名遣いに限らず、今は使われない読み全般に付く。
    // 歴史的仮名遣いとして現代仮名遣いと表記が違う読み（てふてふ など）のときだけ、
    // 同じ表記の現代の読みに置き換える（のばら → のいばら のような書き換えを避ける）
    if (variants[0] !== historical) {
      for (const f of forms) {
        const modern = f.readings.filter((r) => !r.old).map((r) => r.reading);
        if (f.readings.some((r) => r.old && r.reading === historical) && modern[0]) {
          return { modern: modern[0], skkKey: modern[0], okuri: false, inL: false };
        }
      }
    }
    return undefined;
  }
  const wanted = new Set(variants.flatMap((v) => dictionaryForms(v, pos.category)));
  const isPos = pos.category === "verb" ? isVerbPos : isAdjectivePos;
  const kanjiForms = notationForms(notation, ctx);
  for (const f of forms) {
    if (!f.pos.some(isPos)) continue;
    const okuri = f.kanji.match(/[ぁ-ゖ]+$/)?.[0];
    if (!okuri) continue;
    for (const r of f.readings) {
      if (r.old || !wanted.has(r.reading) || !r.reading.endsWith(okuri)) continue;
      const stem = r.reading.slice(0, r.reading.length - okuri.length);
      if (!stem) continue;
      const chars = okuriChars(okuri);
      const inLChar = chars.find((c) =>
        ctx.L.okuriAri.get(stem + c)?.some((w) => kanjiForms.includes(w))
      );
      return {
        modern: r.reading,
        skkKey: stem + (inLChar ?? chars[0]),
        okuri: true,
        inL: !!inLChar,
      };
    }
  }
  return undefined;
}

function matchAlign(reading: string, notation: string, pos: Pos, kango: boolean, ctx: Context) {
  if (OKURI_CATEGORIES.has(pos.category)) return undefined;
  for (const v of modernVariants(reading, { kango })) {
    // 表記の後ろに余った読み（省かれた送り仮名）は、表記が 1 文字の場合（おそ-さ 遲）だけ 1 文字許す。
    // 2 文字以上では許さない（ぎ-すら 擬數 のような誤読を通さないため）
    const maxTrailing = [...notation].length === 1 ? 1 : 0;
    // Unihan は旧字体（淨、隱）に訓読みを持たないことが多いので、新字体の表記でも試す
    if (
      notationForms(notation, ctx).some((n) => alignReading(n, v, ctx.unihan, { maxTrailing }))
    ) {
      return { modern: v, skkKey: v, okuri: false };
    }
  }
  return undefined;
}

/** L・JMdict にある同じ表記の読みのうち、編集距離が小さいものが 1 つだけならそれに補正する */
function fixReadingByDict(
  reading: string,
  notation: string,
  pos: Pos,
  kango: boolean,
  ctx: Context,
) {
  if (OKURI_CATEGORIES.has(pos.category)) return undefined;
  const candidates = new Set<string>();
  for (const f of notationForms(notation, ctx)) {
    for (const r of ctx.L.readingsOf.get(f) ?? []) candidates.add(r);
    for (const r of ctx.skeletonReadings.get(f) ?? []) candidates.add(r);
  }
  for (const f of jmForms(notation, ctx)) {
    for (const r of f.readings) if (!r.old) candidates.add(r.reading);
  }
  const variants = modernVariants(reading, { kango });
  const scored = [...candidates].map((r) => ({
    r,
    d: Math.min(...variants.map((v) => levenshtein(v, r))),
  }));
  // 補正は、同じ長さでの置き換え（OCR の誤読）か、語頭の脱落の補い（くでん → がくでん）に限る。
  // 末尾や途中での増減は、底本の別の語形（ききぐるし-さ → ききぐるしい）を書き換えてしまう
  const plausible = (r: string) =>
    variants.some((v) =>
      // 語末の文字の置き換えは、底本の別の語形（にぎにぎし-さ → にぎにぎしい）を書き換えるので認めない
      (r.length === v.length && levenshtein(v, r) <= 2 && r.at(-1) === v.at(-1)) ||
      (r.length > v.length && r.length - v.length <= 2 && r.endsWith(v) && v.length >= 2)
    );
  const ok = scored.filter(({ r, d }) =>
    plausible(r) && ((d === 1 && r.length >= 3) || (d === 2 && r.length >= 6))
  );
  if (ok.length !== 1) return undefined;
  return { modern: ok[0].r, from: variants[0] };
}

/** L の同じ読みの表記のうち、1 文字だけ違うものが 1 つだけならそれに補正する */
function fixNotationByL(reading: string, notation: string, pos: Pos, kango: boolean, ctx: Context) {
  if (OKURI_CATEGORIES.has(pos.category)) return undefined;
  const shin = [...toShinjitai(notation, ctx.unihan)];
  if (shin.length < 2) return undefined;
  for (const v of modernVariants(reading, { kango })) {
    const words = (ctx.L.okuriNasi.get(v) ?? []).filter((w) => [...w].length === shin.length);
    const near = words.filter((w) => [...w].filter((c, i) => c !== shin[i]).length === 1);
    if (near.length === 1 && HAN_RE.test(near[0]) && !KANA_RE.test(near[0])) {
      return { modern: v, notation: near[0] };
    }
    if (near.length > 1) return undefined;
  }
  return undefined;
}

type Option = {
  reading: string;
  notation: string;
  reason?: string;
  /** Unihan での対応付けでは採用しない（L・JMdict との一致だけで採用する） */
  noAlign?: boolean;
};

/**
 * 候補を検証する。L との完全一致、Unihan での対応付けの順に試し、どちらも通らなければ
 * OCR の誤りを示す根拠（suspicious）がある場合に限り、L を使って読み・表記を補正する。
 * 根拠なしに補正すると、正しい古語（あまだり、あさい など）を現代語に書き換えてしまうため。
 */
function resolve(
  options: Option[],
  pos: Pos,
  kango: boolean,
  suspicious: boolean,
  outlier: boolean,
  ctx: Context,
  /** NDL 側 OCR の読み（ndlocr-lite とは別のエンジン。あれば） */
  readingB?: string,
): Resolved | undefined {
  const withFix = (o: Option, base: Option): Fix | undefined =>
    o.reading !== base.reading
      ? { field: "reading", from: base.reading, to: o.reading, reason: o.reason ?? "" }
      : o.notation !== base.notation
      ? { field: "notation", from: base.notation, to: o.notation, reason: o.reason ?? "" }
      : undefined;
  const base = options[0];
  const okuri = OKURI_CATEGORIES.has(pos.category);
  // 動詞・形容詞は JMdict の送り仮名から見出しを作れるので、JMdict を先に引く
  if (okuri) {
    for (const o of options) {
      const m = matchJM(o.reading, o.notation, pos, kango, ctx);
      if (m) {
        return {
          ...m,
          method: m.inL ? "L" : "JMdict",
          notation: o.notation,
          fix: withFix(o, base),
        };
      }
    }
  }
  for (const o of options) {
    const m = matchL(o.reading, o.notation, pos, kango, ctx);
    if (m) return { ...m, method: "L", notation: o.notation, fix: withFix(o, base) };
  }
  if (!okuri) {
    for (const o of options) {
      const m = matchJM(o.reading, o.notation, pos, kango, ctx);
      if (m) return { ...m, method: "JMdict", notation: o.notation, fix: withFix(o, base) };
    }
  }
  for (const o of options) {
    // 五十音順から外れた候補は、元の読みのまま Unihan で対応付けられても採用しない
    // （語頭が落ちた読みが漢字の訓の一部と偶然一致することがある）
    if ((outlier && o === base) || o.noAlign) continue;
    const m = matchAlign(o.reading, o.notation, pos, kango, ctx);
    if (m) return { ...m, method: "align", notation: o.notation, fix: withFix(o, base) };
  }
  if (!suspicious) return undefined;
  // NDL 側 OCR（別のエンジン）の読みが元の読みと一致するなら、底本の語形である可能性が高い。
  // この場合、辞書に合わせた書き換えは、両方の OCR に共通する頻繁な字形の取り違え
  // （う/ら/つ、き/さ、あ/の/め、濁点）の修復だけにし、読みの補正はしない
  // （底本の古い語形を現代の語形に書き換えないため）
  const confirmedOriginal = readingB !== undefined && plain(readingB) === plain(base.reading);
  // 読みの 1 文字の取り違えを直して L・JMdict と完全に一致するなら採用する
  const groups = confirmedOriginal ? SYSTEMATIC_CONFUSABLE : CONFUSABLE;
  for (const reading of repairAlternatives(base.reading, groups)) {
    const l = matchL(reading, base.notation, pos, kango, ctx);
    const m = l ?? matchJM(reading, base.notation, pos, kango, ctx);
    if (m) {
      return {
        ...m,
        method: l ? "L" : "JMdict",
        notation: base.notation,
        fix: {
          field: "reading",
          from: base.reading,
          to: reading,
          reason: l
            ? "取り違えやすいかなを直すと SKK-JISYO.L と一致"
            : "取り違えやすいかなを直すと JMdict と一致",
        },
      };
    }
  }
  if (confirmedOriginal) return undefined;
  const r = fixReadingByDict(base.reading, base.notation, pos, kango, ctx);
  if (r) {
    return {
      modern: r.modern,
      skkKey: r.modern,
      okuri: false,
      method: "dict-reading",
      notation: base.notation,
      fix: {
        field: "modern",
        from: r.from,
        to: r.modern,
        reason: "SKK-JISYO.L・JMdict の同じ表記の読み",
      },
    };
  }
  const n = fixNotationByL(base.reading, base.notation, pos, kango, ctx);
  if (n) {
    return {
      modern: n.modern,
      skkKey: n.modern,
      okuri: false,
      method: "L-notation",
      notation: n.notation,
      fix: {
        field: "notation",
        from: base.notation,
        to: n.notation,
        reason: "SKK-JISYO.L の同じ読みの表記",
      },
    };
  }
  return undefined;
}

// --- 全体

/** 助詞・助動詞は変換辞書には不要なので除く（枕詞は表記のまま含める） */
const EXCLUDED_CATEGORIES = new Set(["particle", "auxiliary"]);

function findNdl(c: Candidate, ndl: NdlCandidate[] | undefined): NdlCandidate | undefined {
  return ndl?.filter((n) => Math.abs(n.x - c.bbox.x) <= 40 && Math.abs(n.y - c.bbox.y) <= 60)
    .sort((a, b) => Math.abs(a.x - c.bbox.x) - Math.abs(b.x - c.bbox.x))[0];
}

const plain = (r: string) => r.replaceAll("-", "");

const bareKana = (c: string) => c.normalize("NFD")[0];

/**
 * 濁点・半濁点の読み分け。系統ごとの読みが濁点・半濁点だけで割れている箇所について、
 * 観測された読みの組み合わせのうち L・JMdict に同じ表記で載るものがちょうど 1 つなら、
 * それに合わせる。濁点の有無だけの違いなので、底本の語形を現代の語形に書き換えることはない。
 * 決まらず、Unihan での対応付けや読みの補正でしか検証できていない候補は未検証にする
 * （抜き取りでは、この場合の誤りが約 13% あった）。
 */
function resolveVoicing(e: CleanEntry, sources: (string | undefined)[], ctx: Context) {
  const current = [...plain(e.reading)];
  const srcs = sources.filter((s): s is string => !!s).map((s) => [...plain(s)])
    .filter((s) => s.length === current.length);
  const positions = current.flatMap((c, i) => {
    const seen = new Set([c, ...srcs.map((s) => s[i])]);
    return seen.size > 1 && new Set([...seen].map(bareKana)).size === 1 ? [[i, [...seen]]] : [];
  }) as [number, string[]][];
  if (positions.length === 0 || positions.length > 4) return;

  // 組み合わせを作り、区切り "-" の位置を保ったまま読みに戻す
  let combos: string[][] = [current];
  for (const [i, alts] of positions) {
    combos = combos.flatMap((c) => alts.map((a) => c.map((x, k) => (k === i ? a : x))));
  }
  const withHyphen = (chars: string[]) => {
    let k = 0;
    return [...e.reading].map((c) => (c === "-" ? "-" : chars[k++])).join("");
  };
  const matches = combos.map(withHyphen).flatMap((reading) => {
    const m = matchL(reading, e.notation!, e.pos, e.kango, ctx) ??
      matchJM(reading, e.notation!, e.pos, e.kango, ctx);
    return m ? [{ reading, m, inL: !!matchL(reading, e.notation!, e.pos, e.kango, ctx) }] : [];
  });
  const self = matches.find((x) => x.reading === e.reading);
  if (matches.length === 1 && !self) {
    const [{ reading, m, inL }] = matches;
    e.fixes.push({
      field: "reading",
      from: e.reading,
      to: reading,
      reason: "濁点・半濁点の読み分けを辞書で判定",
    });
    e.reading = reading;
    e.modern = m.modern;
    e.skkKey = m.skkKey;
    e.okuri = m.okuri;
    e.method = inL ? "L" : "JMdict";
    return;
  }
  if (!self && (e.method === "align" || e.method === "dict-reading")) {
    e.status = "unverified";
    e.reason = "voicing-ambiguous";
  }
}

/**
 * 字音の「う」を二系統とも「ら」と誤読しやすい（ちゅう-けら 中教、にざら 二藏）。
 * Unihan での対応付けだけで検証された読みで、字音の途中（あ段・え段・お段の直後）の「ら」を
 * 「う」に直すと L・JMdict に同じ表記で載る場合は直す。
 * 「ら」が正しい読み（にかい-ぐら 二階藏）は、直した読みが辞書に載らないので変わらない
 */
function fixRaToU(e: CleanEntry, ctx: Context) {
  const chars = [...e.reading];
  for (let i = 1; i < chars.length; i++) {
    if (chars[i] !== "ら" || !shiftable(chars[i - 1])) continue;
    const reading = [...chars.slice(0, i), "う", ...chars.slice(i + 1)].join("");
    const l = matchL(reading, e.notation!, e.pos, e.kango, ctx);
    const m = l ?? matchJM(reading, e.notation!, e.pos, e.kango, ctx);
    if (!m) continue;
    e.fixes.push({
      field: "reading",
      from: e.reading,
      to: reading,
      reason: "字音の う の誤読（ら）",
    });
    e.reading = reading;
    e.modern = m.modern;
    e.skkKey = m.skkKey;
    e.method = l ? "L" : "JMdict";
    return;
  }
}

/** 字音で直後に「う」が来うる仮名（あ段・え段・お段、ゃ・ょ） */
const shiftable = (c: string) =>
  /[あかがさざただなはばぱまやらわえけげせぜてでねへべぺめれおこごそぞとどのほぼぽもよろゃょ]/.test(
    c,
  );

/**
 * 三系統（ndlocr-lite の紙面全体、NDL 側 OCR、見出しの切り出しの読み直し）の読みの多数決。
 * 3 つとも同じ長さなら 1 文字ずつ多数決を取る（それぞれ別の位置を誤っていても正しい読みが残る）。
 * そうでなければ、2 つ以上が一致する読みを選ぶ。決まらなければ undefined。
 */
export function voteReading(readings: string[]): string | undefined {
  const xs = readings.map((r) => [...plain(r)]);
  if (xs.length < 2) return undefined;
  if (xs.length >= 3 && xs.every((x) => x.length === xs[0].length)) {
    return xs[0].map((c, i) => {
      const votes = xs.map((x) => x[i]);
      return votes.find((v) => votes.filter((w) => w === v).length >= 2) ?? c;
    }).join("");
  }
  const joined = xs.map((x) => x.join(""));
  return joined.find((j) => joined.filter((k) => k === j).length >= 2);
}

/** 区切り "-" の無い読みに、同じ読みの系統の区切りを付け直す */
function withHyphens(consensus: string, sources: string[]): string {
  const hit = sources.find((s) => plain(s) === consensus && s.includes("-"));
  if (hit) return hit;
  const base = sources[0];
  if ([...plain(base)].length !== [...consensus].length) return consensus;
  const chars = [...consensus];
  let k = 0;
  return [...base].map((c) => (c === "-" ? "-" : chars[k++])).join("");
}

export function cleanseVolume(
  extract: ExtractVolume,
  /** NDL 側 OCR から取り出した候補（コマ番号 → 候補） */
  ndl: Map<number, NdlCandidate[]>,
  ctx: Context,
  /** 見出しの切り出しの読み直し（id → 結果） */
  recheck: Record<string, RecheckResult> = {},
): CleanVolume {
  // 1. 正規化と 2. 突き合わせ
  const entries: CleanEntry[] = extract.candidates.map((c) => {
    const fixes: Fix[] = [];
    const { notation, bad } = normalizeNotation(c.notation);
    // 漢字の表記がある語の読みの「ー」は区切り "-" の誤読（外来語は表記が「英」などになる）
    let reading = normalizeReading(
      notation && HAN_RE.test(notation) ? c.reading.replaceAll("ー", "-") : c.reading,
    );
    const n = findNdl(c, ndl.get(c.frame));
    const ndlReading = n ? normalizeReading(n.reading) : undefined;
    if (ndlReading && plain(ndlReading) === plain(reading) && ndlReading !== reading) {
      // 区切り "-" は NDL 側の OCR のほうがよく残っている
      fixes.push({
        field: "reading",
        from: reading,
        to: ndlReading,
        reason: "NDL 側 OCR の区切り",
      });
      reading = ndlReading;
    }
    const pos = normalizePos(c.pos);
    return {
      id: c.id,
      frame: c.frame,
      bbox: c.bbox,
      source: { reading: c.reading, notation: c.notation, pos: c.pos, line: c.line },
      reading,
      notation,
      pos,
      kango: c.kango,
      ndl: n
        ? {
          reading: n.reading,
          notation: n.notation,
          agree: plain(normalizeReading(n.reading)) === plain(reading) && n.notation === notation,
        }
        : undefined,
      order: "ok",
      method: "none",
      status: "unverified",
      reason: bad ? "bad-notation" : undefined,
      fixes,
      suggestions: [],
    } satisfies CleanEntry;
  });

  // 3. 五十音順
  const keys = entries.map((e) => collationKey(e.reading));
  const outliers = orderOutliers(keys);

  // 4〜6. 照合・整合・変換・字体
  entries.forEach((e, i) => {
    if (outliers[i]) e.order = "outlier";
    if (!e.notation) {
      e.status = "excluded";
      e.reason = "no-notation";
      return;
    }
    if (EXCLUDED_CATEGORIES.has(e.pos.category)) {
      e.status = "excluded";
      e.reason = `pos-${e.pos.category}`;
      return;
    }
    if (e.reason === "bad-notation") {
      e.status = "excluded";
      return;
    }
    // 三系統の多数決（読み直しの結果がある候補のみ）
    const rc = recheck[e.id];
    const readingC = rc?.reading ? normalizeReading(rc.reading) : undefined;
    const readingB = e.ndl ? normalizeReading(e.ndl.reading) : undefined;
    const notationC = normalizeNotation(rc?.notation);
    const notationB = normalizeNotation(e.ndl?.notation);
    // NDL 側 OCR と読み直しの表記が一致して元の表記と違う場合は、その表記を先に試す
    // （両方が同じように誤読することもあるので、照合できなければ元の表記を使う）
    const notationBC = notationB.notation && !notationB.bad &&
        notationB.notation === notationC.notation && notationB.notation !== e.notation
      ? notationB.notation
      : undefined;
    let vote: "none" | "agree" | "override" | "conflict" = "none";
    if (readingC) {
      const sources = [e.reading, ...(readingB ? [readingB] : []), readingC];
      const consensus = voteReading(sources);
      if (consensus === plain(e.reading)) vote = "agree";
      else if (consensus) {
        vote = "override";
        const to = withHyphens(consensus, [readingC, ...(readingB ? [readingB] : []), e.reading]);
        e.fixes.push({ field: "reading", from: e.reading, to, reason: "三系統の OCR の多数決" });
        e.reading = to;
      } else vote = "conflict";
    }

    const options: Option[] = vote === "conflict"
      ? [
        // 決まらないときは、見出しを拡大して読み直した結果を先に試す
        { reading: readingC!, notation: e.notation, reason: "見出しの読み直し" },
        { reading: e.reading, notation: e.notation },
      ]
      : [{ reading: e.reading, notation: e.notation }];
    if (notationBC) {
      options.unshift(
        ...options.map((o) => ({
          ...o,
          notation: notationBC,
          reason: "NDL 側 OCR と見出しの読み直しの表記が一致",
        })),
      );
    }
    // 表記の先頭の「一」が漢語の記号か本物の「一」かは読みだけでは決まらないので、両方を試す
    if (!e.kango && e.notation.startsWith("一") && e.notation.length >= 2) {
      options.push({
        reading: e.reading,
        notation: e.notation.slice(1),
        reason: "表記の先頭の一を漢語の記号とみなす",
      });
    }
    if (e.kango && /^(い|ひと)/.test(e.reading)) {
      options.push({
        reading: e.reading,
        notation: "一" + e.notation,
        reason: "漢語の記号とみなした一を表記に戻す",
      });
    }
    if (e.ndl && !e.ndl.agree) {
      const r = normalizeReading(e.ndl.reading);
      const nn = normalizeNotation(e.ndl.notation);
      if (plain(r) !== plain(e.reading) && (vote === "none")) {
        options.push({ reading: r, notation: e.notation, reason: "NDL 側 OCR の読み" });
      }
      if (nn.notation && !nn.bad && nn.notation !== e.notation) {
        options.push({ reading: e.reading, notation: nn.notation, reason: "NDL 側 OCR の表記" });
      }
    }
    if (e.order === "outlier") {
      const [lo, hi] = orderBounds(keys, i);
      for (const alt of orderAlternatives(e.reading, lo, hi)) {
        options.push({
          reading: alt,
          notation: e.notation,
          reason: "五十音順と取り違えやすいかな",
        });
      }
    }

    const suspicious = e.order === "outlier" || (e.ndl !== undefined && !e.ndl.agree);
    // 二系統の OCR が一致した読みは、五十音順から外れていても Unihan での対応付けにかける
    const outlier = e.order === "outlier" && vote !== "agree" && vote !== "override";
    let r = resolve(options, e.pos, e.kango, suspicious, outlier, ctx, readingB);
    if (r?.method === "L-notation") {
      // 表記の補正は抜き取りで半数近くが誤りだったので適用せず、提案として残して未検証にする
      e.suggestions.push({ ...r.fix!, reason: r.fix!.reason + "（未適用）" });
    }
    if (
      r?.method === "dict-reading" &&
      ![readingB, readingC].some((x) =>
        x && modernVariants(x, { kango: e.kango }).includes(r!.modern)
      )
    ) {
      // 読みの補正は、底本の古い語形（とも-どち、とっ-くみ）を L・JMdict にある現代の語形
      // （ともだち、とりくみ）に書き換えてしまうことがある。NDL 側 OCR か見出しの読み直しが
      // 補正後の読みと一致した場合だけ適用し、それ以外は提案として残す
      e.suggestions.push({ ...r.fix!, reason: r.fix!.reason + "（他の OCR と一致せず未適用）" });
      r = undefined;
    }
    if (r && r.method !== "L-notation") {
      if (r.fix?.field === "reading") e.reading = r.fix.to;
      if (r.fix) e.fixes.push(r.fix);
      e.notation = r.notation;
      e.modern = r.modern;
      e.skkKey = r.skkKey;
      e.okuri = r.okuri;
      e.method = r.method;
      e.status = "accepted";
      resolveVoicing(e, [e.source.reading.replaceAll("ー", "-"), readingB, readingC], ctx);
      if (e.status === "accepted" && e.method === "align") fixRaToU(e, ctx);
    }
    if (e.status !== "accepted") {
      // 未検証: 既定の変換結果を使う。動詞・形容詞は送り仮名を最後の 1 文字とする
      const modern = modernVariants(e.reading, { kango: e.kango })[0];
      e.modern = modern;
      if (OKURI_CATEGORIES.has(e.pos.category)) {
        const oc = okuriChars(modern.slice(-1))[0];
        e.okuri = true;
        e.skkKey = oc && modern.length >= 2 ? modern.slice(0, -1) + oc : undefined;
      } else {
        e.okuri = false;
        e.skkKey = modern;
      }
      if (!e.skkKey) {
        e.status = "excluded";
        e.reason = "no-skk-key";
      }
    }
    e.shinjitai = toShinjitai(e.notation, ctx.unihan);
  });

  return { schemaVersion: 1, pid: extract.pid, generatedAt: new Date().toISOString(), entries };
}
