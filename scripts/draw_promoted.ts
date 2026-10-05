/**
 * 二つのクレンジング結果（前・後）を比べ、新たに検証済みになった候補から抜き取って判定用の一覧と
 * 紙面の切り出しを作る（未検証の見出しを検証済みに移す方策の評価用）。
 * 使い方: deno run -A scripts/draw_promoted.ts <前の cleanse ディレクトリ> <n（0 なら全数）> <seed> <label> [--images]
 * REASON があれば、後の結果で未検証の理由が REASON の候補から抜き取る（層ごとの誤りの割合の評価用）
 */
const ROOT = new URL("../", import.meta.url).href;
const { paths } = await import(ROOT + "src/config.ts");
const { sample } = await import(ROOT + "src/sample.ts");
const acc = await import(ROOT + "src/accuracy.ts");

const [before, nArg, seedArg, label] = Deno.args;
// deno-lint-ignore no-explicit-any
const pool: { pid: string; e: any }[] = [];
for (const pid of ["954645", "954646", "954647", "954648"]) {
  const old = new Map(
    // deno-lint-ignore no-explicit-any
    JSON.parse(await Deno.readTextFile(`${before}/${pid}.json`)).entries.map((e: any) => [e.id, e]),
  );
  // AFTER_DIR があれば、その cleanse ディレクトリを後の結果とする（既定は data/cleanse）
  const after = Deno.env.get("AFTER_DIR");
  const v = JSON.parse(
    await Deno.readTextFile(after ? `${after}/${pid}.json` : paths.cleanseJson(pid)),
  );
  for (const e of v.entries) {
    // deno-lint-ignore no-explicit-any
    const o = old.get(e.id) as any;
    const reason = Deno.env.get("REASON");
    if (reason ? e.reason === reason : e.status === "accepted" && o?.status !== "accepted") {
      pool.push({ pid, e });
    }
  }
}
const n = Number(nArg);
const items = n > 0 ? sample(pool, n, Number(seedArg)) : pool;
console.log(`母集団 ${pool.length} 件から ${items.length} 件`);
await acc.writeSamples({ verified: items, noL: [], unverified: [] }, {
  docsDir: new URL("docs", ROOT).pathname,
  distDir: new URL("dist", ROOT).pathname,
  label,
  images: Deno.args.includes("--images"),
  dicts: ["verified"],
});
