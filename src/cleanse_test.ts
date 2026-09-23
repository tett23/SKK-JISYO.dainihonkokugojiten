import { assertEquals } from "@std/assert";
import { orderOutliers } from "./cleanse.ts";
import { normalizePos } from "./pos.ts";
import { parseSkkDict } from "./resources.ts";

Deno.test("orderOutliers: 同じ誤読が続いても、正しい並びのほうを外れにしない", () => {
  const keys = [
    "いきけいせい",
    "いきこくもん",
    "いきこと",
    "いさす", // き→さ の誤読
    "いきこみ",
    "いきこむ",
    "いさすたま", // 同じ誤読
    "いきさし",
    "いきさつ",
    "いきしに",
    "いきしひき",
  ];
  const got = keys.filter((_, i) => orderOutliers(keys)[i]);
  assertEquals(got, ["いさす", "いさすたま"]);
});

Deno.test("normalizePos: 品詞と活用の種類", () => {
  assertEquals(normalizePos("名").category, "noun");
  assertEquals(normalizePos("名、副").categories, ["noun", "adverb"]);
  assertEquals(normalizePos("他動四").category, "verb");
  assertEquals(normalizePos("他動四").conjugation, "四段");
  assertEquals(normalizePos("自動地").conjugation, undefined); // 「四」の誤読は推測しない
  assertEquals(normalizePos("自動下二").conjugation, "下二");
  assertEquals(normalizePos("形二").conjugation, "シク");
  assertEquals(normalizePos("枕").category, "makura");
});

Deno.test("parseSkkDict: 送りあり・送りなしと注釈", () => {
  const dict = parseSkkDict(`;; okuri-ari entries.
おどろk /驚;びっくり/愕/
;; okuri-nasi entries.
あしば /足場/
あいこく /愛国/哀哭;悲しむ/(concat "a\\057b")/
`);
  assertEquals(dict.okuriAri.get("おどろk"), ["驚", "愕"]);
  assertEquals(dict.okuriNasi.get("あいこく"), ["愛国", "哀哭"]);
  assertEquals(dict.readingsOf.get("足場"), ["あしば"]);
});
