import type { WorkLine, WorkPage, WorkVolume } from "./work.ts";

/**
 * NDLラボの全文テキスト（NDL 側の OCR）から、座標を手がかりに見出し語と表記を取り出す。
 * ndlocr-lite の結果と突き合わせるための第二系統として使う。
 *
 * NDL 側の断片は段をまたいで読み順が乱れているので、テキストの並びは使わない。
 * 見出し語の列は本文より上に飛び出して大きな文字で組まれているので、
 * 見開きの左右ページごとに段の開始位置を求め、そこより上から始まる幅の広いかなの断片を
 * 見出し語、同じ列の直下の断片を表記とする。
 */
const P = {
  binSize: 10,
  minTierCount: 6,
  minTierGap: 300,
  headwordOffset: { min: 12, max: 65 },
  headwordWidthRatio: 1.1,
  notationGap: { min: -10, max: 60 },
};

export type NdlCandidate = {
  frame: number;
  x: number;
  y: number;
  reading: string;
  notation?: string;
};

const KANA_RE = /^[ぁ-ゖゝゞァ-ヺー\-－‐・]+$/;
const NOISE_RE = /^[一{｛【〔\[（(|｜\s]+|[}｝】〕\]）)|｜\s]+$/g;
const IDEOGRAPH_RE = /[\p{Script=Han}々〆ヶ]/u;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const center = (l: WorkLine) => l.x + l.width / 2;

function detectTiers(lines: WorkLine[]): number[] {
  const hist = new Map<number, number>();
  for (const l of lines) {
    const bin = Math.floor(l.y / P.binSize) * P.binSize;
    hist.set(bin, (hist.get(bin) ?? 0) + 1);
  }
  const peaks: number[] = [];
  for (const [bin, count] of [...hist].sort((a, b) => b[1] - a[1])) {
    if (count < P.minTierCount) break;
    if (peaks.every((q) => Math.abs(bin - q) >= P.minTierGap)) peaks.push(bin);
  }
  return peaks;
}

function extractHalf(frame: number, lines: WorkLine[]): NdlCandidate[] {
  const tiers = detectTiers(lines);
  const minWidth = median(lines.map((l) => l.width)) * P.headwordWidthRatio;
  const out: NdlCandidate[] = [];
  for (const l of lines) {
    const reading = l.text.replaceAll(/\s/g, "");
    if (!KANA_RE.test(reading) || l.width < minWidth) continue;
    const onTier = tiers.some((t) =>
      t - l.y >= P.headwordOffset.min && t - l.y <= P.headwordOffset.max
    );
    if (!onTier) continue;
    const bottom = l.y + l.height;
    const n = lines
      .filter((m) =>
        m !== l && Math.abs(center(m) - center(l)) <= l.width / 2 &&
        m.y - bottom >= P.notationGap.min && m.y - bottom <= P.notationGap.max
      )
      .sort((a, b) => a.y - b.y)[0];
    const notation = n?.text.replaceAll(/\s/g, "").replaceAll(NOISE_RE, "");
    out.push({
      frame,
      x: l.x,
      y: l.y,
      reading,
      notation: notation && IDEOGRAPH_RE.test(notation) ? notation : undefined,
    });
  }
  return out;
}

export function extractNdlPage(page: WorkPage): NdlCandidate[] {
  const width = page.width ?? Math.max(0, ...page.lines.map((l) => l.x + l.width));
  return [
    ...extractHalf(page.frame, page.lines.filter((l) => center(l) >= width / 2)),
    ...extractHalf(page.frame, page.lines.filter((l) => center(l) < width / 2)),
  ];
}

/** コマ番号 → 候補 */
export function extractNdlVolume(work: WorkVolume): Map<number, NdlCandidate[]> {
  return new Map(work.pages.map((p) => [p.frame, extractNdlPage(p)]));
}

/** キャッシュ用の JSON（コマ番号の昇順の配列） */
export type NdlExtractVolume = {
  schemaVersion: 1;
  pid: string;
  frames: [number, NdlCandidate[]][];
};

export const toNdlExtractJson = (
  pid: string,
  m: Map<number, NdlCandidate[]>,
): NdlExtractVolume => ({
  schemaVersion: 1,
  pid,
  frames: [...m].sort((a, b) => a[0] - b[0]),
});

export const fromNdlExtractJson = (v: NdlExtractVolume) => new Map(v.frames);
