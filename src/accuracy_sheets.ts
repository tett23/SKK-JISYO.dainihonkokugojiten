import { decode, Image } from "@matmen/imagescript";
import { join } from "@std/path";
import { paths } from "./config.ts";
import type { Item } from "./accuracy.ts";
import { imageFileName } from "./ndl.ts";
import { subImage } from "./recheck.ts";

/** 判定用に、候補の見出しの紙面を切り出して 15 件ずつ並べた画像を出力する */
const PER_SHEET = 15;

export async function writeSheets(items: Item[], dir: string, name: string) {
  const pages = new Map<string, Image>();
  const page = async (pid: string, frame: number) => {
    const key = `${pid}/${frame}`;
    if (!pages.has(key)) {
      pages.set(
        key,
        await decode(
          await Deno.readFile(join(paths.imagesDir(pid), imageFileName(frame))),
        ) as Image,
      );
    }
    return pages.get(key)!;
  };
  for (let start = 0; start < items.length; start += PER_SHEET) {
    const crops: Image[] = [];
    for (const { pid, e } of items.slice(start, start + PER_SHEET)) {
      const p = await page(pid, e.frame);
      const x = Math.max(0, e.bbox.x - 8);
      const y = Math.max(0, e.bbox.y - 8);
      crops.push(
        subImage(
          p,
          x,
          y,
          Math.min(p.width - x, e.bbox.width + 16),
          Math.min(p.height - y, Math.min(e.bbox.height, 330) + 16),
        ),
      );
    }
    const width = crops.reduce((s, c) => s + c.width + 6, 0);
    const height = Math.max(...crops.map((c) => c.height)) + 4;
    const sheet = new Image(width, height).fill(0xffffffff);
    // 右から左へ（縦書きの読み順）。一覧の no と対応する
    let x = width;
    for (const c of crops) {
      x -= c.width + 6;
      sheet.composite(c, x, 4);
    }
    await Deno.writeFile(join(dir, `${name}-${start / PER_SHEET + 1}.png`), await sheet.encode());
    pages.clear();
  }
}
