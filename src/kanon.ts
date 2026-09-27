/**
 * 漢語の読みを字音（漢字音）で確かめる。
 *
 * 『廣韻』の反切から決まる音韻地位（声母・韻・等・開合・声調）を tshet-uinh（MIT）で引き、
 * 日本漢字音の対応規則で漢音・呉音の字音仮名遣い（高 かう、小 せう、劫 けふ、光 くわう）を作る。
 * 歴史的仮名遣いの見出しの読みを、表記の字ごとの字音に区切れるかで、読みと表記が矛盾しないかを調べる。
 *
 * - 声母: 全濁（並・定・從・羣 など）は漢音で清音、呉音で濁音。次濁（明・泥・日・疑）は漢音で
 *   バ・ダ・ザ・ガ行、呉音でマ・ナ・ナ・ガ行。清音の声母の字が語頭で濁ることはない（吸 きふ、京 きやう）
 * - 韻尾: -ŋ は う・い（東 とう、京 けい）、-n・-m は ん、入声の -p は ふ（法 はふ）、-t は つ・ち、
 *   -k は く・き。合口の牙喉音は くわ・ぐわ（光 くわう、外 ぐわい）
 *
 * 規則は韻ごとに漢音・呉音の型を並べた近似で、慣用音（立 りつ、驗 けん）は含まない。
 * そのため、字音に合わないことを誤りの根拠にするときは Unihan の音訓でも対応付けられないことを求める
 */
import * as TshetUinh from "tshet-uinh";
import { modernVariants, semiVoiced, voiced } from "./kana.ts";
import type { Unihan } from "./resources.ts";

/** 声母の行。V は影母（あ行）、W は云母・匣母の呉音（わ行）、Y は以母（や行） */
type Row = "k" | "g" | "s" | "z" | "t" | "d" | "n" | "h" | "b" | "m" | "r" | "V" | "W" | "Y";

const INITIALS: Record<string, Row[]> = {
  幫: ["h"],
  滂: ["h"],
  並: ["h", "b"],
  明: ["b", "m"],
  端: ["t"],
  透: ["t"],
  定: ["t", "d"],
  泥: ["d", "n"],
  知: ["t"],
  徹: ["t"],
  澄: ["t", "d"],
  孃: ["d", "n"],
  精: ["s"],
  清: ["s"],
  從: ["s", "z"],
  心: ["s"],
  邪: ["s", "z"],
  莊: ["s"],
  初: ["s"],
  崇: ["s", "z"],
  生: ["s"],
  俟: ["s", "z"],
  章: ["s"],
  昌: ["s"],
  常: ["s", "z"],
  書: ["s"],
  船: ["s", "z"],
  日: ["z", "n"],
  見: ["k"],
  溪: ["k"],
  羣: ["k", "g"],
  疑: ["g"],
  影: ["V"],
  曉: ["k"],
  匣: ["k", "g", "W"],
  云: ["W"],
  以: ["Y"],
  來: ["r"],
};

/**
 * 韻ごとの字音の型（開口・合口）。型は "yau"（拗音 + a + う）、"wan"（合拗音 + a + ん）のように書く。
 * coda は鼻音の韻尾（n: -n、N: -ŋ、M: -m）で、入声の型を作るのに使う
 */
const RHYMES: Record<string, { open: string[]; closed?: string[]; coda: "" | "n" | "N" | "M" }> = {
  東: { open: ["iu", "yuu", "uu", "ou", "u"], coda: "N" },
  冬: { open: ["ou", "yuu"], coda: "N" },
  鍾: { open: ["you", "ou", "yuu"], coda: "N" },
  江: { open: ["au"], coda: "N" },
  支: { open: ["i", "e"], closed: ["wi", "i"], coda: "" },
  脂: { open: ["i"], closed: ["wi", "i"], coda: "" },
  之: { open: ["i"], coda: "" },
  微: { open: ["i", "e"], closed: ["wi", "i"], coda: "" },
  魚: { open: ["yo", "o"], coda: "" },
  虞: { open: ["yu", "u", "uu", "yuu"], coda: "" },
  模: { open: ["o", "u"], coda: "" },
  齊: { open: ["ei", "ai", "e"], closed: ["wei", "e"], coda: "" },
  祭: { open: ["ei", "ai", "e"], closed: ["wei", "ai"], coda: "" },
  泰: { open: ["ai"], closed: ["wai", "ai", "we"], coda: "" },
  佳: { open: ["ai", "a", "e"], closed: ["wai", "wa", "we"], coda: "" },
  皆: { open: ["ai", "a", "e"], closed: ["wai", "wa", "we"], coda: "" },
  夬: { open: ["ai", "a", "e"], closed: ["wai", "wa", "we"], coda: "" },
  灰: { open: ["wai", "ai", "we"], coda: "" },
  咍: { open: ["ai"], coda: "" },
  廢: { open: ["ai", "e"], closed: ["wai", "we"], coda: "" },
  真: { open: ["in", "on"], closed: ["yun", "in", "un"], coda: "n" },
  臻: { open: ["in", "on"], coda: "n" },
  文: { open: ["un", "on"], coda: "n" },
  殷: { open: ["in", "on"], coda: "n" },
  元: { open: ["en", "on", "an"], closed: ["wen", "wan", "won", "an"], coda: "n" },
  魂: { open: ["on"], coda: "n" },
  痕: { open: ["on"], coda: "n" },
  寒: { open: ["an"], closed: ["wan", "an"], coda: "n" },
  刪: { open: ["an", "en"], closed: ["wan", "wen"], coda: "n" },
  山: { open: ["an", "en"], closed: ["wan", "wen"], coda: "n" },
  先: { open: ["en"], closed: ["wen", "win"], coda: "n" },
  仙: { open: ["en"], closed: ["wen", "wan", "win"], coda: "n" },
  蕭: { open: ["eu"], coda: "" },
  宵: { open: ["eu"], coda: "" },
  肴: { open: ["au", "eu"], coda: "" },
  豪: { open: ["au", "o", "ou"], coda: "" },
  歌: { open: ["a"], closed: ["wa", "a"], coda: "" },
  麻: { open: ["a", "e"], closed: ["wa", "we"], coda: "" },
  陽: { open: ["yau", "au"], closed: ["wau", "yau", "au"], coda: "N" },
  唐: { open: ["au"], closed: ["wau", "au"], coda: "N" },
  庚: { open: ["au", "ei", "yau"], closed: ["wau", "wei", "yau"], coda: "N" },
  耕: { open: ["au", "ei", "yau"], closed: ["wau"], coda: "N" },
  清: { open: ["ei", "yau"], closed: ["wei", "yau"], coda: "N" },
  青: { open: ["ei", "yau"], closed: ["wei", "yau"], coda: "N" },
  蒸: { open: ["you", "ou"], coda: "N" },
  登: { open: ["ou"], closed: ["ou"], coda: "N" },
  尤: { open: ["iu", "yu", "u", "ou"], coda: "" },
  侯: { open: ["ou", "u", "o"], coda: "" },
  幽: { open: ["iu", "eu", "yu"], coda: "" },
  侵: { open: ["in", "on"], coda: "M" },
  覃: { open: ["an", "on"], coda: "M" },
  談: { open: ["an", "on"], coda: "M" },
  鹽: { open: ["en"], coda: "M" },
  添: { open: ["en"], coda: "M" },
  咸: { open: ["an", "en"], coda: "M" },
  銜: { open: ["an", "en"], coda: "M" },
  嚴: { open: ["en", "on"], coda: "M" },
  凡: { open: ["an", "on"], coda: "M" },
};

/** -ŋ の韻の入声（東 → 屋 oku・iku、庚 → 陌 aku・yaku・eki） */
const ENTERING_N: Record<string, string[]> = {
  東: ["oku", "iku", "yuku", "uku"],
  蒸: ["yoku", "oku", "iki"],
  庚: ["aku", "yaku", "eki", "waku"],
  耕: ["aku", "yaku", "waku"],
  清: ["eki", "yaku"],
  青: ["eki", "yaku"],
};
const ENTERING_N_BY_TYPE: Record<string, string> = {
  au: "aku",
  wau: "waku",
  yau: "yaku",
  ou: "oku",
  you: "yoku",
  yuu: "yoku",
  iu: "iku",
  u: "oku",
  ei: "eki",
  wei: "eki",
};

/** 入声の型。鼻音の韻尾を対応する入声の韻尾にする（-m → ふ、-n → つ・ち、-ŋ → く・き） */
function enteringTypes(type: string, coda: string, rhyme: string): string[] {
  // -p の ふ は、後ろの字によって つ とも書く（立 りつ、壓 あつ）
  if (coda === "M") return [type.replace(/n$/, "fu"), type.replace(/n$/, "tsu")];
  if (coda === "n") return [type.replace(/n$/, "tsu"), type.replace(/n$/, "chi")];
  if (coda !== "N") return [];
  if (ENTERING_N[rhyme]) return ENTERING_N[rhyme];
  const t = ENTERING_N_BY_TYPE[type];
  return t ? [t] : [];
}

const KANA: Record<string, string> = {
  ka: "か",
  ki: "き",
  ku: "く",
  ke: "け",
  ko: "こ",
  ga: "が",
  gi: "ぎ",
  gu: "ぐ",
  ge: "げ",
  go: "ご",
  sa: "さ",
  si: "し",
  su: "す",
  se: "せ",
  so: "そ",
  za: "ざ",
  zi: "じ",
  zu: "ず",
  ze: "ぜ",
  zo: "ぞ",
  ta: "た",
  ti: "ち",
  tu: "つ",
  te: "て",
  to: "と",
  da: "だ",
  di: "ぢ",
  du: "づ",
  de: "で",
  do: "ど",
  na: "な",
  ni: "に",
  nu: "ぬ",
  ne: "ね",
  no: "の",
  ha: "は",
  hi: "ひ",
  hu: "ふ",
  he: "へ",
  ho: "ほ",
  ba: "ば",
  bi: "び",
  bu: "ぶ",
  be: "べ",
  bo: "ぼ",
  ma: "ま",
  mi: "み",
  mu: "む",
  me: "め",
  mo: "も",
  ra: "ら",
  ri: "り",
  ru: "る",
  re: "れ",
  ro: "ろ",
  Va: "あ",
  Vi: "い",
  Vu: "う",
  Ve: "え",
  Vo: "お",
  Wa: "わ",
  Wi: "ゐ",
  Wu: "う",
  We: "ゑ",
  Wo: "を",
  Ya: "や",
  Yi: "い",
  Yu: "ゆ",
  Ye: "え",
  Yo: "よ",
}; // deno-fmt-ignore
const TAILS: Record<string, string> = {
  "": "",
  u: "う",
  i: "い",
  n: "ん",
  ku: "く",
  ki: "き",
  tsu: "つ",
  chi: "ち",
  fu: "ふ",
};
const VOWEL_ROWS = new Set<Row>(["V", "W", "Y"]);

/** 声母の行と、型の頭（拗音・合拗音 + 母音）から最初の音節を作る（拗音は並字で書く） */
function onset(row: Row, head: string): string[] {
  const k = (r: string, v: string) => KANA[r + v];
  const v = head.at(-1)!;
  if (head.startsWith("y")) return [VOWEL_ROWS.has(row) ? k("Y", v) : k(row, "i") + k("Y", v)];
  if (head.startsWith("w")) {
    if (VOWEL_ROWS.has(row)) return [k("W", v), k("V", v)];
    if (row === "k" || row === "g") {
      return v === "a" ? [k(row, "u") + "わ"] : [k(row, "u") + k("W", v), k(row, v)];
    }
    if (v === "i" && "sztdr".includes(row)) return [k(row, "u") + "ゐ", k(row, v)];
    return [k(row, v)];
  }
  if (row === "V") return v === "o" ? ["お", "を"] : [k("V", v)];
  if (row === "W") return [k("W", v), k("V", v)];
  if (row === "Y") return [k("Y", v), k("V", v)];
  return [k(row, v)];
} // deno-fmt-ignore

function render(row: Row, type: string): string[] {
  const [, head, rest] = type.match(/^([yw]?[aiueo])(.*)$/)!;
  return onset(row, head).map((s) => s + TAILS[rest]);
}

/** 1 つの音韻地位から作る字音 */
function readingsOfPosition(p: TshetUinh.音韻地位): string[] {
  const rows = INITIALS[p.母];
  const r = RHYMES[p.韻];
  if (!rows || !r) return [];
  let types = p.呼 === "合" && r.closed ? r.closed : r.open;
  if (p.韻 === "東" && p.等 === "一") types = ["ou", "u", "uu"];
  if (p.韻 === "麻" && p.等 === "三") types = ["ya", "a"];
  if (p.聲 === "入") types = types.flatMap((t) => enteringTypes(t, r.coda, p.韻));
  return rows.flatMap((row) => types.flatMap((t) => render(row, t)));
}

/** 比べるときの形: 拗音・合拗音の小書きを並字にする（底本は きやう と きゃう の両方がある） */
export function kanonKana(s: string): string {
  return s.replace(/[ゃゅょゎ]/g, (c) => ({ ゃ: "や", ゅ: "ゆ", ょ: "よ", ゎ: "わ" })[c]!);
}

const cache = new Map<string, string[]>();

/**
 * 字の字音（漢音・呉音）。『廣韻』に無い字体（状、徳、黒）は Unihan の異体字で引く。
 * どちらにも無ければ空
 */
export function kanonReadings(ch: string, unihan: Unihan): string[] {
  const hit = cache.get(ch);
  if (hit) return hit;
  const of = (c: string) =>
    TshetUinh.資料.query字頭(c).flatMap((x) => readingsOfPosition(x.音韻地位));
  let out = of(ch);
  if (out.length === 0) out = [...(unihan.variants.get(ch) ?? [])].flatMap(of);
  if (out.length === 0) out = [...(unihan.semanticVariants.get(ch) ?? [])].flatMap(of);
  const list = [...new Set(out.map(kanonKana))];
  cache.set(ch, list);
  return list;
}

const modernCache = new Map<string, string[]>();

/** 字音を現代仮名遣いに直したもの（がう → ごう、くわう → こう） */
function kanonModern(ch: string, unihan: Unihan): string[] {
  const hit = modernCache.get(ch);
  if (hit) return hit;
  const list = [
    ...new Set(kanonReadings(ch, unihan).flatMap((r) => modernVariants(r, { kango: true }))),
  ];
  modernCache.set(ch, list);
  return list;
}

export type KanonOptions = {
  /** Unihan の音読み（現代仮名遣い）に合う読みも字音として認める（慣用音を補う） */
  unihanOn?: boolean;
  /**
   * 連濁（2 字目以降の語頭の濁音・半濁音）を認める位置。"any" はどこでも、"nasal" は ん・っ の後だけ、
   * "none" は認めない（字音そのものが濁る字、呉音の 奉行 ぶぎやう などだけを通す）
   */
  rendaku?: "any" | "nasal" | "none";
};

/**
 * 歴史的仮名遣いの読み（区切り "-" を除いたもの）を、表記の字ごとの字音に区切る。
 * 区切れなければ undefined。促音化（學校 がくかう → がっかう）と連濁を認める
 */
export function kanonSegment(
  notation: string,
  reading: string,
  unihan: Unihan,
  { unihanOn = false, rendaku = "any" }: KanonOptions = {},
): string[] | undefined {
  const chars = [...notation];
  if (chars.some((c) => !/[\p{sc=Han}々]/u.test(c))) return undefined;
  const original = reading.replaceAll(/[-ー・]/g, "");
  const r = kanonKana(original);
  // 底本の字音仮名遣いは規範どおりとは限らない（降魔 を がうま でなく ごうま と書く）ので、
  // 字音とは現代仮名遣いに直して比べる
  const fits = (ch: string, kana: string) => {
    if (kanonReadings(ch, unihan).includes(kana)) return true;
    const modern = modernVariants(kana, { kango: true });
    return modern.some((v) => kanonModern(ch, unihan).includes(v)) ||
      (unihanOn && modern.some((v) => (unihan.readings.get(ch)?.on ?? []).includes(v)));
  };
  /** 元の字音に戻す候補: 促音化（末尾の っ → つ・く・ち・き・ふ）と連濁（語頭の濁音・半濁音 → 清音） */
  const baseForms = (kana: string, i: number, afterNasal: boolean): string[] => {
    const bases = new Set([kana]);
    if (i < chars.length - 1 && kana.endsWith("っ")) {
      for (const c of "つくちきふ") bases.add(kana.slice(0, -1) + c);
    }
    if (i === 0) return [...bases];
    for (const b of [...bases]) {
      const plain = [..."かきくけこさしすせそたちつてとはひふへほ"].find((c) =>
        voiced(c) === b[0] || semiVoiced(c) === b[0]
      );
      if (!plain) continue;
      // ん・っ の後の は行 の半濁音（先負 せんぷ、立法 りっぱふ）は連濁ではなく規則的な音便
      const semi = semiVoiced(plain) === b[0] && afterNasal;
      if (semi || rendaku === "any" || (rendaku === "nasal" && afterNasal)) {
        bases.add(plain + b.slice(1));
      }
    }
    return [...bases];
  };
  const fitsChar = (i: number, kana: string, prev: string) =>
    chars[i] === "々" || chars[i] === "〻"
      ? kana === prev || kana === prev.replace(/っ$/, "")
      : fits(chars[i], kana);
  const seen = new Set<string>();
  const out: string[] = [];
  const rec = (i: number, j: number): boolean => {
    if (i === chars.length) return j === r.length;
    const key = `${i}:${j}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const prev = kanonKana(out.at(-1) ?? "");
    const afterNasal = /[んっ]$/.test(prev);
    for (let len = 1; len <= 6 && j + len <= r.length; len++) {
      const written = original.slice(j, j + len);
      // 合拗音の わ を あ と読んだもの（くあ・ぐあ）は字音仮名遣いに無いので くわ・ぐわ に直して調べる
      const forms = /^[くぐ]あ/.test(written)
        ? [written, written[0] + "わ" + written.slice(2)]
        : [written];
      for (const form of forms) {
        if (baseForms(kanonKana(form), i, afterNasal).some((b) => fitsChar(i, b, prev))) {
          out.push(form);
          if (rec(i + 1, j + len)) return true;
          out.pop();
        }
      }
    }
    return false;
  };
  return rec(0, 0) ? [...out] : undefined;
}
