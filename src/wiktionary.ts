import type { Jmdict, JmForm } from "./jmdict.ts";

/**
 * Wiktionary（英語版。kaikki.org による日本語の項目の抽出、CC BY-SA 4.0）の読み込み。
 * 漢字を含む見出しの読み（ruby）と歴史的仮名遣い（hiragana・historical）を、JMdict と同じ形
 * （漢字の並び → 表記・読み・品詞）にして照合に足す。
 * JMdict に無い古語（ひめもす 終日、かんなり 雷鳴）と、古い仮名遣いから現代の読みへの対応
 * （こくくわい 國會 → こっかい、てんわう 天皇 → てんのう）を補う。
 * https://kaikki.org/dictionary/Japanese/
 */

const HAN = /[㐀-鿿豈-﫿\u{20000}-\u{2ffff}々]/u;
const KANA = /^[ぁ-ゖー]+$/;
const kataToHira = (s: string) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const skeleton = (w: string) => w.replaceAll(/[ぁ-ゖァ-ヺー]/g, "");

type Form = { form: string; tags?: string[]; ruby?: [string, string][] };
type Entry = {
  word?: string;
  pos?: string;
  forms?: Form[];
  head_templates?: { args?: Record<string, string> }[];
};

/** ruby（字 → 読み）を当てた表記から読みを作る。ruby の無い仮名はそのまま。漢字が残れば undefined */
function rubyReading(form: string, ruby: [string, string][]): string | undefined {
  let s = form;
  let out = "";
  const rest = [...ruby];
  while (s) {
    if (rest.length && s.startsWith(rest[0][0])) {
      out += rest[0][1];
      s = s.slice(rest[0][0].length);
      rest.shift();
    } else if (HAN.test(s[0])) return undefined;
    else {
      out += s[0];
      s = s.slice(1);
    }
  }
  return rest.length ? undefined : kataToHira(out);
}

export function parseWiktionary(jsonl: string): Jmdict {
  const bySkeleton = new Map<string, JmForm[]>();
  let entries = 0;
  for (const line of jsonl.split("\n")) {
    if (!line) continue;
    const x = JSON.parse(line) as Entry;
    const w = x.word ?? "";
    if (
      !HAN.test(w) || ["character", "romanization", "soft-redirect", "name"].includes(x.pos ?? "")
    ) {
      continue;
    }
    const readings: string[] = [];
    const old: string[] = [];
    const kanji = new Set([w]);
    for (const f of x.forms ?? []) {
      const t = f.tags ?? [];
      if (t.includes("canonical") && f.ruby) {
        const form = f.form.replace(" ^", "").trim();
        const r = rubyReading(form, f.ruby);
        if (r) {
          readings.push(r);
          kanji.add(form);
        }
      } else if (t.includes("historical") && t.includes("hiragana")) old.push(f.form);
      else if (t.includes("alternative") && t.includes("kanji") && HAN.test(f.form)) {
        kanji.add(f.form);
      }
    }
    const modern = [...new Set(readings)].filter((r) => KANA.test(r));
    if (modern.length === 0) continue;
    let pos = "n";
    if (x.pos === "adj") {
      // 文語の形容詞（あらあらし）は JMdict の品詞に合わないので除く
      if (!w.endsWith("い")) continue;
      pos = "adj-i";
    } else if (x.pos === "verb") {
      pos = String(x.head_templates?.[0]?.args?.type ?? "") === "2" ? "v1" : "v5";
    }
    const rs = [
      ...modern.map((reading) => ({ reading, old: false })),
      ...[...new Set(old)].filter((r) => KANA.test(r) && !modern.includes(r))
        .map((reading) => ({ reading, old: true })),
    ];
    entries++;
    for (const k of kanji) {
      const s = skeleton(k);
      if (!s) continue;
      const list = bySkeleton.get(s) ?? [];
      list.push({ kanji: k, readings: rs, pos: [pos] });
      bySkeleton.set(s, list);
    }
  }
  return { bySkeleton, entries };
}

export async function loadWiktionary(path: string): Promise<Jmdict | undefined> {
  const file = await Deno.open(path).catch(() => undefined);
  if (!file) return undefined;
  const stream = file.readable.pipeThrough(new DecompressionStream("gzip"))
    .pipeThrough(new TextDecoderStream());
  let text = "";
  for await (const chunk of stream) text += chunk;
  return parseWiktionary(text);
}

/** JMdict に Wiktionary の表記・読みを足す（同じ漢字の並びの表記の後ろに加える） */
export function withWiktionary(jm: Jmdict, wikt: Jmdict): Jmdict {
  const merged = new Map(jm.bySkeleton);
  for (const [k, forms] of wikt.bySkeleton) merged.set(k, [...(merged.get(k) ?? []), ...forms]);
  return { ...jm, bySkeleton: merged };
}
