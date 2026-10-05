/**
 * 検証方法が指定のもの（例: nippo）の検証済みの見出しを全数、判定用の一覧と紙面の切り出しにする。
 * 使い方: deno run -A scripts/draw_method.ts <method> <label> [--images]
 */
const ROOT = new URL("../", import.meta.url).href;
const { paths } = await import(ROOT + "src/config.ts");
const acc = await import(ROOT + "src/accuracy.ts");

const [method, label] = Deno.args;
const items = [];
for (const pid of ["954645", "954646", "954647", "954648"]) {
  const v = JSON.parse(await Deno.readTextFile(paths.cleanseJson(pid)));
  for (const e of v.entries) {
    if (e.status === "accepted" && e.method === method) items.push({ pid, e });
  }
}
console.log(`${method}: ${items.length} 件`);
await acc.writeSamples({ verified: items, noL: [], unverified: [] }, {
  docsDir: new URL("docs", ROOT).pathname,
  distDir: new URL("dist", ROOT).pathname,
  label,
  images: Deno.args.includes("--images"),
  dicts: ["verified"],
});
