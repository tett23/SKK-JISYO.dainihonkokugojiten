import type { WorkLine, WorkPage, WorkVolume } from "./work.ts";

/**
 * ndlocr-lite の作業用 JSON から見出し語（読み）・表記・品詞の候補を抽出する。
 *
 * 紙面は縦書きの多段組で、各項目は新しい列の頭から「読み 表記 (品詞) 語釈…」の順に組まれている。
 * ndlocr-lite は縦 1 列を 1 行として読み順に出力するので、行頭がこの形になっている行を項目の先頭とみなす。
 */
export const EXTRACT_PARAMS = {
  /** 行頭 y を集計するときのビンの幅 (px) */
  binSize: 10,
  /** 段の開始位置とみなすのに必要な、同じビンに行頭がある行の数 */
  minTierCount: 5,
  /** 段同士の最小間隔 (px)。1段はおよそ 540px */
  minTierGap: 300,
  /** 行頭が段の開始位置からこの範囲にある行を、その段の行とみなす (px) */
  tierMargin: 60,
} as const;

export type Side = "R" | "L";

export type NotationKind =
  /** 漢字などの表記がある */
  | "written"
  /** 表記が無い（読みの直後に品詞が来ている） */
  | "none";

export type BBox = { x: number; y: number; width: number; height: number };

export type Candidate = {
  /** <pid>-<コマ番号3桁>-<連番4桁> */
  id: string;
  frame: number;
  side: Side;
  /** ページ内の段番号（上から 1 始まり）。段が判定できない場合は undefined */
  tier?: number;
  /** 段の開始位置から行頭までの距離 (px)。見出し語は本文より上に出るので負になりやすい */
  offset?: number;
  /** 見出し語（歴史的仮名遣い。語構成の区切り "-" は OCR で落ちることがある） */
  reading: string;
  notation?: string;
  notationKind: NotationKind;
  /**
   * 表記の前に漢語を示す記号がある（OCR では "一" になる）。
   * 歴史的仮名遣いの変換で字音仮名遣いとして扱う手がかりになる
   */
  kango: boolean;
  /** 括弧内の品詞表示（OCR されたまま） */
  pos: string;
  /** 候補を取り出した行のテキスト全体（語釈の冒頭を含む） */
  line: string;
  conf?: number;
  bbox: BBox;
};

export type ExtractVolume = {
  schemaVersion: 2;
  pid: string;
  generatedAt: string;
  source: { workGeneratedAt: string; kind: string };
  params: typeof EXTRACT_PARAMS;
  candidates: Candidate[];
};

/**
 * 行頭の「読み 表記 (品詞)」。
 * 読みはかなと語構成の区切り、表記は句読点や括弧を含まない文字列、品詞は括弧内の短い文字列。
 */
const HEAD_RE =
  /^([ぁ-ゖゝゞァ-ヺー\-－‐・=＝]+)([^()（）、。，．「」『』]*?)[(（]([^()（）]{1,8})[)）]/;
const HIRAGANA_RE = /[ぁ-ゖ]/;
/** 読みの中の語構成の区切り "-" が OCR で化けたもの */
const HYPHEN_LIKE_RE = /(?<=[ぁ-ゖゝゞァ-ヺ])(?:[〳〴]〵|[―〳〵〴!！↓～~])(?=[ぁ-ゖゝゞァ-ヺ])/g;
/** 表記の前の漢語の記号。表記が「一」で始まる語（いち、いつ、ひと…）と区別するため読みも見る */
const KANGO_MARK_RE = /^[一―ー-]/;
const ICHI_RE = /^(いち|いつ|いっ|ひと|ひとつ|はじめ|かず)/;
/** 品詞表示の先頭（凡例の略語）。後ろに活用の種類（四、下二など）が続くことがある */
const POS_RE = /^(名|代|數|数|自動|他動|助動|動|形|副|接頭|接尾|接|感|助|枕|連)/;

/** 1 行のテキストから見出しを取り出す。見出しの形でなければ undefined */
export function parseHead(
  text: string,
): { reading: string; notation?: string; kango: boolean; pos: string } | undefined {
  const normalized = text.replaceAll(/\s/g, "").replaceAll(HYPHEN_LIKE_RE, "-");
  const m = normalized.match(HEAD_RE);
  if (!m) return undefined;
  const [, reading, rawNotation, pos] = m;
  if (!HIRAGANA_RE.test(reading) || !POS_RE.test(pos)) return undefined;
  const kango = KANGO_MARK_RE.test(rawNotation) && rawNotation.length >= 2 &&
    !ICHI_RE.test(reading.replaceAll("-", ""));
  const notation = kango ? rawNotation.slice(1) : rawNotation;
  return { reading, notation: notation || undefined, kango, pos };
}

/** 行頭 y が集中する位置を段の開始位置として返す（上から順） */
export function detectTiers(lines: WorkLine[], p = EXTRACT_PARAMS): number[] {
  const hist = new Map<number, number>();
  for (const l of lines) {
    const bin = Math.floor(l.y / p.binSize) * p.binSize;
    hist.set(bin, (hist.get(bin) ?? 0) + 1);
  }
  const peaks: number[] = [];
  for (const [bin, count] of [...hist].sort((a, b) => b[1] - a[1])) {
    if (count < p.minTierCount) break;
    if (peaks.every((q) => Math.abs(bin - q) >= p.minTierGap)) peaks.push(bin);
  }
  return peaks.sort((a, b) => a - b);
}

type RawCandidate = Omit<Candidate, "id">;

/** 1 コマ（見開き）から候補を紙面の読み順（右ページ→左ページ、上の段→下の段、右の列→左の列）で抽出する */
export function extractPage(page: WorkPage, p = EXTRACT_PARAMS): RawCandidate[] {
  const width = page.width ?? Math.max(0, ...page.lines.map((l) => l.x + l.width));
  const sideOf = (l: WorkLine): Side => (l.x + l.width / 2 >= width / 2 ? "R" : "L");
  const tiers = {
    R: detectTiers(page.lines.filter((l) => sideOf(l) === "R"), p),
    L: detectTiers(page.lines.filter((l) => sideOf(l) === "L"), p),
  };

  const out: (RawCandidate & { sortTier: number })[] = [];
  for (const l of page.lines) {
    const head = parseHead(l.text);
    if (!head) continue;
    const side = sideOf(l);
    const ts = tiers[side];
    const tier = ts.findIndex((t) => Math.abs(l.y - t) <= p.tierMargin);
    // 並べ替え用には、範囲外でも最も近い段に割り当てる
    const nearest = ts.length === 0
      ? 0
      : ts.reduce((best, t, i) => Math.abs(l.y - t) < Math.abs(l.y - ts[best]) ? i : best, 0);
    out.push({
      frame: page.frame,
      side,
      tier: tier < 0 ? undefined : tier + 1,
      offset: tier < 0 ? undefined : l.y - ts[tier],
      reading: head.reading,
      notation: head.notation,
      notationKind: head.notation ? "written" : "none",
      kango: head.kango,
      pos: head.pos,
      line: l.text,
      conf: l.conf,
      bbox: { x: l.x, y: l.y, width: l.width, height: l.height },
      sortTier: nearest,
    });
  }
  // ndlocr-lite の読み順は段の順を取り違えることがあるので、座標で並べ直す
  const sideOrder = { R: 0, L: 1 };
  return out
    .sort((a, b) =>
      sideOrder[a.side] - sideOrder[b.side] || a.sortTier - b.sortTier || b.bbox.x - a.bbox.x
    )
    .map(({ sortTier: _, ...c }) => c);
}

export function extractVolume(work: WorkVolume): ExtractVolume {
  if (work.source.kind !== "ndlocr-lite") {
    throw new Error(
      `${work.pid}: extract は ndlocr-lite の作業用 JSON にのみ対応しています (source: ${work.source.kind})`,
    );
  }
  const candidates: Candidate[] = [];
  for (const page of work.pages) {
    extractPage(page).forEach((c, i) => {
      const id = `${work.pid}-${String(c.frame).padStart(3, "0")}-${
        String(i + 1).padStart(4, "0")
      }`;
      candidates.push({ id, ...c });
    });
  }
  return {
    schemaVersion: 2,
    pid: work.pid,
    generatedAt: new Date().toISOString(),
    source: { workGeneratedAt: work.generatedAt, kind: work.source.kind },
    params: EXTRACT_PARAMS,
    candidates,
  };
}
