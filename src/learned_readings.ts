import { segmentReading } from "./align.ts";
import type { Jmdict } from "./jmdict.ts";
import type { SkkDict, Unihan } from "./resources.ts";

/**
 * L・JMdict の語から、Unihan の音訓に無い字の読みを学習する。
 *
 * Unihan の kJapanese は訓読みが少なく（蒸 に ふか、美 に よし が無い）、和語の見出しの多くが
 * 読みと表記を対応付けられずに未検証になる。次の 2 つの形で読みを取り出し、根拠の語が
 * minWords 語以上ある読みだけを採る（1 語だけの読みは熟字訓や当て字のことが多い）。
 *
 * - 漢字 1 字 + 送り仮名の語: 蒸かす ふかす → 蒸 ふか
 * - 漢字だけの語で、1 字を除く字の読みが Unihan で決まり、残りの字の読みが一通りに決まるもの
 */
export function learnReadings(
  L: SkkDict,
  jm: Jmdict | undefined,
  unihan: Unihan,
  minWords = 3,
): Map<string, string[]> {
  const HAN = /^\p{Script=Han}$/u;
  const learned = new Map<string, Map<string, Set<string>>>();
  const add = (ch: string, kana: string, word: string) => {
    // 小書きの字・ん で始まる読みや長い読みは、区切り方の誤りなので採らない
    if (!/^[ぁ-ゖ]{1,4}$/.test(kana) || /^[ぁぃぅぇぉゃゅょっんゎ]/.test(kana)) return;
    const known = unihan.readings.get(ch);
    if (known && [...known.on, ...known.kun].includes(kana)) return;
    const m = learned.get(ch) ?? new Map<string, Set<string>>();
    const s = m.get(kana) ?? new Set<string>();
    s.add(word);
    m.set(kana, s);
    learned.set(ch, m);
  };

  const pairs: [string, string][] = [];
  for (const forms of jm?.bySkeleton.values() ?? []) {
    for (const f of forms) for (const r of f.readings) if (!r.old) pairs.push([f.kanji, r.reading]);
  }
  for (const [r, ws] of L.okuriNasi) for (const w of ws) pairs.push([w, r]);

  for (const [w, r] of pairs) {
    const m = w.match(/^(\p{Script=Han})([ぁ-ゖ]+)$/u);
    if (m && r.endsWith(m[2]) && r.length > m[2].length) add(m[1], r.slice(0, -m[2].length), w);
  }
  for (const [w, r] of pairs) {
    const chars = [...w];
    if (chars.length < 2 || chars.length > 4 || !chars.every((c) => HAN.test(c))) continue;
    if (segmentReading(w, r, unihan, { maxTrailing: 0 })) continue;
    for (let i = 0; i < chars.length; i++) {
      const pre = chars.slice(0, i).join("");
      const post = chars.slice(i + 1).join("");
      const found: string[] = [];
      for (let a = 0; a <= r.length; a++) {
        if (pre ? !segmentReading(pre, r.slice(0, a), unihan, { maxTrailing: 0 }) : a !== 0) {
          continue;
        }
        for (let b = a + 1; b <= Math.min(r.length, a + 4); b++) {
          if (
            post ? segmentReading(post, r.slice(b), unihan, { maxTrailing: 0 }) : b === r.length
          ) {
            found.push(r.slice(a, b));
          }
        }
      }
      if (found.length === 1) add(chars[i], found[0], w);
    }
  }

  const out = new Map<string, string[]>();
  for (const [ch, m] of learned) {
    const rs = [...m].filter(([, ws]) => ws.size >= minWords).map(([k]) => k);
    if (rs.length) out.set(ch, rs);
  }
  return out;
}

/** 学習した読みを訓読みとして足した Unihan を返す（元の Unihan は変えない） */
export function withLearnedReadings(unihan: Unihan, learned: Map<string, string[]>): Unihan {
  const readings = new Map(unihan.readings);
  for (const [ch, rs] of learned) {
    const r = readings.get(ch) ?? { on: [], kun: [] };
    readings.set(ch, { on: r.on, kun: [...r.kun, ...rs] });
  }
  return { ...unihan, readings };
}
