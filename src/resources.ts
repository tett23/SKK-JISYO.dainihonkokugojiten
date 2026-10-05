import { join } from "@std/path";
import { DATA_DIR } from "./config.ts";
import { download, readRecord } from "./http.ts";

/**
 * クレンジングに使う外部リソース。
 *
 * - SKK-JISYO.L (SKK Development Team, GPL-2.0-or-later): 読み・表記の照合と補正、
 *   L に含まれる語を除いた辞書の作成に使う。再現性のためコミットを固定する。
 * - Unihan データベース (Unicode, Unicode License v3): 漢字の音訓と旧字体→新字体の対応。
 * - JMdict (Electronic Dictionary Research and Development Group, CC BY-SA 4.0): 漢字表記と現代の読み・
 *   品詞の照合、古い仮名遣いの読みの対応。毎日更新されるので取得日時を取得記録に残す。
 * - 日葡辞書見出し語データ Ver.202510（国立国語研究所、大島英之 作成、相田太一 協力、CC BY 4.0）:
 *   『日葡辞書』（1603）の見出し語の片仮名転写。OCR の読みの取り違えの修復の根拠に使う（nippo.ts）。
 */
export const SKK_DICT_COMMIT = "0a164e6b990c5eb5b59eb7d8789f08865dc2f644";

export const resourceUrls = {
  skkL: `https://raw.githubusercontent.com/skk-dev/dict/${SKK_DICT_COMMIT}/SKK-JISYO.L`,
  unihan: "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip",
  jmdict: "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz",
  nippo: "https://www2.ninjal.ac.jp/textdb_dataset/nipp/data/ew-nippo-202510.zip",
};

const resourceDir = join(DATA_DIR, "raw", "resources");
export const resourcePaths = {
  skkL: join(resourceDir, "SKK-JISYO.L"),
  unihan: join(resourceDir, "Unihan.zip"),
  jmdict: join(resourceDir, "JMdict_e.gz"),
  nippo: join(resourceDir, "ew-nippo-202510.zip"),
};

/**
 * JMdict のライセンスは、利用するソフトウェアに最新版からの定期的な更新の手順を求めている。
 * 取得からこの日数を過ぎていたら取り直す。
 */
const JMDICT_MAX_AGE_DAYS = 7;

async function isStale(path: string, days: number): Promise<boolean> {
  const record = await readRecord(path);
  if (!record) return true;
  return Date.now() - Date.parse(record.fetchedAt) > days * 24 * 60 * 60 * 1000;
}

export async function fetchResources({ force = false } = {}): Promise<void> {
  for (const key of ["skkL", "unihan", "jmdict", "nippo"] as const) {
    const refresh = force ||
      (key === "jmdict" && await isStale(resourcePaths[key], JMDICT_MAX_AGE_DAYS));
    const r = await download(resourceUrls[key], resourcePaths[key], { force: refresh });
    if (r === "missing") throw new Error(`${resourceUrls[key]} が取得できません`);
    console.log(`  ${r}: ${resourcePaths[key]}`);
  }
}

export type SkkDict = {
  /** 送りなし: 読み → 候補 */
  okuriNasi: Map<string, string[]>;
  /** 送りあり: 見出し（例: おどろかs）→ 候補 */
  okuriAri: Map<string, string[]>;
  /** 送りなし: 候補 → 読み */
  readingsOf: Map<string, string[]>;
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** SKK 辞書のテキストをパースする。注釈（;以降）と (concat ...) の候補は除く */
export function parseSkkDict(text: string): SkkDict {
  const dict: SkkDict = { okuriNasi: new Map(), okuriAri: new Map(), readingsOf: new Map() };
  let section: "ari" | "nasi" = "ari";
  for (const line of text.split("\n")) {
    if (line.startsWith(";; okuri-ari entries.")) section = "ari";
    else if (line.startsWith(";; okuri-nasi entries.")) section = "nasi";
    if (line.startsWith(";") || !line.includes(" /")) continue;
    const sp = line.indexOf(" /");
    const key = line.slice(0, sp);
    const words = line.slice(sp + 2).split("/")
      .filter((c) => c && !c.startsWith("["))
      .map((c) => c.split(";")[0])
      .filter((w) => w && !w.startsWith("(concat"));
    if (section === "ari") dict.okuriAri.set(key, words);
    else {
      dict.okuriNasi.set(key, words);
      for (const w of words) push(dict.readingsOf, w, key);
    }
  }
  return dict;
}

export async function loadSkkL(): Promise<SkkDict> {
  const bytes = await Deno.readFile(resourcePaths.skkL);
  return parseSkkDict(new TextDecoder("euc-jp").decode(bytes));
}

export type Unihan = {
  /** 旧字体 → 新字体（kJapaneseNewVariant） */
  newVariant: Map<string, string>;
  /** 漢字 → 読み（kJapanese。音読みはひらがなに直す） */
  readings: Map<string, { on: string[]; kun: string[] }>;
  /** 漢字 → 同じ字の異体字（字形の異体、繁体・簡体、旧字体・新字体。両方向） */
  variants: Map<string, Set<string>>;
  /** 漢字 → 意味の上の異体字（協・叶 など、別の字のこともある。両方向） */
  semanticVariants: Map<string, Set<string>>;
};

/** 同じ字の異体字として扱う Unihan の項目（kSpoofingVariant は字形が紛らわしいだけなので含めない） */
const VARIANT_FIELDS = new Set([
  "kZVariant",
  "kTraditionalVariant",
  "kSimplifiedVariant",
  "kCompatibilityVariant",
  "kJapaneseNewVariant",
  "kJapaneseOldVariant",
]);
const SEMANTIC_VARIANT_FIELDS = new Set(["kSemanticVariant", "kSpecializedSemanticVariant"]);

const fromCodePoint = (u: string) => String.fromCodePoint(parseInt(u.slice(2), 16));
const kataToHira = (s: string) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export async function unzipText(zip: string, member: string): Promise<string> {
  const { success, stdout, stderr } = await new Deno.Command("unzip", { args: ["-p", zip, member] })
    .output();
  if (!success) throw new Error(`unzip ${member}: ${new TextDecoder().decode(stderr)}`);
  return new TextDecoder().decode(stdout);
}

export function parseUnihan(text: string): Unihan {
  const unihan: Unihan = {
    newVariant: new Map(),
    readings: new Map(),
    variants: new Map(),
    semanticVariants: new Map(),
  };
  const link = (map: Map<string, Set<string>>, a: string, b: string) => {
    if (a === b) return;
    for (const [x, y] of [[a, b], [b, a]]) {
      const set = map.get(x) ?? new Set<string>();
      set.add(y);
      map.set(x, set);
    }
  };
  for (const line of text.split("\n")) {
    if (!line.startsWith("U+")) continue;
    const [cp, field, value] = line.split("\t");
    const map = VARIANT_FIELDS.has(field)
      ? unihan.variants
      : SEMANTIC_VARIANT_FIELDS.has(field)
      ? unihan.semanticVariants
      : undefined;
    if (map) {
      for (const v of value.split(/\s+/)) {
        if (v.startsWith("U+")) link(map, fromCodePoint(cp), fromCodePoint(v.split("<")[0]));
      }
    }
    if (field === "kJapaneseNewVariant") {
      unihan.newVariant.set(fromCodePoint(cp), fromCodePoint(value.split(/\s/)[0]));
    } else if (field === "kJapanese") {
      const on: string[] = [];
      const kun: string[] = [];
      for (const r of value.split(" ")) {
        if (/^[ァ-ヶー]+$/.test(r)) on.push(kataToHira(r));
        else if (/^[ぁ-ゖー]+$/.test(r)) kun.push(r);
      }
      unihan.readings.set(fromCodePoint(cp), { on, kun });
    }
  }
  return unihan;
}

export async function loadUnihan(): Promise<Unihan> {
  const text = (await unzipText(resourcePaths.unihan, "Unihan_Readings.txt")) +
    (await unzipText(resourcePaths.unihan, "Unihan_Variants.txt"));
  return parseUnihan(text);
}
