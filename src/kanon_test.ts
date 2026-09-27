import { assert, assertEquals } from "@std/assert";
import { kanonReadings, kanonSegment } from "./kanon.ts";
import { loadUnihan } from "./resources.ts";

const unihan = await loadUnihan().catch(() => undefined);
const has = (ch: string, ...rs: string[]) => {
  const got = kanonReadings(ch, unihan!);
  for (const r of rs) assert(got.includes(r), `${ch} ${r}: ${got}`);
};
const lacks = (ch: string, ...rs: string[]) => {
  const got = kanonReadings(ch, unihan!);
  for (const r of rs) assert(!got.includes(r), `${ch} ${r}: ${got}`);
};

Deno.test({
  name: "kanonReadings: 音韻地位から字音仮名遣いを作る",
  ignore: !unihan,
  fn() {
    has("高", "かう"); // 效摂 豪韻
    has("小", "せう"); // 宵韻
    has("公", "こう"); // 通摂 東韻一等
    has("光", "くわう"); // 合口の牙音
    has("外", "ぐわい");
    has("法", "はふ", "ほふ"); // 入声 -p（漢音・呉音）
    has("劫", "けふ", "こふ");
    has("日", "じつ", "にち"); // 入声 -t、日母は漢音 ざ行・呉音 な行
    has("京", "けい", "きやう"); // 梗摂 庚韻三等（漢音・呉音）
    has("大", "たい", "だい"); // 全濁（定母）は漢音で清音、呉音で濁音
    has("牙", "が");
    lacks("牙", "か"); // 次濁（疑母）は清音にならない
    lacks("吸", "ぎふ"); // 清音の声母（曉母）は濁らない
    has("徳", "とく"); // 『廣韻』に無い字体は異体字（德）で引く
  },
});

Deno.test({
  name: "kanonSegment: 字ごとの字音に区切る",
  ignore: !unihan,
  fn() {
    assertEquals(kanonSegment("學校", "がくかう", unihan!), ["がく", "かう"]);
    assertEquals(kanonSegment("學校", "がっかう", unihan!), ["がっ", "かう"]); // 促音化
    assertEquals(kanonSegment("光明", "くわう-みやう", unihan!), ["くわう", "みやう"]);
    assertEquals(kanonSegment("光明", "くわうみゃう", unihan!), ["くわう", "みゃう"]); // 小書き
    assertEquals(kanonSegment("櫻花", "あう-くあ", unihan!), ["あう", "くわ"]); // くあ → くわ
    assert(kanonSegment("牙音", "がおん", unihan!));
    assert(!kanonSegment("牙音", "かおん", unihan!));
    assert(!kanonSegment("雲翳", "らんえい", unihan!)); // う を ら と誤読
    // 連濁は rendaku で制御する。ん の後の半濁音は音便なので常に認める
    assert(kanonSegment("陸軍", "りくぐん", unihan!, { unihanOn: true }));
    assert(!kanonSegment("大統", "たいどう", unihan!, { rendaku: "none" })); // 統 は透母
    assert(kanonSegment("大統", "たいどう", unihan!, { rendaku: "any" }));
    assert(kanonSegment("先負", "せんぷ", unihan!, { rendaku: "none" }));
    // 表記に漢字以外を含むものは対象外
    assert(!kanonSegment("あ花", "あくわ", unihan!));
  },
});
