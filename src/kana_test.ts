import { assert, assertEquals } from "@std/assert";
import { collationKey, dictionaryForms, modernVariants, okuriChars } from "./kana.ts";

const first = (r: string, kango = false) => modernVariants(r, { kango })[0];
const has = (r: string, want: string, kango = false) =>
  assert(modernVariants(r, { kango }).includes(want), `${r} -> ${modernVariants(r, { kango })}`);

Deno.test("modernVariants: 和語", () => {
  assertEquals(first("あし-つぎ"), "あしつぎ");
  assertEquals(first("おもふ"), "おもう");
  assertEquals(first("いふ"), "いう");
  assertEquals(first("かは"), "かわ");
  assertEquals(first("あぢさゐ"), "あじさい");
  assertEquals(first("をとこ"), "おとこ");
  assertEquals(first("おほきい"), "おおきい");
  assertEquals(first("みづ"), "みず");
  // 語構成要素の頭のハ行は変えない
  assertEquals(first("あし-はら"), "あしはら");
  // 連濁・同音の連呼の ぢ/づ は残す
  assertEquals(first("はな-ぢ"), "はなぢ");
  assertEquals(first("ちぢむ"), "ちぢむ");
  assertEquals(first("つづく"), "つづく");
  // 曖昧なものは候補に含まれる
  has("あふぎ", "おうぎ");
  has("あふぐ", "あおぐ");
});

Deno.test("modernVariants: 字音", () => {
  assertEquals(first("あいきゃう", true), "あいきょう");
  assertEquals(first("あい-きやう", true), "あいきょう");
  assertEquals(first("てふてふ", true), "ちょうちょう");
  assertEquals(first("せうせう", true), "しょうしょう");
  assertEquals(first("かう", true), "こう");
  assertEquals(first("くわん", true), "かん");
  assertEquals(first("じふ", true), "じゅう");
  assertEquals(first("ぢしん", true), "じしん");
  has("がくかう", "がっこう", true);
  has("りふ", "りつ", true);
  // 拗音の大書き
  has("きよう", "きょう", true);
  has("しゆう", "しゅう", true);
  assertEquals(first("きよう", true), "きよう");
});

Deno.test("collationKey: 区切り・濁点・小書きを無視する", () => {
  assertEquals(collationKey("あし-づつ"), "あしつつ");
  assertEquals(collationKey("あいきゃう"), "あいきやう");
});

Deno.test("dictionaryForms: 文語の終止形から現代語の形を作る", () => {
  assertEquals(dictionaryForms("おどろかす", "verb"), [
    "おどろかす",
    "おどろかせる",
    "おどろかしる",
    "おどろかする",
  ]);
  assertEquals(dictionaryForms("たかし", "adjective"), ["たかし", "たかい", "たかしい"]);
});

Deno.test("okuriChars: SKK の送りの文字", () => {
  assertEquals(okuriChars("かす"), ["k"]);
  assertEquals(okuriChars("う"), ["u", "w"]);
  assertEquals(okuriChars("しい"), ["s"]);
});

Deno.test("modernVariants: 語の途中の い は拗音にしない（たいやう 太陽 → たいよう）", () => {
  assertEquals(modernVariants("たいやう-ねん", { kango: true })[0], "たいようねん");
  assertEquals(modernVariants("へいたいやう", { kango: true })[0], "へいたいよう");
  // 語構成要素の頭の いやう は よう
  assertEquals(modernVariants("いやう", { kango: true })[0], "よう");
});

Deno.test("modernVariants: くわう・ぐわう は こう・ごう", () => {
  assertEquals(modernVariants("くわう-さい", { kango: true })[0], "こうさい");
  assertEquals(modernVariants("じゃう-くわう", { kango: true })[0], "じょうこう");
  assertEquals(modernVariants("ぐわう", { kango: true })[0], "ごう");
});
