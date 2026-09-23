import { assertEquals } from "@std/assert";
import { parseNdlocrXml } from "./ndlocr_lite.ts";

Deno.test("parseNdlocrXml: PAGE と LINE を取り出し、ORDER の順に並べる", () => {
  const xml = `<OCRDATASET>
<PAGE IMAGENAME="R0000042.jpg" WIDTH="4562" HEIGHT="2904">
  <TEXTBLOCK CONF="0.959">
    <LINE TYPE="本文" X="3712" Y="391" WIDTH="34" HEIGHT="508" CONF="0.690" ORDER="1" STRING="あし-つぎ足繼(名)高くて、背丈の" />
    <LINE TYPE="本文" X="3752" Y="402" WIDTH="36" HEIGHT="261" CONF="0.823" ORDER="0" STRING="&quot;臺&quot; &amp;&#12288;ふみつぎ" />
  </TEXTBLOCK>
</PAGE>
</OCRDATASET>`;
  assertEquals(parseNdlocrXml(xml), [
    {
      imageName: "R0000042.jpg",
      width: 4562,
      height: 2904,
      lines: [
        {
          type: "本文",
          x: 3752,
          y: 402,
          width: 36,
          height: 261,
          conf: 0.823,
          order: 0,
          text: '"臺" &　ふみつぎ',
        },
        {
          type: "本文",
          x: 3712,
          y: 391,
          width: 34,
          height: 508,
          conf: 0.69,
          order: 1,
          text: "あし-つぎ足繼(名)高くて、背丈の",
        },
      ],
    },
  ]);
});
