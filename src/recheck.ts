import { decode, Image } from "@matmen/imagescript";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import { DATA_DIR, paths } from "./config.ts";
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

export const recheckPaths = {
  input: (pid: string) => join(DATA_DIR, "tmp", "recheck-input", pid),
  raw: (pid: string) => join(DATA_DIR, "raw", "recheck", pid),
};

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

const plain = (r: string) => r.replaceAll(/[-ー]/g, "");

/**
 * 読み直しの対象。NDL 側 OCR と読みが一致しない（または対応が無い）候補で、
 * 検証済みか未検証のもの（除外は対象外）
 */
export function needsRecheck(e: CleanEntry): boolean {
  if (e.status === "excluded") return false;
  if (!e.ndl) return true;
  return plain(e.ndl.reading) !== plain(e.reading);
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
export async function makeCrops(pid: string, entries: CleanEntry[]): Promise<number> {
  const dir = recheckPaths.input(pid);
  const done = recheckPaths.raw(pid);
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
        Math.min(e.bbox.height, CROP.maxHeight) + CROP.padTop + CROP.padBottom,
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
export async function ocrCrops(pid: string, count: number, config: NdlocrLiteConfig) {
  if (count === 0) return;
  const output = recheckPaths.raw(pid);
  await ensureDir(output);
  await runOcr(recheckPaths.input(pid), output, count, config);
  await Deno.remove(recheckPaths.input(pid), { recursive: true });
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

export async function collectResults(pid: string): Promise<RecheckVolume> {
  const dir = recheckPaths.raw(pid);
  const results: Record<string, RecheckResult> = {};
  if (await exists(dir)) {
    for await (const f of Deno.readDir(dir)) {
      if (!f.name.endsWith(".xml")) continue;
      results[f.name.replace(/\.xml$/, "")] = readHead(await Deno.readTextFile(join(dir, f.name)));
    }
  }
  return { schemaVersion: 1, pid, results };
}

export function targets(volume: CleanVolume): CleanEntry[] {
  return volume.entries.filter(needsRecheck);
}
