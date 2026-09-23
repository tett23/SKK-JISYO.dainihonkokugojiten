import { assert } from "@std/assert";
import { alignReading } from "./align.ts";
import { loadUnihan } from "./resources.ts";

const unihan = await loadUnihan().catch(() => undefined);
const ok = (notation: string, reading: string) =>
  assert(alignReading(notation, reading, unihan!, { maxTrailing: 1 }), `${notation} ${reading}`);

Deno.test({
  name: "alignReading: 音訓・連濁・送り仮名の省略・連体助詞の省略",
  ignore: !unihan,
  fn() {
    ok("足場", "あしば");
    ok("明方", "あけがた"); // 送り仮名の省略
    ok("足留", "あしどめ"); // 連濁
    ok("愛國", "あいこく");
    ok("牙飛出", "きばとびで"); // 連用形
    ok("貝柱", "かいのはしら"); // の の省略
    ok("學校", "がっこう"); // 促音化
    assert(!alignReading("足場", "あしもと", unihan!, { maxTrailing: 1 }));
  },
});
