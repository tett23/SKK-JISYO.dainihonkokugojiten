import { resourcePaths, type Unihan } from "./resources.ts";

/**
 * KANJIDIC2（EDRDG、CC BY-SA 4.0）の音訓と名乗り。Unihan の kJapanese は訓読みが少ない
 * （蒸 に ふか、榊 に さかき が無い）ので、読みと表記の対応付けの読みを補う。
 *
 * 訓読みの送り仮名の区切り "."（うつく.しい）は除いて一語にする（Unihan の kun と同じ形）。
 * 接頭・接尾の印 "-" の付いた読みも "-" を除いて使う。
 */
export type Kanjidic = Map<string, { on: string[]; kun: string[]; nanori: string[] }>;

const kataToHira = (s: string) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export function parseKanjidic2(xml: string): Kanjidic {
  const out: Kanjidic = new Map();
  for (const m of xml.matchAll(/<character>([\s\S]*?)<\/character>/g)) {
    const body = m[1];
    const literal = body.match(/<literal>(.*?)<\/literal>/)?.[1];
    if (!literal) continue;
    const on: string[] = [], kun: string[] = [], nanori: string[] = [];
    for (const r of body.matchAll(/<reading r_type="(ja_on|ja_kun)"[^>]*>(.*?)<\/reading>/g)) {
      const v = kataToHira(r[2]).replaceAll(/[.\-]/g, "");
      if (!/^[ぁ-ゖー]+$/.test(v)) continue;
      // 1 字の接尾・接頭の読み（生 -う、芝生 の ふ が転呼した形）は採らない。語中の は行 を
      // わ行・あ行 と読む見出し（かや-ふ を かやう）を通してしまう
      if (r[2].includes("-") && v.length === 1) continue;
      (r[1] === "ja_on" ? on : kun).push(v);
    }
    for (const r of body.matchAll(/<nanori>(.*?)<\/nanori>/g)) {
      if (/^[ぁ-ゖ]+$/.test(r[1])) nanori.push(r[1]);
    }
    out.set(literal, { on, kun, nanori });
  }
  return out;
}

export async function loadKanjidic2(): Promise<Kanjidic | undefined> {
  try {
    const gz = await Deno.readFile(resourcePaths.kanjidic2);
    const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
    return parseKanjidic2(await new Response(stream).text());
  } catch {
    return undefined;
  }
}

/** KANJIDIC2 の読みを足した Unihan を返す。nanori は名乗り（人名の読み）も足すか */
export function withKanjidic(unihan: Unihan, kd: Kanjidic, { nanori = false } = {}): Unihan {
  const readings = new Map(unihan.readings);
  const unvoiced = (k: string) =>
    k.normalize("NFD").replace(/^(.)[\u3099\u309A]/, "$1").normalize("NFC");
  for (const [ch, r] of kd) {
    const cur = readings.get(ch) ?? { on: [], kun: [] };
    const all = new Set([...cur.on, ...cur.kun, ...r.on, ...r.kun]);
    // 連濁した形の読み（造 -づくり、立 -だて）は採らない。連濁でしか対応しない読みは OCR の濁点の
    // 誤読と見分けられないので、連濁の検査（requireAgreement）を素通りさせないため
    // ぢ・づ で始まる読み（尽 -づく）は連濁した形でしかない（現代仮名遣いでは語頭に ぢ・づ を書かない）
    const notRendaku = (k: string) =>
      !/^[ぢづ]/.test(k) && (unvoiced(k) === k || !all.has(unvoiced(k)));
    readings.set(ch, {
      // 音読みも、清音の形がある濁音の形（登 ドウ）は採らない。漢語の濁点の読み分け（登記 とうき /
      // どうき）が決まらなくなる
      // KANJIDIC2 に音読みが無く訓読みだけの字（国字の用法の 喰 くう）は、Unihan の音読み（喰 を
      // 餐 の異体として さん・そん）を採らない（朝飡 を 朝喰 と誤読して ちょうそん に対応付いた）
      on: r.on.length === 0 && r.kun.length > 0
        ? []
        : [...new Set([...cur.on, ...r.on])].filter((k) => cur.on.includes(k) || notRendaku(k)),
      kun: [...new Set([...cur.kun, ...r.kun, ...(nanori ? r.nanori : [])])].filter((k) =>
        cur.kun.includes(k) || notRendaku(k)
      ),
    });
  }
  return { ...unihan, readings };
}
