import { decode, Image } from "@matmen/imagescript";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import { paths, REPO_ROOT } from "./config.ts";
import type { CleanEntry, CleanVolume } from "./cleanse.ts";
import { parseHead } from "./extract.ts";
import { imageFileName } from "./ndl.ts";
import { type NdlocrLiteConfig, parseNdlocrXml, runOcr } from "./ndlocr_lite.ts";

/**
 * 見出しの読み直し（第三系統の OCR）。
 *
 * 紙面全体を OCR すると見出しの文字が小さく、濁点の有無（くん/ぐん）や語頭の文字を誤りやすい。
 * 見出しの列だけを切り出して拡大し、ndlocr-lite で読み直した結果を、ndlocr-lite（紙面全体）と
 * NDL 側 OCR に次ぐ三つ目の読みとしてクレンジングで使う。
 */

import {
  RECHECK_VARIANTS,
  type RecheckMode,
  recheckPaths,
  type RecheckVariant,
} from "./recheck_paths.ts";
export { RECHECK_VARIANTS, type RecheckMode, recheckPaths, type RecheckVariant };

export type RecheckResult = {
  /** 切り出した列を読み順につないだテキスト */
  text: string;
  reading?: string;
  notation?: string;
};

export type RecheckVolume = {
  schemaVersion: 1;
  pid: string;
  results: Record<string, RecheckResult>;
};

const plain = (r: string) => r.replaceAll(/[-ー・]/g, "");

/**
 * 読み直しの対象。ndlocr-lite（紙面全体）と NDL 側 OCR の読みが一致しない（または対応が無い）
 * 候補と、Unihan での対応付けで系統間の一致が足りずに未検証にした候補（除外は対象外）。
 * 比べるのは OCR されたままの読み（source）。クレンジングで NDL 側の読みを採用した後の読みと
 * 比べると、二系統が食い違っていた候補が対象から漏れる
 */
export function needsRecheck(e: CleanEntry): boolean {
  if (e.status === "excluded") return false;
  // Unihan での対応付けで、系統間の一致が足りずに未検証にした候補も、三つ目の読みを得るために読み直す
  if (e.reason?.startsWith("align-")) return true;
  if (!e.ndl) return true;
  return plain(e.ndl.reading) !== plain(e.source.reading);
}

/** 画像の一部を新しい画像に写す（元の画像全体を複製しない） */
export function subImage(src: Image, x: number, y: number, w: number, h: number): Image {
  const out = new Image(w, h);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * src.width + x) * 4;
    out.bitmap.set(src.bitmap.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}

const CROP = { padX: 8, padTop: 14, padBottom: 8, maxHeight: 360, scale: 2, margin: 60 };

/** 対象の候補の見出しの列を切り出して拡大し、PNG で保存する。作成済みのものは飛ばす */
export async function makeCrops(
  pid: string,
  entries: CleanEntry[],
  mode: RecheckMode = "head",
): Promise<number> {
  const dir = recheckPaths.input(pid, mode);
  const done = recheckPaths.raw(pid, mode);
  const maxHeight = mode === "head" ? CROP.maxHeight : Infinity;
  await ensureDir(dir);
  const byFrame = Map.groupBy(entries, (e) => e.frame);
  let count = 0;
  for (const [frame, list] of byFrame) {
    const todo = [];
    for (const e of list) {
      if (await exists(join(done, `${e.id}.xml`))) continue;
      if (await exists(join(dir, `${e.id}.png`))) {
        count++;
        continue;
      }
      todo.push(e);
    }
    if (todo.length === 0) continue;
    const page = await decode(
      await Deno.readFile(join(paths.imagesDir(pid), imageFileName(frame))),
    ) as Image;
    for (const e of todo) {
      const x = Math.max(0, e.bbox.x - CROP.padX);
      const y = Math.max(0, e.bbox.y - CROP.padTop);
      const w = Math.min(page.width - x, e.bbox.width + CROP.padX * 2);
      const h = Math.min(
        page.height - y,
        Math.min(e.bbox.height, maxHeight) + CROP.padTop + CROP.padBottom,
      );
      const crop = subImage(page, x, y, w, h).resize(w * CROP.scale, h * CROP.scale);
      const canvas = new Image(crop.width + CROP.margin * 2, crop.height + CROP.margin * 2)
        .fill(0xffffffff)
        .composite(crop, CROP.margin, CROP.margin);
      await Deno.writeFile(join(dir, `${e.id}.png`), await canvas.encode());
      count++;
    }
  }
  return count;
}

/** 切り出した画像を OCR する（OCR 済みは makeCrops の時点で除かれている） */
export async function ocrCrops(
  pid: string,
  count: number,
  config: NdlocrLiteConfig,
  mode: RecheckMode = "head",
) {
  if (count === 0) return;
  const output = recheckPaths.raw(pid, mode);
  await ensureDir(output);
  await runOcr(recheckPaths.input(pid, mode), output, count, config);
  await Deno.remove(recheckPaths.input(pid, mode), { recursive: true });
}

/** 列の OCR 結果（上から下へつなぐ）から見出しを読む */
export function readHead(xml: string): RecheckResult {
  const lines = parseNdlocrXml(xml).flatMap((p) => p.lines)
    // 1 列だけを切り出しているので、中心が最も多く重なる列の行を上から順につなぐ
    .sort((a, b) => a.y - b.y);
  const text = lines.map((l) => l.text).join("");
  const head = parseHead(text);
  if (head) return { text, reading: head.reading, notation: head.notation };
  const kana = text.replaceAll(/\s/g, "").match(/^[ぁ-ゖゝゞー\-－‐・]+/)?.[0];
  return { text, reading: kana || undefined };
}

export async function collectResults(
  pid: string,
  mode: RecheckMode = "head",
): Promise<RecheckVolume> {
  const dir = recheckPaths.raw(pid, mode);
  const results: Record<string, RecheckResult> = {};
  if (await exists(dir)) {
    for await (const f of Deno.readDir(dir)) {
      if (!f.name.endsWith(".xml")) continue;
      results[f.name.replace(/\.xml$/, "")] = readHead(await Deno.readTextFile(join(dir, f.name)));
    }
  }
  return { schemaVersion: 1, pid, results };
}

export function targets(volume: CleanVolume, mode: RecheckMode = "head"): CleanEntry[] {
  // full は、系統間で読みか表記が一致しないか、連濁・半濁点を読み分けられずに未検証にした候補だけを読み直す
  return mode === "head"
    ? volume.entries.filter(needsRecheck)
    : volume.entries.filter((e) =>
      e.reason === "align-single-notation" || e.reason === "align-single-reading" ||
      e.reason === "align-rendaku" || e.reason === "align-handakuten"
    );
}

/** 多数決の対象。Unihan での対応付けに頼る候補で、読みに濁音・半濁音を含み、読み直し（head）があるもの */
export function variantTargets(
  volume: CleanVolume,
  head: Record<string, RecheckResult>,
): CleanEntry[] {
  return volume.entries.filter((e) =>
    head[e.id] !== undefined &&
    (e.method === "align" || /^(align-|voicing)/.test(e.reason ?? "")) &&
    /[がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ]/.test(e.reading)
  );
}

/** ndlocr-lite の Python（PIL を含む）。NDLOCR_LITE_PYTHON か、ndlocr-lite のスクリプトの shebang から決める */
async function ndlocrPython(): Promise<string> {
  const env = Deno.env.get("NDLOCR_LITE_PYTHON");
  if (env) return env;
  const { stdout } = await new Deno.Command("which", { args: ["ndlocr-lite"] }).output();
  const script = new TextDecoder().decode(stdout).trim();
  const first = (await Deno.readTextFile(script)).split("\n")[0];
  if (!first.startsWith("#!")) {
    throw new Error("ndlocr-lite の Python が分からない（NDLOCR_LITE_PYTHON を設定する）");
  }
  return first.slice(2).trim();
}

/** 変種ごとの切り出しを作る（読み直し済みは飛ばす）。変種ごとの枚数を返す */
export async function makeVariantCrops(
  pid: string,
  entries: CleanEntry[],
): Promise<Record<RecheckVariant, number>> {
  const counts = Object.fromEntries(RECHECK_VARIANTS.map((v) => [v, 0])) as Record<
    RecheckVariant,
    number
  >;
  const jobs: string[] = [];
  for (const [frame, list] of Map.groupBy(entries, (e) => e.frame)) {
    const out: Record<string, string> = {};
    const items = [];
    for (const e of list) {
      let needed = false;
      for (const v of RECHECK_VARIANTS) {
        if (await exists(join(recheckPaths.raw(pid, v), `${e.id}.xml`))) continue;
        out[v] = recheckPaths.input(pid, v);
        needed = true;
        counts[v]++;
      }
      if (needed) items.push({ id: e.id, bbox: e.bbox });
    }
    if (items.length === 0) continue;
    jobs.push(JSON.stringify({
      page: join(paths.imagesDir(pid), imageFileName(frame)),
      items,
      out,
    }));
  }
  if (jobs.length === 0) return counts;
  const child = new Deno.Command(await ndlocrPython(), {
    args: [join(REPO_ROOT, "scripts", "recheck_variants.py")],
    stdin: "piped",
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(jobs.join("\n") + "\n"));
  await w.close();
  const status = await child.status;
  if (!status.success) throw new Error("recheck_variants.py が失敗した");
  return counts;
}
