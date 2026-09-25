import { semiVoiced, voiced } from "./kana.ts";
import type { Unihan } from "./resources.ts";

/**
 * 表記の各文字に読みを割り当てられるかを調べる（Unihan の音訓を使う）。
 * 連濁・促音化・訓読みの送り仮名の省略（明方 = あけがた）を許す。
 */
export type AlignOptions = {
  /** 表記を読み尽くした後に残ってよい送り仮名の最大文字数 */
  maxTrailing: number;
  /** 連濁（2 文字目以降の読みの語頭を濁音・半濁音にする）を許すか（既定 true） */
  rendaku?: boolean;
  /** 最後の字は訓読みだけで対応付ける（動詞の語幹の最後の字。既定 false） */
  lastKun?: boolean;
};

const toHira = (s: string) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

const U_ROW = "うくぐすずつづぬふぶぷむゆる";
const I_ROW = "いきぎしじちぢにひびぴみ　り";

const cache = new Map<string, string[]>();

function readingsFor(ch: string, unihan: Unihan, kunOnly = false): string[] {
  const hit = cache.get(ch + (kunOnly ? ":kun" : ""));
  if (hit) return hit;
  const r = unihan.readings.get(ch);
  const out = new Set<string>(kunOnly ? [] : r?.on ?? []);
  for (const k of r?.kun ?? []) {
    out.add(k);
    // 訓読みの送り仮名を省いた形（あける → あけ）。半分以上かつ 2 文字以上は残す
    // （1 文字だと 國「くに」→「く」のように、OCR で語頭が落ちた読みまで通してしまう）
    for (let n = Math.max(2, Math.ceil(k.length / 2)); n < k.length; n++) out.add(k.slice(0, n));
    // 一段動詞の語幹（でる → で、みる → み）。1 文字でも許す
    if (k.length >= 2 && k.endsWith("る")) out.add(k.slice(0, -1));
    // 動詞の連用形（とぶ → とび）。表記の途中の送り仮名は省かれる（飛出 = とびで）
    const i = U_ROW.indexOf(k.at(-1) ?? "");
    if (i >= 0 && I_ROW[i] !== "　" && k.length >= 2) out.add(k.slice(0, -1) + I_ROW[i]);
  }
  const list = [...out];
  cache.set(ch + (kunOnly ? ":kun" : ""), list);
  return list;
}

/** 表記に現れない連体助詞（貝柱 = かひ-の-はしら、秋宮人 = あき-の-みやびと） */
const IMPLICIT_PARTICLES = ["の", "つ", "が"];

function variants(r: string, notFirst: boolean, notLast: boolean, rendaku: boolean): string[] {
  const out = [r];
  if (notFirst && rendaku) {
    const v = voiced(r[0]);
    if (v) out.push(v + r.slice(1));
    const p = semiVoiced(r[0]);
    if (p) out.push(p + r.slice(1));
  }
  if (notLast && /[つくちき]$/.test(r)) out.push(r.slice(0, -1) + "っ");
  return out;
}

export function alignReading(
  notation: string,
  reading: string,
  unihan: Unihan,
  { maxTrailing, rendaku = true, lastKun = false }: AlignOptions,
): boolean {
  const chars = [...notation];
  const seen = new Set<string>();
  const particleBefore = new Set<number>();
  const rec = (i: number, j: number, prev: string[]): boolean => {
    const key = `${i}:${j}:${particleBefore.has(i) ? 1 : 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (i === chars.length) return reading.length - j <= maxTrailing;
    const ch = chars[i];
    if (/[ぁ-ゖァ-ヶ]/.test(ch)) {
      return reading[j] === toHira(ch) && rec(i + 1, j + 1, []);
    }
    const base = ch === "々" || ch === "〻"
      ? prev
      : readingsFor(ch, unihan, lastKun && i === chars.length - 1);
    for (const r of base) {
      for (const v of variants(r, i > 0, i < chars.length - 1, rendaku)) {
        if (reading.startsWith(v, j) && rec(i + 1, j + v.length, base)) return true;
      }
    }
    if (i > 0 && !particleBefore.has(i)) {
      for (const p of IMPLICIT_PARTICLES) {
        if (reading.startsWith(p, j)) {
          particleBefore.add(i);
          if (rec(i, j + p.length, prev)) return true;
          particleBefore.delete(i);
        }
      }
    }
    return false;
  };
  return rec(0, 0, []);
}
