import { dirname } from "@std/path";
import { encodeHex } from "@std/encoding/hex";
import { REQUEST_INTERVAL_MS, USER_AGENT } from "./config.ts";

/** 生データと並べて `<file>.fetch.json` に保存する取得記録 */
export type FetchRecord = {
  url: string;
  status: number;
  fetchedAt: string;
  headers: Record<string, string>;
  bytes?: number;
  sha256?: string;
};

export type DownloadResult = "downloaded" | "skipped" | "missing";

const MAX_RETRIES = 5;
const DEFAULT_MISSING_STATUSES = [403, 404];

/** サーバ側のアクセス制限（WAF 等）で拒否された */
export class BlockedError extends Error {
  constructor(readonly url: string, readonly status: number) {
    super(`HTTP ${status} ${url}: アクセスが拒否されました（アクセス制限の可能性があります）`);
  }
}

let lastRequestAt = 0;

async function throttle(intervalMs: number): Promise<void> {
  const wait = lastRequestAt + intervalMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function fetchWithRetry(url: string, intervalMs: number): Promise<Response> {
  for (let attempt = 0;; attempt++) {
    await throttle(intervalMs);
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.status !== 429 && res.status < 500) return res;
      if (attempt >= MAX_RETRIES) return res;
      await res.body?.cancel();
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 2000;
      console.warn(`  HTTP ${res.status} ${url}, retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    } catch (e) {
      if (attempt >= MAX_RETRIES) throw e;
      const delay = 2 ** attempt * 2000;
      console.warn(`  ${e} ${url}, retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export const recordPath = (dest: string) => `${dest}.fetch.json`;

export async function readRecord(dest: string): Promise<FetchRecord | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(recordPath(dest)));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined;
    throw e;
  }
}

async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.part`;
  if (typeof data === "string") await Deno.writeTextFile(tmp, data);
  else await Deno.writeFile(tmp, data);
  await Deno.rename(tmp, path);
}

/**
 * url の内容を加工せずバイト列のまま dest に保存し、取得記録を `<dest>.fetch.json` に残す。
 * 取得済み（記録あり）の場合は force でない限り再取得しない。
 * missingStatuses（既定: 403, 404）は「データが存在しない」として記録し "missing" を返す。
 * それ以外の 403 はアクセス制限とみなし、記録を残さず BlockedError を投げる。
 */
export async function download(
  url: string,
  dest: string,
  { force = false, missingStatuses = DEFAULT_MISSING_STATUSES, intervalMs = REQUEST_INTERVAL_MS } =
    {},
): Promise<DownloadResult> {
  const missing = new Set(missingStatuses);
  if (!force) {
    const prev = await readRecord(dest);
    if (prev?.status === 200) return "skipped";
    if (prev && missing.has(prev.status)) return "missing";
  }

  const res = await fetchWithRetry(url, intervalMs);
  const record: FetchRecord = {
    url,
    status: res.status,
    fetchedAt: new Date().toISOString(),
    headers: Object.fromEntries(res.headers),
  };

  if (res.status === 403 && !missing.has(403)) {
    await res.body?.cancel();
    throw new BlockedError(url, res.status);
  }
  if (missing.has(res.status)) {
    await res.body?.cancel();
    await writeAtomic(recordPath(dest), JSON.stringify(record, null, 2) + "\n");
    return "missing";
  }
  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${url}: ${body.slice(0, 200)}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  record.bytes = bytes.byteLength;
  record.sha256 = encodeHex(await crypto.subtle.digest("SHA-256", bytes));
  await writeAtomic(dest, bytes);
  await writeAtomic(recordPath(dest), JSON.stringify(record, null, 2) + "\n");
  return "downloaded";
}
