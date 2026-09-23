import { decode, Image } from "@matmen/imagescript";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { paths } from "./config.ts";
import type { CleanEntry, CleanVolume } from "./cleanse.ts";
import { imageFileName } from "./ndl.ts";
import { subImage } from "./recheck.ts";

/**
 * 正解率の抜き取り評価用に、候補を区分ごとに無作為に抜き取り、紙面の見出しの切り出しを
 * 並べた画像（右から左へ、縦書きの読み順）と一覧（TSV）を出力する。
 * 一覧の judgment 列に人が正誤（o / x）を記入する。
 */

export type Stratum = { name: string; filter: (e: CleanEntry) => boolean };

const plain = (r: string) => r.replaceAll(/[-ー]/g, "");
const ndlAgree = (e: CleanEntry) =>
  e.ndl !== undefined && plain(e.ndl.reading) === plain(e.source.reading.replaceAll("ー", "-"));
const voted = (e: CleanEntry) => e.fixes.some((f) => f.reason === "三系統の OCR の多数決");

/** 検証済みの辞書（メイン）の区分 */
export const STRATA: Stratum[] = [
  { name: "all", filter: (e) => e.status === "accepted" },
  { name: "L", filter: (e) => e.status === "accepted" && e.method === "L" },
  { name: "JMdict", filter: (e) => e.status === "accepted" && e.method === "JMdict" },
  {
    name: "align-ndl-agree",
    filter: (e) => e.status === "accepted" && e.method === "align" && ndlAgree(e),
  },
  {
    name: "align-other",
    filter: (e) => e.status === "accepted" && e.method === "align" && !ndlAgree(e),
  },
  { name: "dict-reading", filter: (e) => e.status === "accepted" && e.method === "dict-reading" },
  { name: "voted", filter: (e) => e.status === "accepted" && voted(e) },
  { name: "unverified", filter: (e) => e.status === "unverified" },
];

/** 種付きの乱数（mulberry32） */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sample<T>(xs: T[], n: number, seed: number): T[] {
  const rnd = random(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const PER_SHEET = 15;

async function crop(pid: string, e: CleanEntry): Promise<Image> {
  const page = await decode(
    await Deno.readFile(join(paths.imagesDir(pid), imageFileName(e.frame))),
  ) as Image;
  const x = Math.max(0, e.bbox.x - 8);
  const y = Math.max(0, e.bbox.y - 8);
  const w = Math.min(page.width - x, e.bbox.width + 16);
  const h = Math.min(page.height - y, Math.min(e.bbox.height, 330) + 16);
  return subImage(page, x, y, w, h);
}

export async function writeReview(
  volumes: CleanVolume[],
  outDir: string,
  { n, seed, strata }: { n: number; seed: number; strata: Stratum[] },
): Promise<void> {
  await ensureDir(outDir);
  const all = volumes.flatMap((v) => v.entries.map((e) => ({ pid: v.pid, e })));
  const summary: string[] = [];
  for (const s of strata) {
    const pool = all.filter(({ e }) => s.filter(e));
    const picked = sample(pool, n, seed);
    summary.push(`${s.name}\t${pool.length}\t${picked.length}`);
    const rows = ["no\tid\tskk_key\tnotation\treading\tmethod\tfixes\tjudgment"];
    for (let start = 0; start < picked.length; start += PER_SHEET) {
      const part = picked.slice(start, start + PER_SHEET);
      const crops = await Promise.all(part.map(({ pid, e }) => crop(pid, e)));
      const width = crops.reduce((s, c) => s + c.width + 6, 0);
      const height = Math.max(...crops.map((c) => c.height)) + 4;
      const sheet = new Image(width, height).fill(0xffffffff);
      // 右から左へ（縦書きの読み順）。番号は一覧の no と対応する
      let x = width;
      for (const c of crops) {
        x -= c.width + 6;
        sheet.composite(c, x, 4);
      }
      await Deno.writeFile(
        join(outDir, `${s.name}-${start / PER_SHEET + 1}.png`),
        await sheet.encode(),
      );
    }
    picked.forEach(({ e }, i) =>
      rows.push(
        [
          i + 1,
          e.id,
          e.skkKey ?? "",
          e.notation ?? "",
          e.reading,
          e.method,
          e.fixes.map((f) => `${f.from}→${f.to}`).join(" "),
          "",
        ].join("\t"),
      )
    );
    await Deno.writeTextFile(join(outDir, `${s.name}.tsv`), rows.join("\n") + "\n");
  }
  await Deno.writeTextFile(
    join(outDir, "strata.tsv"),
    "stratum\tpopulation\tsampled\n" + summary.join("\n") + "\n",
  );
}
