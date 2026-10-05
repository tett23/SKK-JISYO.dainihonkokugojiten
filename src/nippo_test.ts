import { assert, assertEquals } from "@std/assert";
import { looseKey, nippoForms, parseNippo } from "./nippo.ts";

Deno.test("nippoForms: 歴史的仮名遣いを日葡辞書の片仮名転写の形にする", () => {
  assertEquals(nippoForms("きやう"), ["キャゥ"]); // 開音
  assertEquals(nippoForms("せう"), ["ショゥ"]); // えう → ヨゥ
  assertEquals(nippoForms("くわん-せん"), ["クヮンセン"]); // 合拗音
  assert(nippoForms("おほ-みね").includes("ヲゥミネ")); // オ段 + ほ
  assert(nippoForms("ふみ-かへす", { verb: true }).includes("フミカエス")); // ハ行転呼
  assert(nippoForms("ぶつ-ざい-せ", { kango: true }).includes("ブっザイセ")); // 入声 t
});

Deno.test("looseKey: 開合・四つ仮名・清濁を捨てる", () => {
  assertEquals(looseKey("キャゥ"), looseKey("キョゥ"));
  assertEquals(looseKey("ヂシャ"), looseKey("ジシャ"));
  assertEquals(looseKey("ガン"), looseKey("カン"));
  assert(looseKey("アクダゥ") !== looseKey("アクダラ"));
});

Deno.test("parseNippo: 異形と動詞の活用形を展開する", () => {
  const n = parseNippo(
    "整理番号\t見出し語ID\t見出し語\t見出し語（片仮名）\n" +
      "1\t001a01\tFafa.|,faua.\tハハ.|,ハワ\n" +
      "2\t001a02\tNaraxi,su,ita.\tナラシ,ス,イタ\n",
  );
  for (const k of ["ハハ", "ハワ", "ナラシ", "ナラス"]) assert(n.keys.has(looseKey(k)), k);
});
