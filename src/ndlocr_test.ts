import { assertEquals } from "@std/assert";
import { parseNdlocrXml } from "./ndlocr.ts";

Deno.test("parseNdlocrXml: PAGE と LINE を読み順のまま取り出す", () => {
  const xml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<OCRDATASET xmlns="NDLOCRDATASET">
  <PAGE IMAGENAME="R0000042.jpg" WIDTH="4562" HEIGHT="2904">
    <TEXTBLOCK>
      <LINE TYPE="本文" X="100" Y="200" WIDTH="30" HEIGHT="400" CONF="0.98" STRING="あし-つぎ&#12288;足繼" />
      <LINE TYPE="本文" X="60" Y="200" WIDTH="30" HEIGHT="400" CONF="0.9" STRING="&quot;臺&quot; &amp; ふみつぎ"/>
    </TEXTBLOCK>
  </PAGE>
  <PAGE IMAGENAME="R0000043.jpg" WIDTH="4562" HEIGHT="2904"/>
</OCRDATASET>`;
  assertEquals(parseNdlocrXml(xml), [
    {
      imageName: "R0000042.jpg",
      width: 4562,
      height: 2904,
      lines: [
        {
          type: "本文",
          x: 100,
          y: 200,
          width: 30,
          height: 400,
          conf: 0.98,
          text: "あし-つぎ　足繼",
        },
        { type: "本文", x: 60, y: 200, width: 30, height: 400, conf: 0.9, text: '"臺" & ふみつぎ' },
      ],
    },
    { imageName: "R0000043.jpg", width: 4562, height: 2904, lines: [] },
  ]);
});
