import { join } from "@std/path";
import { DATA_DIR } from "./config.ts";

/**
 * 読み直しの種類。head は見出しの列の上端から 360px（読みを大きく写す）、full は見出しの列の全体
 * （表記まで写す。head では表記が切れて読めない候補の三つ目の表記を得る）
 */
export type RecheckMode = "head" | "full" | RecheckVariant;

/**
 * 多数決用の拡大方法の変種（scripts/recheck_variants.py）。head は最近傍法 2 倍。
 * 紙面と照合した 413 件で、head と 3 つの変種の多数決は head だけより有意に正しかった
 */
export const RECHECK_VARIANTS = ["bic2", "lan3", "lan3s"] as const;
export type RecheckVariant = typeof RECHECK_VARIANTS[number];

const suffix = (mode: RecheckMode) => (mode === "head" ? "" : `-${mode}`);

export const recheckPaths = {
  input: (pid: string, mode: RecheckMode = "head") =>
    join(DATA_DIR, "tmp", `recheck${suffix(mode)}-input`, pid),
  raw: (pid: string, mode: RecheckMode = "head") =>
    join(DATA_DIR, "raw", `recheck${suffix(mode)}`, pid),
  json: (pid: string, mode: RecheckMode = "head") =>
    join(DATA_DIR, `recheck${suffix(mode)}`, `${pid}.json`),
};

type RecheckReading = { text: string; reading?: string; notation?: string };

/**
 * 見出しの読み直し（head）の読みを、拡大方法を変えた読み直しとの多数決で決める。
 * 区切り（-、ー、・）は比べるときに除く。最多が同数なら head の読みを採る。
 * 変種の読み直しが無い候補は head のまま
 */
export function voteRecheck(
  head: Record<string, RecheckReading>,
  variants: Record<string, RecheckReading>[],
): Record<string, RecheckReading> {
  const bare = (r?: string) => r?.replaceAll(/[-ー・\s]/g, "") ?? "";
  const out: Record<string, RecheckReading> = {};
  for (const [id, h] of Object.entries(head)) {
    const vs = variants.map((v) => v[id]).filter((v) => v !== undefined);
    if (vs.length === 0) {
      out[id] = h;
      continue;
    }
    const all = [h, ...vs];
    const counts = new Map<string, number>();
    for (const r of all) counts.set(bare(r.reading), (counts.get(bare(r.reading)) ?? 0) + 1);
    const max = Math.max(...counts.values());
    const winners = [...counts].filter(([, n]) => n === max).map(([k]) => k);
    if (winners.length > 1 || winners[0] === bare(h.reading) || winners[0] === "") {
      out[id] = h;
      continue;
    }
    const chosen = all.find((r) => bare(r.reading) === winners[0])!;
    out[id] = { ...h, reading: chosen.reading };
  }
  return out;
}
