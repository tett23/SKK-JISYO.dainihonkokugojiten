import { assertEquals } from "@std/assert";
import { detectTiers, extractPage, parseHead } from "./extract.ts";
import type { WorkLine, WorkPage } from "./work.ts";

Deno.test("parseHead: 行頭の「読み 表記 (品詞)」を取り出す", () => {
  assertEquals(parseHead("あし-つぎ足繼(名)高くて、背丈の"), {
    reading: "あし-つぎ",
    notation: "足繼",
    kango: false,
    pos: "名",
  });
  assertEquals(parseHead("あし-づつ 葦筒 (名) 葦の管の中に"), {
    reading: "あし-づつ",
    notation: "葦筒",
    kango: false,
    pos: "名",
  });
  assertEquals(parseHead("おどろかす驚(他動四)"), {
    reading: "おどろかす",
    notation: "驚",
    kango: false,
    pos: "他動四",
  });
  // 表記の無い語
  assertEquals(parseHead("あし-つぎ(名)表袴(2)の下の方にあ"), {
    reading: "あし-つぎ",
    notation: undefined,
    kango: false,
    pos: "名",
  });
});

Deno.test("parseHead: OCR で化けた区切りと漢語の記号を扱う", () => {
  // 区切りの "-" が "―" や "〳〵" に化けている
  assertEquals(parseHead("あけ―がた明方(名)")?.reading, "あけ-がた");
  assertEquals(parseHead("あさ〳くら朝倉(名)")?.reading, "あさ-くら");
  assertEquals(parseHead("あま〳〵くだす天降(他動四)")?.reading, "あま-くだす");
  // 漢語の記号 "一"
  assertEquals(parseHead("あい-こく一愛國(名)國を愛すること")?.notation, "愛國");
  assertEquals(parseHead("あい-こく一愛國(名)")?.kango, true);
  // 表記が本当に「一」で始まる語
  assertEquals(parseHead("いち-にん一人(名)")?.notation, "一人");
  assertEquals(parseHead("いち-にん一人(名)")?.kango, false);
});

Deno.test("parseHead: 語釈の続きやルビは見出しにしない", () => {
  // 句読点を含む
  assertEquals(parseHead("る、横の縫目。うへのはかま(表袴)を見"), undefined);
  // 括弧内が品詞ではない（ルビや参照）
  assertEquals(parseHead("ね(端艇)に同じ"), undefined);
  assertEquals(parseHead("いっすんぞり(一寸反)"), undefined);
  // 読みにひらがなが無い
  assertEquals(parseHead("ー(名)"), undefined);
});

const line = (x: number, y: number, text: string): WorkLine => ({
  x,
  y,
  width: 34,
  height: 500,
  text,
});

Deno.test("extractPage: 見出しの行を読み順のまま取り出し、ページ・段を付ける", () => {
  const body = (x: number, y: number) => line(x, y, "語釈の続きの行。");
  const page: WorkPage = {
    frame: 42,
    width: 4000,
    height: 2900,
    text: "",
    lines: [
      line(3700, 390, "あし-つぎ足繼(名)高くて"),
      ...[3660, 3620, 3580, 3540, 3460].map((x) => body(x, 405)),
      line(3500, 388, "あし-つぎ(名)表袴(2)の下"),
      line(1800, 930, "あしで葦手(名)"),
      ...[1760, 1720, 1680, 1640, 1600].map((x) => body(x, 945)),
    ],
  };
  assertEquals(detectTiers(page.lines.filter((l) => l.x > 2000)), [400]);
  const got = extractPage(page).map((c) => [
    c.side,
    c.tier,
    c.reading,
    c.notation,
    c.notationKind,
    c.pos,
  ]);
  assertEquals(got, [
    ["R", 1, "あし-つぎ", "足繼", "written", "名"],
    ["R", 1, "あし-つぎ", undefined, "none", "名"],
    ["L", 1, "あしで", "葦手", "written", "名"],
  ]);
});
