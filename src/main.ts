import { parseArgs } from "@std/cli/parse-args";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import {
  BLOCKED_MAX_RETRIES,
  BLOCKED_WAIT_MS,
  DEFAULT_VOLUMES,
  FIRST_EDITION_YEARS,
  IMAGE_INTERVAL_MS,
  paths,
} from "./config.ts";
import { BlockedError, download } from "./http.ts";
import { imageFileName, isInternetPublic, ndlUrls, parseManifest } from "./ndl.ts";
import { ndlocrLiteConfigFromEnv, runNdlocrLite } from "./ndlocr_lite.ts";
import { extractVolume } from "./extract.ts";
import { buildWork, type WorkSource, type WorkVolume } from "./work.ts";

const USAGE = `Usage: deno task <fetch|ocr|work|extract|all> [options] [pid...]

pid を省略すると初版全4巻 (${DEFAULT_VOLUMES.map((v) => v.pid).join(", ")}) を対象にする。

fetch  NDL から書誌・IIIF manifest・NDLラボ全文テキスト・画像を取得して data/raw/ndl/<pid>/ に保存する。
  --pages <a-b>    画像を取得するコマ範囲（例: 10-20）
  --force          取得済みでも再取得する
ocr    画像に ndlocr-lite を実行し、出力を data/raw/ndlocr-lite/<pid>/ に保存する。
       OCR 済みの画像はスキップする（中断しても続きから処理する）。
  --force-ocr      既存の出力を退避し、全画像を OCR し直す
work   生データから作業用 JSON を data/work/<pid>.json に生成する。
  --source <ndl-lab-fulltext|ndlocr-lite>  使用する生データ（既定: ndlocr-lite の結果があれば ndlocr-lite）
extract  作業用 JSON から見出し語・表記の候補を data/extract/<pid>.json に抽出する。
all    fetch → ocr → work → extract を順に実行する。`;

function parsePages(s: string | undefined): ((frame: number) => boolean) | undefined {
  if (!s) return undefined;
  const ranges = s.split(",").map((r) => {
    const [a, b] = r.split("-").map(Number);
    return [a, b ?? a] as const;
  });
  return (f) => ranges.some(([a, b]) => a <= f && f <= b);
}

/** 画像を取得する。アクセス制限（403）に掛かったら時間を置いて再開する */
async function downloadImage(url: string, dest: string, force: boolean) {
  for (let attempt = 1;; attempt++) {
    try {
      return await download(url, dest, {
        force,
        missingStatuses: [404],
        intervalMs: IMAGE_INTERVAL_MS,
      });
    } catch (e) {
      if (!(e instanceof BlockedError) || attempt > BLOCKED_MAX_RETRIES) throw e;
      console.warn(
        `  ${e.message}。${
          BLOCKED_WAIT_MS / 60_000
        }分待って再開します (${attempt}/${BLOCKED_MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, BLOCKED_WAIT_MS));
    }
  }
}

async function fetchVolume(pid: string, opts: { force: boolean; pages?: string }) {
  const force = opts.force;
  console.log(`[fetch] ${pid}`);
  // 初版以外が混入しないよう、刊行年を確認してから他のデータを取得する
  const bookResult = await download(ndlUrls.labBook(pid), paths.labBookJson(pid), { force });
  if (bookResult === "missing") throw new Error(`${pid}: ${ndlUrls.labBook(pid)} が取得できません`);
  const book = JSON.parse(await Deno.readTextFile(paths.labBookJson(pid)));
  if (
    !(FIRST_EDITION_YEARS.min <= book.publishyear && book.publishyear <= FIRST_EDITION_YEARS.max)
  ) {
    await Deno.remove(paths.rawNdl(pid), { recursive: true });
    throw new Error(
      `${pid}: 刊行年 ${book.publishyear} は初版 (${FIRST_EDITION_YEARS.min}-${FIRST_EDITION_YEARS.max}) の範囲外のため取得しません`,
    );
  }
  console.log(`  ${bookResult}: ${paths.labBookJson(pid)}`);

  for (
    const [url, dest] of [
      [ndlUrls.item(pid), paths.itemJson(pid)],
      [ndlUrls.manifest(pid), paths.manifestJson(pid)],
    ] as const
  ) {
    const r = await download(url, dest, { force });
    if (r === "missing") throw new Error(`${pid}: ${url} が取得できません`);
    console.log(`  ${r}: ${dest}`);
  }

  const item = JSON.parse(await Deno.readTextFile(paths.itemJson(pid)));
  if (!isInternetPublic(item)) {
    throw new Error(`${pid}: インターネット公開資料ではありません (${item.item.permission.type})`);
  }

  const ft = await download(ndlUrls.labFulltext(pid), paths.labFulltextJson(pid), { force });
  console.log(`  fulltext ${ft}: ${paths.labFulltextJson(pid)}`);

  const inRange = parsePages(opts.pages) ?? (() => true);
  const canvases = parseManifest(JSON.parse(await Deno.readTextFile(paths.manifestJson(pid))))
    .filter((c) => inRange(c.frame));
  await ensureDir(paths.imagesDir(pid));
  for (const [i, c] of canvases.entries()) {
    const dest = join(paths.imagesDir(pid), imageFileName(c.frame));
    const r = await downloadImage(c.imageUrl, dest, force);
    if (r === "missing") throw new Error(`${pid}: 画像が取得できません ${c.imageUrl}`);
    if (r === "downloaded") console.log(`  image ${i + 1}/${canvases.length}: ${dest}`);
  }
}

async function ocrVolume(pid: string, opts: { forceOcr: boolean }) {
  console.log(`[ocr] ${pid}`);
  await runNdlocrLite(pid, ndlocrLiteConfigFromEnv(), { force: opts.forceOcr });
}

async function workVolume(pid: string, source?: WorkSource) {
  console.log(`[work] ${pid}`);
  const work = await buildWork(pid, source);
  const dest = paths.workJson(pid);
  await ensureDir(dirname(dest));
  await Deno.writeTextFile(dest, JSON.stringify(work, null, 2) + "\n");
  console.log(`  ${work.source.kind}: ${work.pages.length} pages -> ${dest}`);
}

async function extractStep(pid: string) {
  console.log(`[extract] ${pid}`);
  const work: WorkVolume = JSON.parse(await Deno.readTextFile(paths.workJson(pid)));
  const result = extractVolume(work);
  const dest = paths.extractJson(pid);
  await ensureDir(dirname(dest));
  await Deno.writeTextFile(dest, JSON.stringify(result, null, 2) + "\n");
  const kinds = Object.entries(Object.groupBy(result.candidates, (c) => c.notationKind))
    .map(([k, v]) => `${k}=${v?.length}`).join(" ");
  console.log(`  ${result.candidates.length} candidates (${kinds}) -> ${dest}`);
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["force", "force-ocr", "help"],
    string: ["pages", "source"],
  });
  const [command, ...rest] = args._.map(String);
  if (args.help || !command) {
    console.log(USAGE);
    Deno.exit(command ? 0 : 1);
  }
  const pids = rest.length > 0 ? rest : DEFAULT_VOLUMES.map((v) => v.pid);
  const source = args.source as WorkSource | undefined;
  if (source && source !== "ndl-lab-fulltext" && source !== "ndlocr-lite") {
    console.error(`unknown --source: ${source}`);
    Deno.exit(1);
  }

  const opts = {
    force: args.force,
    forceOcr: args["force-ocr"],
    pages: args.pages,
  };
  for (const pid of pids) {
    switch (command) {
      case "fetch":
        await fetchVolume(pid, opts);
        break;
      case "ocr":
        await ocrVolume(pid, opts);
        break;
      case "work":
        await workVolume(pid, source);
        break;
      case "extract":
        await extractStep(pid);
        break;
      case "all":
        await fetchVolume(pid, opts);
        await ocrVolume(pid, opts);
        await workVolume(pid, source);
        await extractStep(pid);
        break;
      default:
        console.error(USAGE);
        Deno.exit(1);
    }
  }
}
