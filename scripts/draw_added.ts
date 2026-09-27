/**
 * 字音による検証で L 除外辞書に増えた見出しだけから抜き取る（試行の評価用）。
 * 母集団: 現在の L 除外辞書に入る候補のうち、登録する（見出し, 表記）の組がどれも v1.0.7 の L 除外辞書に無いもの
 * 使い方: deno run -A scripts/draw_added.ts <v1.0.7 の noL（utf-8）> <n> <seed> <label> [--images]
 */
const ROOT = new URL("../", import.meta.url).href;
const { paths } = await import(ROOT + "src/config.ts");
const { inNoL } = await import(ROOT + "src/build.ts");
const { loadSkkL } = await import(ROOT + "src/resources.ts");
const { sample } = await import(ROOT + "src/sample.ts");
const acc = await import(ROOT + "src/accuracy.ts");

const [basePath, nArg, seedArg, label] = Deno.args;
const base = new Set<string>();
for (const line of (await Deno.readTextFile(basePath)).split("\n")) {
  if (!line || line.startsWith(";")) continue;
  const sp = line.indexOf(" /");
  const key = line.slice(0, sp);
  for (const c of line.slice(sp + 2).split("/")) if (c) base.add(`${key}\t${c.split(";")[0]}`);
}
const L = await loadSkkL();
// deno-lint-ignore no-explicit-any
const pool: { pid: string; e: any }[] = [];
for (const pid of ["954645", "954646", "954647", "954648"]) {
  const v = JSON.parse(await Deno.readTextFile(paths.cleanseJson(pid)));
  for (const e of v.entries) {
    if (!inNoL(L, e)) continue;
    const forms = [e.shinjitai, e.notation, ...(e.altNotations ?? [])];
    if (!forms.some((w: string) => base.has(`${e.skkKey}\t${w}`))) pool.push({ pid, e });
  }
}
const n = Number(nArg), seed = Number(seedArg);
const items = sample(pool, n, seed);
console.log(`母集団 ${pool.length} 件から ${items.length} 件`);
const byMethod = new Map<string, number>();
for (const { e } of pool) byMethod.set(e.method, (byMethod.get(e.method) ?? 0) + 1);
console.log("母集団の検証方法", Object.fromEntries(byMethod));
await acc.writeSamples({ noL: items, verified: [], unverified: [] }, {
  docsDir: new URL("docs", ROOT).pathname,
  distDir: new URL("dist", ROOT).pathname,
  label,
  images: Deno.args.includes("--images"),
  dicts: ["noL"],
});
