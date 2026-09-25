/**
 * かなの処理: 歴史的仮名遣いから現代仮名遣いへの変換候補の生成、照合用の整列キー、
 * SKK の送り仮名の表記など。
 */

const ROWS = {
  a: "あかがさざただなはばぱまやらわ",
  i: "いきぎしじちぢにひびぴみ　り　",
  u: "うくぐすずつづぬふぶぷむゆるう",
  e: "えけげせぜてでねへべぺめ　れゑ",
  o: "おこごそぞとどのほぼぽもよろを",
} as const;

function shift(c: string, from: keyof typeof ROWS, to: keyof typeof ROWS): string | undefined {
  const i = ROWS[from].indexOf(c);
  if (i < 0) return undefined;
  const r = ROWS[to][i];
  return r && r !== "　" ? r : undefined;
}

/** い段 + ゃゅょ（き→きゃ、きゅ、きょ）。い は や/ゆ/よ になる */
function yoon(i: string, v: "ゃ" | "ゅ" | "ょ"): string {
  if (i === "い") return { ゃ: "や", ゅ: "ゆ", ょ: "よ" }[v];
  if (i === "ぢ") return "じ" + v;
  return i + v;
}

const SMALL: Record<string, string> = {
  ぁ: "あ",
  ぃ: "い",
  ぅ: "う",
  ぇ: "え",
  ぉ: "お",
  っ: "つ",
  ゃ: "や",
  ゅ: "ゆ",
  ょ: "よ",
  ゎ: "わ",
};

/** 五十音順の比較に使うキー。区切り・長音を除き、小書きを並字に、濁点・半濁点を除く */
export function collationKey(reading: string): string {
  return reading.replaceAll(/[-ー・]/g, "")
    .replace(/[ぁぃぅぇぉっゃゅょゎ]/g, (c) => SMALL[c])
    .normalize("NFD").replaceAll(/[゙゚]/g, "").normalize("NFC");
}

const MAX_VARIANTS = 48;

/**
 * 1 つの語構成要素（区切り "-" の間）を変換する。
 * 各位置で当てはまる規則のうち最長のものを使い、曖昧な箇所は複数の候補を出す（先頭が既定）。
 */
function segmentVariants(seg: string, kango: boolean, wordInitial: boolean): string[] {
  const results = new Set<string>();
  const rec = (i: number, acc: string) => {
    if (results.size >= MAX_VARIANTS) return;
    if (i >= seg.length) {
      results.add(acc);
      return;
    }
    const opts = step(seg, i, kango, wordInitial);
    for (const [len, reps] of opts) for (const r of reps) rec(i + len, acc + r);
  };
  rec(0, "");
  return [...results];
}

/**
 * 位置 i で消費する長さと置き換え候補（先頭が既定）。
 * 拗音を大書きした い段 + や/ゆ/よ（共 きよう → きょう、般若 はんにや → はんにゃ）は、
 * 通常の処理（おもひやり → おもいやり）に加えて拗音の候補を足す。
 * どちらが正しいかは照合で選ぶ（内閣告示「現代仮名遣い」付表のキョー・ショーの行に例がある）
 */
function step(s: string, i: number, kango: boolean, wordInitial: boolean): [number, string[]][] {
  const base = stepBase(s, i, kango, wordInitial);
  const [c, n1, n2] = [s[i], s[i + 1], s[i + 2]];
  if (!shift(c, "i", "i") || c === "い" || !(n1 === "や" || n1 === "ゆ" || n1 === "よ")) {
    return base;
  }
  const small = ({ や: "ゃ", ゆ: "ゅ", よ: "ょ" } as const)[n1];
  if (n2 === "う" && n1 !== "や") return [...base, [3, [yoon(c, small) + "う"]]];
  return [...base, [2, [yoon(c, small)]]];
}

function stepBase(
  s: string,
  i: number,
  kango: boolean,
  wordInitial: boolean,
): [number, string[]][] {
  const c = s[i];
  const n1 = s[i + 1];
  const n2 = s[i + 2];
  const medial = i > 0;

  // くわう・ぐわう（光、黄）→ こう・ごう
  if ((c === "く" || c === "ぐ") && n1 === "わ" && n2 === "う") {
    return [[3, [c === "く" ? "こう" : "ごう"]]];
  }
  // くわ・ぐわ（字音の合拗音）
  if ((c === "く" || c === "ぐ") && n1 === "わ") return [[2, [c === "く" ? "か" : "が", c + "わ"]]];

  // い段 + や/ゃ + う/ふ → ょう（きやう→きょう）。い は語構成要素の頭だけ（いやう→よう）。
  // 途中の い は前の字音の一部（たいやう 太陽 → たいよう。たよう ではない）
  if (
    shift(c, "i", "i") && (c !== "い" || !medial) && (n1 === "や" || n1 === "ゃ") &&
    (n2 === "う" || n2 === "ふ")
  ) {
    return [[3, [yoon(c, "ょ") + "う"]]];
  }
  // い段 + ゃゅょ はそのまま（ぢ は じ に）
  if (shift(c, "i", "i") && (n1 === "ゃ" || n1 === "ゅ" || n1 === "ょ")) {
    return [[2, [yoon(c, n1)]]];
  }

  // あ段 + う → お段 + う（かう→こう）、あ段 + ふ → お段 + う / あ段 + う / あ段 + お
  const o = shift(c, "a", "o");
  if (o && n1 === "う") return [[2, [(o === "を" ? "お" : o) + "う"]]];
  if (o && n1 === "ふ") {
    const base = c === "わ" ? "わ" : c;
    const oo = o === "を" ? "お" : o;
    return [[2, kango ? [oo + "う", base + "う"] : [base + "う", oo + "う", base + "お"]]];
  }
  // い段 + う/ふ → ゅう（きう→きゅう、じふ→じゅう）
  if (shift(c, "i", "i") && (n1 === "う" || n1 === "ふ")) {
    const yu = yoon(c, "ゅ") + "う";
    if (n1 === "う") return [[2, [yu]]];
    return [[2, kango ? [yu, c + "つ", c + "う"] : [c + "う", yu]]];
  }
  // え段 + う/ふ → ょう（けふ→きょう、てふ→ちょう）
  const ie = shift(c, "e", "i");
  if (ie && (n1 === "う" || n1 === "ふ")) {
    const yo = yoon(ie, "ょ") + "う";
    return [[2, n1 === "う" || kango ? [yo] : [c + "う", yo]]];
  }

  if (c === "ゐ") return [[1, ["い"]]];
  if (c === "ゑ") return [[1, ["え"]]];
  if (c === "を") return [[1, ["お"]]];

  // ぢ・づ: 同音の連呼（ちぢ、つづ）と連濁（語構成要素の頭）は残す
  if (c === "ぢ" || c === "づ") {
    const plain = c === "ぢ" ? "じ" : "ず";
    const keep = (medial && (s[i - 1] === "ち" || s[i - 1] === "つ")) ||
      (i === 0 && !wordInitial);
    return [[1, keep ? [c, plain] : [plain, c]]];
  }

  // 語中・語尾のハ行 → ワ行（和語）
  if (medial && "はひふへほ".includes(c)) {
    const w = { は: "わ", ひ: "い", ふ: "う", へ: "え", ほ: "お" }[c]!;
    return [[1, kango ? [c, w] : [w, c]]];
  }

  // 字音の促音化（がつかう→がっこう、がくかう→がっこう）
  if (
    kango && medial && (c === "つ" || c === "く") && n1 &&
    /[かきくけこさしすせそたちつてとぱぴぷぺぽ]/.test(n1)
  ) {
    return [[1, [c, "っ"]]];
  }

  return [[1, [c]]];
}

/** 直積を上限付きで作る */
function product(parts: string[][]): string[] {
  let acc = [""];
  for (const p of parts) {
    const next: string[] = [];
    for (const a of acc) for (const b of p) if (next.length < MAX_VARIANTS) next.push(a + b);
    acc = next;
  }
  return acc;
}

/**
 * 歴史的仮名遣いの読みから現代仮名遣いの候補を作る（先頭が既定の変換結果）。
 * 区切り "-" は語構成要素の境界として使い、出力からは除く。
 */
export function modernVariants(reading: string, { kango = false } = {}): string[] {
  const segs = reading.replaceAll(/[・=＝]/g, "-").split("-").filter(Boolean);
  const parts = segs.map((seg, i) => segmentVariants(seg, kango, i === 0));
  return [...new Set(product(parts))];
}

/** 送り仮名の 1 文字目から SKK の送りありの見出しに付ける文字（複数ありうる）を返す */
export function okuriChars(kana: string): string[] {
  const c = kana[0];
  if ("あいうえお".includes(c)) {
    const v = { あ: "a", い: "i", う: "u", え: "e", お: "o" }[c]!;
    return c === "う" ? ["u", "w"] : [v];
  }
  if (c === "っ") return ["t", "c"];
  if (c === "ち") return ["t", "c"];
  if (c === "し") return ["s"];
  if (c === "じ") return ["j", "z"];
  if (c === "つ") return ["t"];
  if (c === "ふ") return ["h", "f"];
  if (c === "ん") return ["n"];
  const table: [string, string][] = [
    ["かきくけこ", "k"],
    ["がぎぐげご", "g"],
    ["さすせそ", "s"],
    ["ざずぜぞ", "z"],
    ["たてと", "t"],
    ["だぢづでど", "d"],
    ["なにぬねの", "n"],
    ["はひへほ", "h"],
    ["ばびぶべぼ", "b"],
    ["ぱぴぷぺぽ", "p"],
    ["まみむめも", "m"],
    ["やゆよ", "y"],
    ["らりるれろ", "r"],
    ["わを", "w"],
  ];
  const hit = table.find(([ks]) => ks.includes(c));
  return hit ? [hit[1]] : [];
}

/**
 * 文語の終止形から現代語の辞書形の候補を作る。
 * 活用の種類は OCR の誤りが多いので、当てはまりうる形をすべて出す。
 */
export function dictionaryForms(modern: string, category: string): string[] {
  const last = modern.at(-1) ?? "";
  const stem = modern.slice(0, -1);
  const forms = [modern];
  if (category === "verb") {
    const e = shift(last, "u", "e");
    const i = shift(last, "u", "i");
    if (e) forms.push(stem + e + "る"); // 下二段 → 下一段（あく→あける）
    if (i) forms.push(stem + i + "る"); // 上二段 → 上一段（おく→おきる）
    if (last === "す") forms.push(stem + "する"); // サ変（あいす→あいする）
    if (last === "ず") forms.push(stem + "ずる", stem + "じる");
  } else if (category === "adjective") {
    if (last === "し") forms.push(stem + "い", modern + "い"); // ク活用・シク活用
  }
  return [...new Set(forms)];
}

export function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** 清音 → 濁音（連濁の照合に使う） */
export function voiced(c: string): string | undefined {
  const i = "かきくけこさしすせそたちつてとはひふへほ".indexOf(c);
  return i < 0 ? undefined : "がぎぐげござじずぜぞだぢづでどばびぶべぼ"[i];
}

export function semiVoiced(c: string): string | undefined {
  const i = "はひふへほ".indexOf(c);
  return i < 0 ? undefined : "ぱぴぷぺぽ"[i];
}
