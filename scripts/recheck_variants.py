"""見出しの読み直しの切り出しを、拡大方法を変えて作る（多数決用）。

deno task recheck --variants から ndlocr-lite の Python（PIL を含む）で呼ぶ。
入力の JSON: {"page": 紙面画像のパス, "items": [{"id", "bbox": {x, y, width, height}}], "out": {変種: 出力先}}
切り出しの範囲と余白は src/recheck.ts の makeCrops（最近傍法 2 倍）と同じにする。
"""

import json
import os
import sys

from PIL import Image, ImageFilter, ImageOps

PAD_X, PAD_TOP, PAD_BOTTOM, MAX_HEIGHT, MARGIN = 8, 14, 8, 360, 60

VARIANTS = {
    # 双三次補間 2 倍
    "bic2": lambda c: c.resize((c.width * 2, c.height * 2), Image.BICUBIC),
    # Lanczos 3 倍
    "lan3": lambda c: c.resize((c.width * 3, c.height * 3), Image.LANCZOS),
    # Lanczos 3 倍に鮮鋭化とコントラストの調整
    "lan3s": lambda c: ImageOps.autocontrast(
        c.resize((c.width * 3, c.height * 3), Image.LANCZOS).filter(
            ImageFilter.UnsharpMask(2, 120, 2)
        ),
        cutoff=1,
    ),
}


def main() -> None:
    for line in sys.stdin:
        job = json.loads(line)
        page = Image.open(job["page"]).convert("RGB")
        for item in job["items"]:
            b = item["bbox"]
            x = max(0, b["x"] - PAD_X)
            y = max(0, b["y"] - PAD_TOP)
            w = min(page.width - x, b["width"] + PAD_X * 2)
            h = min(page.height - y, min(b["height"], MAX_HEIGHT) + PAD_TOP + PAD_BOTTOM)
            crop = page.crop((x, y, x + w, y + h))
            for name, out in job["out"].items():
                u = VARIANTS[name](crop)
                canvas = Image.new("RGB", (u.width + MARGIN * 2, u.height + MARGIN * 2), "white")
                canvas.paste(u, (MARGIN, MARGIN))
                os.makedirs(out, exist_ok=True)
                canvas.save(os.path.join(out, item["id"] + ".png"))


if __name__ == "__main__":
    main()
