import { fromFileUrl, join } from "@std/path";

export type Volume = {
  pid: string;
  label: string;
};

/**
 * 『大日本国語辞典』初版（上田万年・松井簡治 著、金港堂書籍、1915-1919）。
 * NDLデジタルコレクションでインターネット公開（保護期間満了）されている4冊。
 */
export const DEFAULT_VOLUMES: Volume[] = [
  { pid: "954645", label: "第1巻 あ〜き (1915)" },
  { pid: "954646", label: "第2巻 く〜し (1916)" },
  { pid: "954647", label: "第3巻 す〜な (1917)" },
  { pid: "954648", label: "第4巻 に〜ん (1919)" },
];

/** 初版の刊行年。修訂版（1939-41）や索引巻などが混入しないよう、この範囲外の資料は取得しない */
export const FIRST_EDITION_YEARS = { min: 1915, max: 1919 };

const ROOT = fromFileUrl(new URL("..", import.meta.url));

export const DATA_DIR = Deno.env.get("DATA_DIR") ?? join(ROOT, "data");

export const paths = {
  /** NDL から取得したデータをそのまま保存するディレクトリ */
  rawNdl: (pid: string) => join(DATA_DIR, "raw", "ndl", pid),
  itemJson: (pid: string) => join(paths.rawNdl(pid), "item.json"),
  manifestJson: (pid: string) => join(paths.rawNdl(pid), "manifest.json"),
  labBookJson: (pid: string) => join(paths.rawNdl(pid), "lab-book.json"),
  labFulltextJson: (pid: string) => join(paths.rawNdl(pid), "lab-fulltext.json"),
  imagesDir: (pid: string) => join(paths.rawNdl(pid), "images"),
  /** ndlocr-lite の出力（画像ごとの xml/json/txt）をそのまま保存するディレクトリ */
  rawNdlocrLite: (pid: string) => join(DATA_DIR, "raw", "ndlocr-lite", pid),
  /** ndlocr-lite の入力用（未処理の画像へのハードリンク） */
  ndlocrLiteInput: (pid: string) => join(DATA_DIR, "tmp", "ndlocr-lite-input", pid),
  workJson: (pid: string) => join(DATA_DIR, "work", `${pid}.json`),
  /** 見出し語・表記の候補 */
  extractJson: (pid: string) => join(DATA_DIR, "extract", `${pid}.json`),
};

export const USER_AGENT = Deno.env.get("NDL_USER_AGENT") ??
  "SKK-JISYO.dainihonkokugojisyo/0.1 (+https://github.com/tett23/SKK-JISYO.dainihonkokugojisyo)";

/** NDL へのリクエスト間隔（ミリ秒）。サーバ負荷を避けるため逐次かつ間隔を空けて取得する。 */
export const REQUEST_INTERVAL_MS = Number(Deno.env.get("NDL_REQUEST_INTERVAL_MS") ?? "1000");

/** IIIF 画像のリクエスト間隔（ミリ秒）。1〜3 秒間隔では約130件でアクセス制限（403）に掛かったため長めにする。 */
export const IMAGE_INTERVAL_MS = Number(Deno.env.get("NDL_IMAGE_INTERVAL_MS") ?? "6000");

/** アクセス制限（403）に掛かったときに待つ時間（ミリ秒）と、再開を試みる回数 */
export const BLOCKED_WAIT_MS = Number(Deno.env.get("NDL_BLOCKED_WAIT_MS") ?? String(15 * 60_000));
export const BLOCKED_MAX_RETRIES = 8;
