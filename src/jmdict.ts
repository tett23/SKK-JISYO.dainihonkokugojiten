/**
 * JMdict（Electronic Dictionary Research and Development Group, CC BY-SA 4.0）の読み込み。
 * 漢字表記 → 現代の読みと品詞の照合、古い仮名遣いの読み（&ok;）→ 現代の読みの対応に使う。
 * https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project
 */

export type JmReading = {
  reading: string;
  /** 古い仮名遣い・古い表記の読み（re_inf が &ok;） */
  old: boolean;
};

export type JmForm = {
  /** 漢字表記（keb）。送り仮名を含む（驚かす） */
  kanji: string;
  readings: JmReading[];
  /** 品詞（&v5k; → "v5k" など） */
  pos: string[];
};

export type Jmdict = {
  /** 送り仮名を除いた漢字の並び（驚かす → 驚）→ 表記 */
  bySkeleton: Map<string, JmForm[]>;
  entries: number;
};

const skeleton = (w: string) => w.replaceAll(/[ぁ-ゖァ-ヺー]/g, "");

const tags = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map((m) => m[1]);

export function parseJmdict(xml: string): Jmdict {
  const bySkeleton = new Map<string, JmForm[]>();
  let entries = 0;
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    entries++;
    const body = m[1];
    const kebs = [...body.matchAll(/<k_ele>([\s\S]*?)<\/k_ele>/g)].map((k) => tags(k[1], "keb")[0]);
    if (kebs.length === 0) continue;
    const rebs = [...body.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/g)].map((r) => ({
      reading: tags(r[1], "reb")[0],
      restr: tags(r[1], "re_restr"),
      old: /<re_inf>&ok;<\/re_inf>/.test(r[1]),
      noKanji: /<re_nokanji\/>/.test(r[1]),
    }));
    const pos = [...new Set(tags(body, "pos").map((p) => p.replace(/^&|;$/g, "")))];
    for (const kanji of kebs) {
      const readings = rebs
        .filter((r) => !r.noKanji && (r.restr.length === 0 || r.restr.includes(kanji)))
        .map(({ reading, old }) => ({ reading, old }));
      const s = skeleton(kanji);
      if (!s) continue;
      const list = bySkeleton.get(s) ?? [];
      list.push({ kanji, readings, pos });
      bySkeleton.set(s, list);
    }
  }
  return { bySkeleton, entries };
}

export async function loadJmdict(path: string): Promise<Jmdict> {
  const file = await Deno.open(path);
  const stream = file.readable.pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new TextDecoderStream());
  let xml = "";
  for await (const chunk of stream) xml += chunk;
  return parseJmdict(xml);
}

export const isVerbPos = (p: string) => /^v(1|5|k|z|s-i|r|n|2|4)/.test(p) && p !== "vs";
export const isAdjectivePos = (p: string) => p === "adj-i" || p === "adj-ix";
