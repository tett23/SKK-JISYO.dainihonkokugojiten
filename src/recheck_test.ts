import { assertEquals } from "@std/assert";
import { voteRecheck } from "./recheck_paths.ts";

Deno.test("voteRecheck: 多数決、同数なら head", () => {
  const h = { a: { text: "", reading: "こんばく" }, b: { text: "", reading: "でんぱう" } };
  const v1 = { a: { text: "", reading: "こんぱく" }, b: { text: "", reading: "でんばう" } };
  const v2 = { a: { text: "", reading: "こん-ぱく" } };
  const v3 = { a: { text: "", reading: "こんばく" } };
  const out = voteRecheck(h, [v1, v2, v3]);
  // a: ぱく 2・ばく 2 の同数は head
  assertEquals(out.a.reading, "こんばく");
  // b: でんぱう 1・でんばう 1 の同数は head
  assertEquals(out.b.reading, "でんぱう");
  const out2 = voteRecheck(h, [v1, v2, { a: { text: "", reading: "こんぱく" } }]);
  assertEquals(out2.a.reading, "こんぱく");
});
