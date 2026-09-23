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

Deno.test("annotation: 現代の読みと違うときだけ歴史的仮名遣いを付け、品詞を添える", async () => {
  const { annotation } = await import("./build.ts");
  const base = {
    id: "x",
    frame: 1,
    bbox: { x: 0, y: 0, width: 0, height: 0 },
    source: { reading: "", pos: "", line: "" },
    kango: false,
    order: "ok" as const,
    method: "L" as const,
    status: "accepted" as const,
    fixes: [],
    suggestions: [],
  };
  assertEquals(
    annotation({ ...base, reading: "てふ-てふ", modern: "ちょうちょう", pos: normalizePos("名") }),
    "てふてふ（名）",
  );
  assertEquals(
    annotation({ ...base, reading: "あし-ば", modern: "あしば", pos: normalizePos("名") }),
    "（名）",
  );
  assertEquals(
    annotation({ ...base, reading: "おもふ", modern: "おもう", pos: normalizePos("他動四") }),
    "おもふ（他動）",
  );
  assertEquals(
    annotation({ ...base, reading: "いや-まし", modern: "いやまし", pos: normalizePos("名、副") }),
    "（名・副）",
  );
});
