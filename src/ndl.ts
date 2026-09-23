export const ndlUrls = {
  /** NDLデジタルコレクションの書誌・コンテンツ情報 */
  item: (pid: string) => `https://dl.ndl.go.jp/api/item/search/info:ndljp/pid/${pid}`,
  /** IIIF Presentation API v2 manifest */
  manifest: (pid: string) => `https://dl.ndl.go.jp/api/iiif/${pid}/manifest.json`,
  /** NDLラボ（次世代デジタルライブラリー）の資料情報 */
  labBook: (pid: string) => `https://lab.ndl.go.jp/dl/api/book/${pid}`,
  /** NDLラボの全文テキスト（NDL による OCR 結果）。存在しない資料は 403 */
  labFulltext: (pid: string) => `https://lab.ndl.go.jp/dl/api/book/fulltext-json/${pid}`,
};

export type Canvas = {
  /** コマ番号（1 始まり） */
  frame: number;
  width: number;
  height: number;
  imageUrl: string;
};

type ManifestJson = {
  sequences: {
    canvases: {
      label: string;
      width: number;
      height: number;
      images: { resource: { "@id": string } }[];
    }[];
  }[];
};

export function parseManifest(json: ManifestJson): Canvas[] {
  return json.sequences[0].canvases.map((c, i) => ({
    frame: i + 1,
    width: c.width,
    height: c.height,
    imageUrl: c.images[0].resource["@id"],
  }));
}

export const imageFileName = (frame: number) => `R${String(frame).padStart(7, "0")}.jpg`;

type ItemJson = {
  item: {
    permission: { type: string };
    rights: { code: string } | null;
  };
};

export function isInternetPublic(json: ItemJson): boolean {
  return json.item.permission.type === "internet";
}

/** NDLラボ fulltext-json の 1 コマ分 */
export type LabFulltextPage = {
  id: string;
  book: string;
  page: number;
  divide: number;
  rectX: number;
  rectY: number;
  rectW: number;
  rectH: number;
  contents: string;
  /** JSON 文字列として埋め込まれた LabCoord[] */
  coordjson: string;
};

export type LabCoord = {
  id: number;
  contenttext: string;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export function parseLabFulltext(text: string): LabFulltextPage[] {
  const json = JSON.parse(text) as { list: LabFulltextPage[] };
  return [...json.list].sort((a, b) => a.page - b.page);
}

export function parseLabCoords(coordjson: string): LabCoord[] {
  if (!coordjson) return [];
  return JSON.parse(coordjson);
}
