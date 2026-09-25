import { segmentReading } from "./align.ts";
import type { Jmdict } from "./jmdict.ts";
import type { SkkDict, Unihan } from "./resources.ts";

/**
 * 字ごとの読みの頭の清濁の統計。
 *
 * L と JMdict の漢字だけの語（送りなし）を Unihan で字ごとの読みに分け、各字の読みの頭が
 * 清音・濁音・半濁音のどれかを、前の音の環境（語頭、ん の後、っ の後、それ以外）ごとに数える。
 * OCR は濁点・半濁点を見誤りやすい（魂魄 こん-ぱく を こん-ばく、盆付 ぼん を ほん）。
 * 候補の読みの清濁が、同じ字・同じ環境でほとんど現れない側なら疑う
 */

export type VoicingClass = "plain" | "voiced" | "semi";
type Context = "head" | "n" | "tsu" | "other";

const VOICED = "がぎぐげござじずぜぞだぢづでどばびぶべぼ";
const SEMI = "ぱぴぷぺぽ";

export function voicingClass(kana: string): VoicingClass | undefined {
  const c = kana[0];
  if (VOICED.includes(c)) return "voiced";
  if (SEMI.includes(c)) return "semi";
  // 濁点を付けうる字だけ（か行・さ行・た行・は行）
  if ("かきくけこさしすせそたちつてとはひふへほ".includes(c)) return "plain";
  return undefined;
}

/** 読みの頭の濁点・半濁点を外した形（ぱく・ばく → はく）。同じ字の別の読み（唾 だ／つば）を分ける */
const unvoiced = (kana: string) =>
  kana.normalize("NFD").replace(/^(.)[\u3099\u309A]/, "$1").normalize("NFC");

const contextOf = (prev: string | undefined): Context =>
  prev === undefined ? "head" : prev === "ん" ? "n" : prev === "っ" ? "tsu" : "other";

export type ReadingStats = Map<string, Record<VoicingClass, number>>;

const KANJI_ONLY = /^[\p{Script=Han}々]+$/u;

export function buildReadingStats(
  L: SkkDict,
  jm: Jmdict | undefined,
  unihan: Unihan,
): ReadingStats {
  const stats: ReadingStats = new Map();
  const pairs = new Set<string>();
  for (const [reading, words] of L.okuriNasi) {
    for (const w of words) {
      if (KANJI_ONLY.test(w) && [...w].length >= 2) pairs.add(`${w}\t${reading}`);
    }
  }
  for (const forms of jm?.bySkeleton.values() ?? []) {
    for (const f of forms) {
      if (!KANJI_ONLY.test(f.kanji) || [...f.kanji].length < 2) continue;
      for (const r of f.readings) if (!r.old) pairs.add(`${f.kanji}\t${r.reading}`);
    }
  }
  for (const p of pairs) {
    const [w, reading] = p.split("\t");
    const segs = segmentReading(w, reading, unihan, { maxTrailing: 0 });
    if (!segs) continue;
    let prev: string | undefined;
    for (const s of segs) {
      const cls = voicingClass(s.kana);
      if (cls) {
        const key = `${s.char}\t${unvoiced(s.kana)}\t${contextOf(prev)}`;
        const c = stats.get(key) ?? { plain: 0, voiced: 0, semi: 0 };
        c[cls]++;
        stats.set(key, c);
      }
      prev = s.kana.at(-1);
    }
  }
  return stats;
}

/**
 * 読みの各字の清濁が統計に反するところ（その環境で観測した側が一度も無く、別の側が
 * minOther 回以上ある）を返す。例: 魄 の ん の後は ぱく ばかりで ばく は無い
 */
export function voicingAnomalies(
  notation: string,
  reading: string,
  unihan: Unihan,
  stats: ReadingStats,
  minOther = 3,
): { char: string; kana: string; observed: VoicingClass; counts: Record<VoicingClass, number> }[] {
  const segs = segmentReading(notation, reading, unihan, {
    maxTrailing: [...notation].length === 1 ? 1 : 0,
  });
  if (!segs) return [];
  const out = [];
  let prev: string | undefined;
  for (const s of segs) {
    const cls = voicingClass(s.kana);
    if (cls) {
      // 語中（ん・っ の後以外）の清濁は連濁で語ごとに違い、統計で決まらないので見ない
      const ctx = contextOf(prev);
      const c = ctx === "other" ? undefined : stats.get(`${s.char}\t${unvoiced(s.kana)}\t${ctx}`);
      if (c && c[cls] === 0) {
        const other = (["plain", "voiced", "semi"] as const).filter((k) => k !== cls)
          .reduce((sum, k) => sum + c[k], 0);
        if (other >= minOther) out.push({ char: s.char, kana: s.kana, observed: cls, counts: c });
      }
    }
    prev = s.kana.at(-1);
  }
  return out;
}
