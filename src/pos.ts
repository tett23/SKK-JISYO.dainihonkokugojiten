/** 品詞表示（凡例の略語）の正規化 */

export type PosCategory =
  | "noun"
  | "pronoun"
  | "numeral"
  | "verb"
  | "adjective"
  | "adverb"
  | "makura"
  | "interjection"
  | "conjunction"
  | "prefix"
  | "suffix"
  | "particle"
  | "auxiliary"
  | "other";

export type Pos = {
  /** 最初の品詞 */
  category: PosCategory;
  /** 「名、副」のように複数ある場合のすべての品詞 */
  categories: PosCategory[];
  /** 動詞・形容詞の活用の種類（読み取れた場合） */
  conjugation?: string;
  raw: string;
};

const LABELS: [RegExp, PosCategory][] = [
  [/^助動/, "auxiliary"],
  [/^(自動|他動|動)/, "verb"],
  [/^形/, "adjective"],
  [/^名/, "noun"],
  [/^代/, "pronoun"],
  [/^[數数]/, "numeral"],
  [/^副/, "adverb"],
  [/^枕/, "makura"],
  [/^感/, "interjection"],
  [/^接頭/, "prefix"],
  [/^接尾/, "suffix"],
  [/^接/, "conjunction"],
  [/^助/, "particle"],
];

function categoryOf(label: string): PosCategory {
  return LABELS.find(([re]) => re.test(label))?.[1] ?? "other";
}

/**
 * 活用の種類。OCR では「四」が「地」「心」「思」などに化けることが多いが、
 * どれに当たるかは確定できないので、読み取れたものだけを返す。
 */
function conjugationOf(rest: string): string | undefined {
  if (/上[一1]/.test(rest)) return "上一";
  if (/上[二ニ2]/.test(rest)) return "上二";
  if (/下[一1]/.test(rest)) return "下一";
  if (/下[二ニ2]/.test(rest)) return "下二";
  if (/[變変]/.test(rest)) return "変格";
  if (/四/.test(rest)) return "四段";
  return undefined;
}

export function normalizePos(raw: string): Pos {
  const labels = raw.replaceAll(/\s/g, "").split(/[、,，・]/).filter(Boolean);
  const categories = labels.map(categoryOf);
  const first = labels[0] ?? "";
  const category = categories[0] ?? "other";
  let conjugation: string | undefined;
  if (category === "verb") conjugation = conjugationOf(first.replace(/^(自動|他動|動)/, ""));
  if (category === "adjective") {
    const rest = first.slice(1);
    conjugation = /^[一1]/.test(rest) ? "ク" : /^[二ニ2]/.test(rest) ? "シク" : undefined;
  }
  return { category, categories, conjugation, raw };
}
