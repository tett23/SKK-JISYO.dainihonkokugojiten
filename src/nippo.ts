/**
 * 『日葡辞書』（1603）の見出し語との照合。
 *
 * 国立国語研究所「日葡辞書見出し語データ Ver.202510」（大島英之 作成、相田太一 協力、CC BY 4.0）の
 * 片仮名転写（当時の発音を写したもの。キャゥ 京、ヲゥミネ 大峰）と照合するため、底本の歴史的仮名遣いの
 * 読みを当時の発音の形に変換する。規則の根拠は docs/cleansing.md の参考文献。
 *
 * - 開合: ア段 + う・ふ（かう、きやう、あふ）は開音 ǒ（カゥ、キャゥ）、オ段 + う・ふ は合音 ô（コゥ）、
 *   えう・けふ・せう は ヨゥ（ショゥ）、いう・いふ は ユゥ（呉 1999、竹村 2011、豊島 1984）
 * - ハ行転呼: 語中の は行 は わ・い・う・え・を。区切り "-" の後や、区切りの無い複合語の後部要素の頭は
 *   は行 のまま残る語もあるので両方の候補を出す（秋永 1977）
 * - ア行・ワ行の合流（お・を → ヲ、え・ゑ → エ、い・ゐ → イ）、合拗音 くわ → クヮ
 * - 入声 t（漢語の字末の つ）は ツ・っ（-t）・ッ（促音）の揺れを出す（森田 1955）
 *
 * 1603 年以降の音韻変化（開合の合一、四つ仮名の合一）と、語ごとの清濁の違い（森田 1977）は、
 * 照合の鍵でそれらの区別を捨てて吸収する（looseKey）。
 */
import { resourcePaths, unzipText } from "./resources.ts";

const ROWS = [
  "あいうえお",
  "かきくけこ",
  "がぎぐげご",
  "さしすせそ",
  "ざじずぜぞ",
  "たちつてと",
  "だぢづでど",
  "なにぬねの",
  "はひふへほ",
  "ばびぶべぼ",
  "ぱぴぷぺぽ",
  "まみむめも",
  "や　ゆ　よ",
  "らりるれろ",
  "わゐ　ゑを",
]; // deno-fmt-ignore
const ROW = new Map<string, [string, number]>();
for (const row of ROWS) {
  [...row].forEach((c, i) => {
    if (c !== "　") ROW.set(c, [row, i]);
  });
}
const col = (c: string, v: number) => ROW.get(c)![0][v];
const kata = (s: string) =>
  s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const SMALL: Record<string, string> = {
  ゃ: "や",
  ゅ: "ゆ",
  ょ: "よ",
  ゎ: "わ",
  ぁ: "あ",
  ぃ: "い",
  ぅ: "う",
  ぇ: "え",
  ぉ: "お",
}; // deno-fmt-ignore

/** 音節。c は字（あ行・わ行は元の字）、y は拗音（y）・合拗音（w）、v は母音の番号。転呼した ふ・ほ は c に印 */
type Mora = { c: string; y: "" | "y" | "w"; v: number } | string;

function morae(s: string): Mora[] {
  const t = [...s].map((c) => SMALL[c] ?? c);
  const out: Mora[] = [];
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    const r = ROW.get(c);
    if (!r) {
      out.push(c);
      continue;
    }
    const next = t[i + 1];
    if (r[1] === 1 && !"いゐ".includes(c) && next && "やゆよ".includes(next)) {
      out.push({ c, y: "y", v: ROW.get(next)![1] });
      i++;
    } else if ("くぐ".includes(c) && next === "わ") {
      out.push({ c, y: "w", v: 0 });
      i++;
    } else out.push({ c, y: "", v: r[1] });
  }
  return out;
}

function syllable(c: string, y: string, v: number): string {
  if (c === "ふ*") return "ウ";
  if (c === "ほ*") return "ヲ";
  if (y === "") {
    if ("あいうえおわゐゑを".includes(c)) {
      return c === "あ" ? "ア" : ["ワ", "イ", "ウ", "エ", "ヲ"][v];
    }
    if ("やゆよ".includes(c)) return ["ヤ", "", "ユ", "", "ヨ"][v];
    return kata(col(c, v));
  }
  if (y === "w") return kata(c) + "ヮ";
  if ("いえ".includes(c)) return ["ヤ", "", "ユ", "", "ヨ"][v];
  return kata(col(c, 1)) + ["ャ", "", "ュ", "", "ョ"][v];
}

const LONG = "ゥ";

function render(ms: Mora[]): string[] {
  let outs = [""];
  const add = (xs: string[]) => {
    outs = outs.flatMap((o) => xs.map((x) => o + x));
  };
  for (let k = 0; k < ms.length; k++) {
    const m = ms[k];
    if (typeof m === "string") {
      add([{ っ: "ッ", ん: "ン" }[m] ?? m]);
      continue;
    }
    const { c, y, v } = m;
    const n = ms[k + 1];
    const isU = typeof n === "object" && n.y === "" && (n.c === "う" || n.c === "ふ*");
    const isWo = typeof n === "object" && n.y === "" && (n.c === "を" || n.c === "ほ*");
    if (isU) {
      const vowelRow = "あいうえおわゐゑを".includes(c);
      if (v === 0 || v === 4 || v === 2) { // 開音・合音・ウ段長音
        add([syllable(c, y, v) + LONG]);
        k++;
        continue;
      }
      if (v === 3) { // えう → ヨゥ
        add([(vowelRow ? "ヨ" : syllable(c, "y", 4)) + LONG]);
        k++;
        continue;
      }
      if (v === 1 && y === "") { // いう → ユゥ
        add([(vowelRow ? "ユ" : syllable(c, "y", 2)) + LONG]);
        k++;
        continue;
      }
    }
    if (isWo && v === 4 && y === "") { // オ段 + ほ・を: ヲゥ と ヲヲ の揺れ（Vouoi / Vôqij）
      add([syllable(c, y, 4) + LONG, syllable(c, y, 4) + "ヲ"]);
      k++;
      continue;
    }
    add([syllable(c, y, v)]);
  }
  return outs;
}

function segmentForms(seg: string, initial: boolean): string[] {
  const ms = morae(seg);
  const opts: Mora[][] = ms.map((m, k) => {
    if (
      typeof m !== "object" || !"はひふへほ".includes(m.c) || m.y !== "" || (k === 0 && initial)
    ) {
      return [m];
    }
    const conv = { c: ["わ", "い", "ふ*", "え", "ほ*"][m.v], y: "" as const, v: m.v };
    return k > 0 ? [conv, m] : [m, conv];
  });
  const out = new Set<string>();
  let combos: Mora[][] = [[]];
  for (const o of opts) {
    combos = combos.flatMap((c) => o.map((x) => [...c, x])).slice(0, 64);
  }
  for (const c of combos) for (const r of render(c)) out.add(r);
  return [...out];
}

/** 歴史的仮名遣いの読み（区切り "-" あり）を、日葡辞書の片仮名転写の形の候補にする */
export function nippoForms(reading: string, { kango = false, verb = false } = {}): string[] {
  let segs = reading.split(/[-・]/).filter(Boolean);
  let tail = "";
  // 動詞の語尾の う・ふ は長音にならない（言ふ イウ、買ふ カウ）
  if (verb && segs.length && /[うふ]$/.test(segs.at(-1)!)) {
    segs[segs.length - 1] = segs.at(-1)!.slice(0, -1);
    segs = segs.filter(Boolean);
    tail = "ウ";
  }
  let outs = [""];
  segs.forEach((s, i) => {
    const fs = segmentForms(s, i === 0);
    outs = outs.flatMap((o) => fs.map((f) => o + f)).slice(0, 512);
  });
  const out = new Set(outs.map((o) => o + tail));
  // 入声 t（漢語の字末の つ）: ツ・っ（-t）・ッ（促音）
  if (kango) {
    for (const f of [...out]) {
      [...f].forEach((ch, i) => {
        if (ch !== "ツ" || i === 0) return;
        out.add(f.slice(0, i) + "っ" + f.slice(i + 1));
        out.add(f.slice(0, i) + "ッ" + f.slice(i + 1));
      });
    }
  }
  return [...out];
}

const OPEN = "アカガサザタダナハバパマヤラワ";
const CLOSED = "オコゴソゾトドノホボポモヨロヲ";

/**
 * 照合の鍵。1603 年以降に合一した区別（開合、四つ仮名）と、語ごとに揺れる清濁、日葡辞書の表記の
 * 揺れ（入声 t の っ・ッ・ツ、撥音 ㇺ）を捨てる
 */
export function looseKey(s: string): string {
  const chars = [...s.replaceAll("ㇺ", "ン")];
  const out = chars.map((ch, i) => {
    if (chars[i + 1] === LONG) {
      if (ch === "ャ") return "ョ";
      const k = OPEN.indexOf(ch);
      if (k >= 0) return CLOSED[k];
    }
    return ch === "っ" ? "ッ" : ch;
  }).join("").replaceAll("ヂ", "ジ").replaceAll("ヅ", "ズ");
  return out.normalize("NFD").replace(/[゙゚]/g, "").normalize("NFC");
}

export type Nippo = { keys: Set<string> };

/** 見出し語の片仮名転写を読み、照合の鍵の集合を作る。異形（|）と動詞の活用形を展開する */
export function parseNippo(text: string): Nippo {
  const keys = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const c = line.split("\t");
    if (c.length < 4 || c[0] === "整理番号") continue;
    for (const alt of c[3].split("|")) {
      const parts = alt.replace(/^[\s.,]+|[\s.,]+$/g, "").split(",").map((p) =>
        p.trim().replace(/\.$/, "")
      );
      if (!parts[0]) continue;
      const forms = new Set([parts[0]]);
      // 動詞は 連用形, 連体形（終止）, 過去 で立てる（ナラシ,ス,イタ → ナラス）
      if (parts[1]) {
        forms.add(parts[0].slice(0, -1) + parts[1]);
        if (parts[1].endsWith("ル") && parts[1].length >= 2) {
          forms.add(parts[0].slice(0, -1) + parts[1].slice(0, -1));
        }
      }
      for (const f of forms) keys.add(looseKey(f.replaceAll(" ", "")));
    }
  }
  return { keys };
}

export async function loadNippo(): Promise<Nippo> {
  return parseNippo(
    await unzipText(resourcePaths.nippo, "ew-nippo-202510/ew-nippo-202510.txt"),
  );
}

/** 読みが日葡辞書の見出しに（開合・四つ仮名・清濁の区別を捨てて）あるか */
export function inNippo(
  nippo: Nippo,
  reading: string,
  opts: { kango?: boolean; verb?: boolean } = {},
): boolean {
  return nippoForms(reading, opts).some((f) => nippo.keys.has(looseKey(f)));
}
