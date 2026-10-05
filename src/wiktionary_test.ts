import { assertEquals } from "@std/assert";
import { parseWiktionary } from "./wiktionary.ts";

Deno.test("parseWiktionary: ruby から読み、historical から古い仮名遣いを取り出す", () => {
  const line = JSON.stringify({
    word: "蝶々",
    pos: "noun",
    forms: [
      { form: "蝶々", tags: ["canonical"], ruby: [["蝶", "ちょう"], ["々", "ちょう"]] },
      { form: "てふてふ", tags: ["hiragana", "historical"] },
      { form: "蝶蝶", tags: ["alternative", "kanji"] },
    ],
  });
  const adj = JSON.stringify({
    word: "粗粗し",
    pos: "adj",
    forms: [{ form: "粗粗し", tags: ["canonical"], ruby: [["粗", "あら"], ["粗", "あら"]] }],
  });
  const jm = parseWiktionary([line, adj].join("\n"));
  assertEquals(jm.entries, 1);
  assertEquals(jm.bySkeleton.get("蝶蝶")?.[0].readings, [
    { reading: "ちょうちょう", old: false },
    { reading: "てふてふ", old: true },
  ]);
  // 文語の形容詞は除く
  assertEquals(jm.bySkeleton.has("粗粗"), false);
});
