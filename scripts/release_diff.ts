/**
 * 前のリリースの辞書と比べて、追加・削除した見出し語（読みと候補の組）をリリースノートに書く。
 * 使い方: deno run -A scripts/release_diff.ts <前の utf-8 ディレクトリ> <今の utf-8 ディレクトリ> <前のタグ> <出力 Markdown> <出力 TSV>
 *
 * Markdown はリリースノートに入れる（辞書ごとに件数と一覧。一覧が長いときは先頭だけ）。
 * TSV は全件で、リリースの添付ファイルにする（列: 辞書、追加 / 削除、読み、候補）。
 */
const [oldDir, newDir, oldTag, outMd, outTsv] = Deno.args;

const DICTS = [
  ["SKK-JISYO.dainihonkokugojiten", "検証済み"],
  ["SKK-JISYO.dainihonkokugojiten.noL", "L 除外"],
  ["SKK-JISYO.dainihonkokugojiten.unverified", "未検証"],
] as const;

/** Markdown に載せる一覧の件数の上限（辞書・追加 / 削除ごと）。残りは添付の TSV にある */
const LIST_LIMIT = 500;

/** 辞書を読み、読みと候補（注釈を除く）の組の集合にする */
async function pairs(path: string): Promise<Set<string>> {
  const text = await Deno.readTextFile(path).catch(() => "");
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith(";")) continue;
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const key = line.slice(0, sp);
    for (const c of line.slice(sp + 1).split("/").slice(1, -1)) {
      const word = c.split(";")[0];
      if (word) out.add(`${key}\t${word}`);
    }
  }
  return out;
}

const md: string[] = [`## 前のリリース（${oldTag}）からの見出し語の変更`, ""];
md.push(
  "読みと候補の組を比べた。読みだけ・候補だけが変わった見出しは、削除と追加の両方に出る。全件は添付の `changes.tsv` にある。",
  "",
);
const tsv: string[] = ["dictionary\tchange\treading\tcandidate"];
for (const [file, label] of DICTS) {
  const before = await pairs(`${oldDir}/${file}`);
  const after = await pairs(`${newDir}/${file}`);
  const added = [...after].filter((p) => !before.has(p)).sort();
  const removed = [...before].filter((p) => !after.has(p)).sort();
  for (const p of added) tsv.push(`${file}\t追加\t${p}`);
  for (const p of removed) tsv.push(`${file}\t削除\t${p}`);
  md.push(`### ${label}（\`${file}\`）: 追加 ${added.length}、削除 ${removed.length}`, "");
  for (const [name, list] of [["追加", added], ["削除", removed]] as const) {
    if (list.length === 0) continue;
    const shown = list.slice(0, LIST_LIMIT).map((p) => p.replace("\t", " "));
    const more = list.length > LIST_LIMIT
      ? `\n（ほか ${list.length - LIST_LIMIT} 件は changes.tsv）`
      : "";
    md.push(
      `<details><summary>${name}（${list.length}）</summary>`,
      "",
      "```",
      ...shown,
      "```" + more,
      "",
      "</details>",
      "",
    );
  }
}
await Deno.writeTextFile(outMd, md.join("\n") + "\n");
await Deno.writeTextFile(outTsv, tsv.join("\n") + "\n");
