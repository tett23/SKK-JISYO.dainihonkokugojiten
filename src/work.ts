import { relative } from "@std/path";
import { DATA_DIR, paths } from "./config.ts";
import { type FetchRecord, readRecord } from "./http.ts";
import { type Canvas, parseLabCoords, parseLabFulltext, parseManifest } from "./ndl.ts";
import { findLatestNdlocrXml, parseNdlocrXml } from "./ndlocr.ts";

export type WorkLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  conf?: number;
  /** ndlocr_cli の行種別（本文、キャプション等） */
  type?: string;
};

export type WorkPage = {
  /** コマ番号（IIIF canvas の 1 始まりの連番。見開き 1 コマに 2 ページ分を含むことがある） */
  frame: number;
  /** ndlocr_cli がノド元分割した場合の画像名 */
  imageName?: string;
  width?: number;
  height?: number;
  imageUrl?: string;
  text: string;
  /**
   * 認識単位ごとのテキストと座標（画像ピクセル座標）。
   * ndl-lab-fulltext では NDL の OCR が返す行（段をまたいで読み順が乱れることがある）、ndlocr では行。
   */
  lines: WorkLine[];
};

export type WorkSource = "ndl-lab-fulltext" | "ndlocr";

export type WorkVolume = {
  schemaVersion: 1;
  pid: string;
  title: string;
  volume: string;
  generatedAt: string;
  source: {
    kind: WorkSource;
    /** DATA_DIR からの相対パス */
    rawPath: string;
    sha256?: string;
  };
  pages: WorkPage[];
};

type LabBook = { title: string; volume: string };

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path));
}

export async function hasLabFulltext(pid: string): Promise<boolean> {
  return (await readRecord(paths.labFulltextJson(pid)))?.status === 200;
}

async function fromLabFulltext(pid: string, canvases: Map<number, Canvas>) {
  const record = (await readRecord(paths.labFulltextJson(pid))) as FetchRecord;
  const pages = parseLabFulltext(await Deno.readTextFile(paths.labFulltextJson(pid))).map(
    (p): WorkPage => {
      const c = canvases.get(p.page);
      return {
        frame: p.page,
        width: c?.width,
        height: c?.height,
        imageUrl: c?.imageUrl,
        text: p.contents,
        lines: parseLabCoords(p.coordjson).map((t) => ({
          text: t.contenttext,
          x: t.xmin,
          y: t.ymin,
          width: t.xmax - t.xmin,
          height: t.ymax - t.ymin,
        })),
      };
    },
  );
  return { rawPath: paths.labFulltextJson(pid), sha256: record.sha256, pages };
}

async function fromNdlocr(pid: string, canvases: Map<number, Canvas>) {
  const xmlPath = await findLatestNdlocrXml(pid);
  if (!xmlPath) {
    throw new Error(`${pid}: ndlocr_cli の出力 XML が見つかりません。ocr を先に実行してください`);
  }
  const pages = parseNdlocrXml(await Deno.readTextFile(xmlPath)).map((p): WorkPage => {
    const frame = Number(p.imageName.match(/R(\d{7})/)?.[1] ?? NaN);
    return {
      frame,
      imageName: p.imageName,
      width: p.width,
      height: p.height,
      imageUrl: canvases.get(frame)?.imageUrl,
      text: p.lines.map((l) => l.text).join("\n"),
      lines: p.lines.map(({ text, x, y, width, height, conf, type }) => ({
        text,
        x,
        y,
        width,
        height,
        conf,
        type,
      })),
    };
  });
  return { rawPath: xmlPath, sha256: undefined, pages };
}

/**
 * 生データから作業用 JSON を生成する。
 * source 未指定時は ndlocr_cli の結果があればそれを、なければ NDLラボの全文テキストを使う。
 */
export async function buildWork(pid: string, source?: WorkSource): Promise<WorkVolume> {
  const book = await readJson<LabBook>(paths.labBookJson(pid));
  const canvases = new Map(
    parseManifest(await readJson(paths.manifestJson(pid))).map((c) => [c.frame, c]),
  );

  const kind: WorkSource = source ??
    ((await findLatestNdlocrXml(pid))
      ? "ndlocr"
      : (await hasLabFulltext(pid))
      ? "ndl-lab-fulltext"
      : "ndlocr");
  const { rawPath, sha256, pages } = kind === "ndlocr"
    ? await fromNdlocr(pid, canvases)
    : await fromLabFulltext(pid, canvases);

  return {
    schemaVersion: 1,
    pid,
    title: book.title,
    volume: book.volume,
    generatedAt: new Date().toISOString(),
    source: { kind, rawPath: relative(DATA_DIR, rawPath), sha256 },
    pages,
  };
}
