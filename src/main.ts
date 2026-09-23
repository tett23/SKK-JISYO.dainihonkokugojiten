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
import { ndlocrConfigFromEnv, runNdlocr } from "./ndlocr.ts";
import { buildWork, hasLabFulltext, type WorkSource } from "./work.ts";

const USAGE = `Usage: deno task <fetch|ocr|work|all> [options] [pid...]

pid を省略すると初版全4巻 (${DEFAULT_VOLUMES.map((v) => v.pid).join(", ")}) を対象にする。

fetch  NDL から書誌・IIIF manifest・NDLラボ全文テキストを取得して data/raw/ndl/<pid>/ に保存する。
       全文テキストが無い（画像のみの）資料は画像も取得する。
  --images         全文テキストがあっても画像を取得する
  --pages <a-b>    画像を取得するコマ範囲（例: 10-20）
  --force          取得済みでも再取得する
ocr    画像のみの資料に ndlocr_cli を実行し、出力を data/raw/ndlocr/<pid>/ に保存する。
  --force-ocr      NDL の全文テキストがある資料にも実行する（all では画像も取得する）
work   生データから作業用 JSON を data/work/<pid>.json に生成する。
  --source <ndl-lab-fulltext|ndlocr>  使用する生データ（既定: ndlocr の結果があれば ndlocr）
all    fetch → ocr → work を順に実行する。`;

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

async function fetchVolume(pid: string, opts: { force: boolean; images: boolean; pages?: string }) {
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

  if (ft !== "missing" && !opts.images) {
    console.log("  NDL の全文テキストがあるため画像は取得しません（--images で取得）");
    return;
  }
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
  if (!opts.forceOcr && (await hasLabFulltext(pid))) {
    console.log("  NDL の全文テキストがあるためスキップします（--force-ocr で実行）");
    return;
  }
  await runNdlocr(pid, ndlocrConfigFromEnv());
}

async function workVolume(pid: string, source?: WorkSource) {
  console.log(`[work] ${pid}`);
  const work = await buildWork(pid, source);
  const dest = paths.workJson(pid);
  await ensureDir(dirname(dest));
  await Deno.writeTextFile(dest, JSON.stringify(work, null, 2) + "\n");
  console.log(`  ${work.source.kind}: ${work.pages.length} pages -> ${dest}`);
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["force", "force-ocr", "images", "help"],
    string: ["pages", "source"],
  });
  const [command, ...rest] = args._.map(String);
  if (args.help || !command) {
    console.log(USAGE);
    Deno.exit(command ? 0 : 1);
  }
  const pids = rest.length > 0 ? rest : DEFAULT_VOLUMES.map((v) => v.pid);
  const source = args.source as WorkSource | undefined;
  if (source && source !== "ndl-lab-fulltext" && source !== "ndlocr") {
    console.error(`unknown --source: ${source}`);
    Deno.exit(1);
  }

  const opts = {
    force: args.force,
    forceOcr: args["force-ocr"],
    images: args.images,
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
      case "all":
        await fetchVolume(pid, { ...opts, images: opts.images || opts.forceOcr });
        await ocrVolume(pid, opts);
        await workVolume(pid, source);
        break;
      default:
        console.error(USAGE);
        Deno.exit(1);
    }
  }
}
