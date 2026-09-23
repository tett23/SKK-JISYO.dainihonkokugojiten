import { assertEquals, assertThrows } from "@std/assert";
import { encodeEucJp, isEucJpEncodable } from "./eucjp.ts";

Deno.test("encodeEucJp: ASCII・かな・漢字（旧字体を含む）を JIS X 0208 で符号化する", () => {
  const s = "あしつぎ /足繼;（名）/惡/";
  assertEquals(new TextDecoder("euc-jp").decode(encodeEucJp(s)), s);
  assertEquals([...encodeEucJp("あ")], [0xa4, 0xa2]);
});

Deno.test("isEucJpEncodable: JIS X 0208 に無い文字は表せない", () => {
  assertEquals(isEucJpEncodable("足繼"), true);
  assertEquals(isEucJpEncodable("𠮷"), false);
  assertEquals(isEucJpEncodable("©"), false);
  // NEC 特殊文字（13 区）は含めない
  assertEquals(isEucJpEncodable("①"), false);
  assertThrows(() => encodeEucJp("𠮷"));
});
