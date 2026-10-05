"""
読みの傍の発音の注記（小さな片仮名）を紙面の画像から取り出す（src/pronunciation_notes.ts から呼ぶ）。

標準入力に 1 行 1 ページの JSON（{"page": 画像のパス, "items": [{"id", "bbox", "reading", "index"}]}）を受け、
標準出力に 1 行 1 候補の JSON（{"id", "notes": [[y0, y1, x0, x1, 字の番号], ...], "yu": 真偽}）を書く。
index は注記を調べる字（読みの区切り "-" を除いた番号）で、yu はその字（と一つ前の字）の傍に ュ（低く横長の注記）があるか。

- 見出しの列の上端から読みの字数ぶんの高さを切り出し、列ごとの墨の量から読みの列の右端を決める
- その右の、隣の列（前の見出しの語釈。幅 8px 以上の墨の多い列）までにある小さな連結成分を注記とする
- 読みの列に接した注記を切り離すため、読みの列の右端から 2px の位置で墨を切る
- 注記が読みの何字目の傍かは、高さから 1 字 28px、区切り "-" 13px として数える

docs/pronunciation-notes.md を参照。ndlocr-lite の Python（numpy、PIL、OpenCV を含む）で動かす。
"""
import json
import sys

import cv2
import numpy as np
from PIL import Image

PITCH = 28
HYPHEN = 13


def kana_at(reading, y):
    pos = 0
    k = 0
    for ch in reading:
        h = HYPHEN if ch == "-" else PITCH
        if pos <= y < pos + h:
            return -1 if ch == "-" else k
        pos += h
        if ch != "-":
            k += 1
    return k


def runs(mask):
    out = []
    s = None
    for i, v in enumerate(mask):
        if v and s is None:
            s = i
        if not v and s is not None:
            out.append((s, i - 1))
            s = None
    if s is not None:
        out.append((s, len(mask) - 1))
    return out


def notes(page, bbox, reading):
    n = len(reading.replace("-", "")) + reading.count("-") * 0.5
    y0 = bbox["y"]
    y1 = min(page.shape[0], bbox["y"] + int(PITCH * n + 10))
    x0 = max(0, bbox["x"] - 12)
    x1 = min(page.shape[1], bbox["x"] + 95)
    a = page[y0:y1, x0:x1]
    if a.size == 0:
        return []
    th = np.percentile(a, 50) * 0.6
    ink = a < th
    prof = ink.sum(axis=0)
    strong = prof > a.shape[0] * 0.15
    rs = runs(strong)
    if not rs:
        return []
    main = max([r for r in rs if r[0] < 45] or rs, key=lambda r: prof[r[0]:r[1] + 1].sum())
    right = main[1]
    nxt = [r for r in rs if r[0] > right + 3 and r[1] - r[0] >= 8]
    nleft = nxt[0][0] if nxt else a.shape[1]
    cut = ink.copy()
    cut[:, :right + 2] = False
    n_cc, _, st, _ = cv2.connectedComponentsWithStats(cut.astype(np.uint8), connectivity=8)
    comps = []
    for k in range(1, n_cc):
        cx, cy, w, h, area = (int(v) for v in st[k])
        if area < 10 or h > 18 or w > 15 or w < 3:
            continue
        if cx + w >= nleft - 1 or cx - right > 14:
            continue
        if cx <= right + 2 and w < 5:
            continue
        comps.append([cy, cy + h, cx, cx + w])
    comps.sort()
    groups = []
    for c in comps:
        if groups and c[0] - groups[-1][1] <= 3:
            g = groups[-1]
            g[0] = min(g[0], c[0])
            g[1] = max(g[1], c[1])
            g[2] = min(g[2], c[2])
            g[3] = max(g[3], c[3])
        else:
            groups.append(list(c))
    return [
        [g[0], g[1], g[2] - right, g[3] - right, kana_at(reading, (g[0] + g[1]) / 2)]
        for g in groups
        if g[1] - g[0] >= 5
    ]


def is_yu(g):
    """ュ: 低く横長で、読みの列に寄せて組まれた注記（ウ は高さ 13px 前後で ュ より高い）"""
    y0, y1, x0, x1, _ = g
    h, w = y1 - y0, x1 - x0
    # 高さ 6px 以下は読みの字のはみ出しの切れ端
    return 7 <= h <= 11 and w >= 7 and w >= h - 1 and x0 <= 12


for line in sys.stdin:
    if not line.strip():
        continue
    job = json.loads(line)
    page = np.array(Image.open(job["page"]).convert("L"))
    for item in job["items"]:
        found = notes(page, item["bbox"], item["reading"])
        # 字の位置の推定（1 字 28px）は、濁点のある字などで実際より短く出て 1 字前にずれることがある
        yu = any(item["index"] - 1 <= g[4] <= item["index"] and is_yu(g) for g in found)
        print(json.dumps({"id": item["id"], "notes": found, "yu": yu}), flush=True)
