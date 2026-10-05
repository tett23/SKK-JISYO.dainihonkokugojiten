import { expandGlob } from "@std/fs";
import { join } from "@std/path";
import { REPO_ROOT } from "./config.ts";
import type { CleanVolume } from "./cleanse.ts";

/**
 * 紙面と照合した判定（docs/accuracy/<label>/verified.tsv の judgment 列）で正しいとした見出しを、
 * 未検証から検証済みに移す（試行。JUDGED=1 のときだけ使う）。
 *
 * 判定は候補の id・SKK の見出し・表記の組に付いているので、クレンジングの変更で見出しや表記が
 * 変わった候補には使わない（判定した時点と同じ見出しのときだけ移す）
 */
export type Judgments = Set<string>;

const key = (id: string, skkKey: string, notation: string) => `${id}\t${skkKey}\t${notation}`;

export async function loadJudgments(): Promise<Judgments> {
  const out: Judgments = new Set();
  for await (const f of expandGlob(join(REPO_ROOT, "docs", "accuracy", "*", "*.tsv"))) {
    const [head, ...rows] = (await Deno.readTextFile(f.path)).split("\n");
    const h = head.split("\t");
    for (const row of rows) {
      const r = Object.fromEntries(row.split("\t").map((v, i) => [h[i], v]));
      if (r.judgment === "o" && r.id && r.skk_key) {
        out.add(key(r.id, r.skk_key, (r.notation ?? "").split("・")[0]));
      }
    }
  }
  return out;
}

/** 判定で正しいとした未検証の見出しを検証済みにする。移した数を返す */
export function applyJudgments(volume: CleanVolume, judgments: Judgments): number {
  let moved = 0;
  for (const e of volume.entries) {
    if (e.status !== "unverified" || !e.skkKey || !e.notation) continue;
    if (!judgments.has(key(e.id, e.skkKey, e.notation))) continue;
    e.status = "accepted";
    e.method = "judged";
    e.fixes.push({
      field: "modern",
      from: e.skkKey,
      to: e.skkKey,
      reason: `紙面との照合で正しいと判定（未検証の理由: ${e.reason ?? "なし"}）`,
    });
    delete e.reason;
    moved++;
  }
  return moved;
}
