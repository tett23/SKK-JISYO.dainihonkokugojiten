import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  describeDraw,
  detectableRate,
  drawMany,
  replaceSection,
  seedsUsedElsewhere,
  wilson,
  writeSampleMeta,
} from "./accuracy.ts";

Deno.test("wilson: 95% の Wilson スコア区間", () => {
  const [lo, hi] = wilson(448, 450);
  assertAlmostEquals(lo, 0.984, 0.001);
  assertAlmostEquals(hi, 0.999, 0.001);
  const [lo2, hi2] = wilson(250, 450);
  assertAlmostEquals(lo2, 0.509, 0.001);
  assertAlmostEquals(hi2, 0.601, 0.001);
  assertEquals(wilson(0, 0), [0, 1]);
});

Deno.test("drawMany: シード値ごとに等分して抜き取り、重複を除いて件数をそろえる", () => {
  const pool = Array.from({ length: 50 }, (_, i) => ({ pid: "x", e: { id: `id${i}` } }));
  // deno-lint-ignore no-explicit-any
  const got = drawMany(pool as any, 30, [1, 2, 3]);
  assertEquals(got.length, 30);
  assertEquals(new Set(got.map((x) => x.e.id)).size, 30);
  // 同じシード値なら同じ抜き取り
  // deno-lint-ignore no-explicit-any
  assertEquals(drawMany(pool as any, 30, [1, 2, 3]), got);
});

Deno.test("replaceSection: ラベルごとの区間を置き換え、無ければ先頭に加える", () => {
  const empty = "a\n<!-- accuracy:start -->\n<!-- accuracy:end -->\nb\n";
  const v1 = replaceSection(empty, "one\n", "v1");
  assertEquals(
    v1,
    "a\n<!-- accuracy:start -->\n\n<!-- accuracy:v1:start -->\n\n### v1\n\none\n\n<!-- accuracy:v1:end -->\n\n<!-- accuracy:end -->\nb\n",
  );
  const v2 = replaceSection(v1, "two\n", "v2");
  assertEquals(v2.indexOf("### v2") < v2.indexOf("### v1"), true);
  const v1b = replaceSection(v2, "ONE\n", "v1");
  assertEquals(v1b.includes("one"), false);
  assertEquals(v1b.includes("ONE") && v1b.includes("two"), true);
  // 置き換えても区間の数は変わらない
  assertEquals(v1b.split("### ").length, 3);
});

Deno.test("seedsUsedElsewhere: ほかのラベルで使ったシード値だけを返す", async () => {
  const docsDir = await Deno.makeTempDir();
  try {
    const meta = (seeds: number[], sampledAt: string) => ({ n: 450, seeds, sampledAt });
    await writeSampleMeta(docsDir, "v1", meta([101, 202], "2026-01-01T00:00:00Z"));
    await writeSampleMeta(docsDir, "v2", meta([7], "2026-02-01T00:00:00Z"));
    assertEquals(await seedsUsedElsewhere(docsDir, "v3", [202, 9]), [{
      label: "v1",
      seeds: [202],
    }]);
    // 同じラベルでの抜き取り直しは拒まない
    assertEquals(await seedsUsedElsewhere(docsDir, "v1", [101, 202]), []);
  } finally {
    await Deno.remove(docsDir, { recursive: true });
  }
});

Deno.test("detectableRate: 50 件なら約 4.5%、230 件なら約 1%", () => {
  assertAlmostEquals(detectableRate(50), 0.045, 0.001);
  assertAlmostEquals(detectableRate(230), 0.01, 0.0005);
});

Deno.test("describeDraw: シード値ごとの件数を書く", () => {
  const meta = (seeds: number[]) => ({ n: 450, seeds, sampledAt: "" });
  assertEquals(
    describeDraw(meta([101, 202, 303])),
    "450 件（150 件ずつ 3 回、シード値 101、202、303）",
  );
  assertEquals(describeDraw(meta([42])), "450 件（シード値 42）");
});
