import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import type { CleanEntry, CleanVolume } from "./cleanse.ts";
import { sample } from "./sample.ts";

/**
 * 辞書ファイルごとの正解率の評価。
 *
 * 1. sample: 3 つの辞書（検証済み、L 除外、未検証）から候補を無作為に抜き取り、判定用の一覧
 *    （docs/accuracy/<label>/<辞書>.tsv）と紙面の切り出し（dist/accuracy/<label>/）を出力する。
 *    過去に同じ候補（id・見出し・表記が同じ）に付けた判定があれば引き継ぐ。
 * 2. 人が一覧の judgment 列に o（正しい）/ x（誤り）を記入する。SKK の見出しと表記の両方が
 *    紙面の見出しと合っていれば o とする（底本の見出しが古い語形でも、底本どおりなら o）。
 * 3. report: 判定を集計し、正解率と 95% 信頼区間（Wilson スコア区間）を求めて、
 *    グラフ（docs/accuracy/<label>.svg）と README の表を更新する。
 */

export const DICTIONARIES = ["verified", "noL", "unverified"] as const;
export type DictionaryName = typeof DICTIONARIES[number];

export const DICTIONARY_FILES: Record<DictionaryName, string> = {
  verified: "SKK-JISYO.dainihonkokugojiten",
  noL: "SKK-JISYO.dainihonkokugojiten.noL",
  unverified: "SKK-JISYO.dainihonkokugojiten.unverified",
};

export const accuracyPaths = {
  root: (docsDir: string) => join(docsDir, "accuracy"),
  tsv: (docsDir: string, label: string, name: DictionaryName) =>
    join(docsDir, "accuracy", label, `${name}.tsv`),
  meta: (docsDir: string, label: string) => join(docsDir, "accuracy", label, "sample.json"),
  svg: (docsDir: string, label: string) => join(docsDir, "accuracy", `${label}.svg`),
  sheets: (distDir: string, label: string) => join(distDir, "accuracy", label),
};

export type Item = { pid: string; e: CleanEntry };

/** 抜き取りの条件（再現用） */
export type SampleMeta = {
  n: number;
  seeds: number[];
  sampledAt: string;
  /** 抜き取ったときのコミット（作業ツリーに変更があれば -dirty を付ける） */
  commit?: string;
  /** 判定の方法（グラフの注記に出す） */
  judge?: string;
  /** シード値の事前記録を履歴で確かめられない事情の説明（グラフの注記と README に出す） */
  preregistrationNote?: string;
  /** OCR 済みの入力（data/extract・extract-ndl・recheck）のハッシュ。OCR をやり直したかの判定に使う */
  inputs?: string;
  /** 人が行った確認の内容（report --human-check で記録する） */
  humanCheck?: string;
  /** 結果を読むときの注意（グラフの注記と README に出す） */
  caveat?: string;
};

/**
 * 変わったら人の確認が必要になるファイル（OCR とクレンジングの規則、辞書への振り分け）。
 * OCR のやり直し（エンジン・設定の変更を含む）は入力のハッシュ（SampleMeta.inputs）で見る
 */
export const HUMAN_CHECK_PATHS = [
  "src/ndlocr_lite.ts",
  "src/work.ts",
  "src/extract.ts",
  "src/extract_ndl.ts",
  "src/recheck.ts",
  "src/cleanse.ts",
  "src/align.ts",
  "src/kana.ts",
  "src/build.ts",
];

/** ファイルの内容をまとめたハッシュ（SHA-256 の先頭 12 桁）。ファイルが無ければ undefined */
export async function digestFiles(files: string[]): Promise<string | undefined> {
  const hashes: string[] = [];
  for (const f of [...files].sort()) {
    let data: Uint8Array<ArrayBuffer>;
    try {
      data = await Deno.readFile(f);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return undefined;
      throw e;
    }
    hashes.push(toHex(await crypto.subtle.digest("SHA-256", data)));
  }
  const all = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashes.join("\n")));
  return toHex(all).slice(0, 12);
}

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** ほかのラベルの抜き取り条件（sample.json）を抜き取った順に返す */
export async function otherSampleMetas(
  docsDir: string,
  label: string,
): Promise<{ label: string; meta: SampleMeta }[]> {
  const root = accuracyPaths.root(docsDir);
  if (!(await exists(root))) return [];
  const out: { label: string; meta: SampleMeta }[] = [];
  for await (const d of Deno.readDir(root)) {
    if (!d.isDirectory || d.name === label) continue;
    const meta = await readSampleMeta(docsDir, d.name);
    if (meta) out.push({ label: d.name, meta });
  }
  return out.sort((a, b) => a.meta.sampledAt.localeCompare(b.meta.sampledAt));
}

/** ほかのラベルで使ったシード値（版をまたいで同じシード値を使わないため） */
export async function seedsUsedElsewhere(
  docsDir: string,
  label: string,
  seeds: number[],
): Promise<{ label: string; seeds: number[] }[]> {
  return (await otherSampleMetas(docsDir, label))
    .map(({ label, meta }) => ({ label, seeds: meta.seeds.filter((x) => seeds.includes(x)) }))
    .filter((x) => x.seeds.length > 0);
}

export const DEFAULT_JUDGE = "AI（Claude）が紙面画像と照合";

/** 現在のコミットの短いハッシュ。作業ツリーに変更があれば -dirty を付ける */
export async function currentCommit(repoRoot: string): Promise<string | undefined> {
  const git = async (...args: string[]) => {
    const { success, stdout } = await new Deno.Command("git", { args, cwd: repoRoot }).output()
      .catch(() => ({ success: false, stdout: new Uint8Array() }));
    return success ? new TextDecoder().decode(stdout).trim() : undefined;
  };
  const hash = await git("rev-parse", "--short", "HEAD");
  if (!hash) return undefined;
  const status = await git("status", "--porcelain", "--untracked-files=no");
  return status ? `${hash}-dirty` : hash;
}

export async function readSampleMeta(
  docsDir: string,
  label: string,
): Promise<SampleMeta | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(accuracyPaths.meta(docsDir, label)));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return undefined;
    throw e;
  }
}

export async function writeSampleMeta(docsDir: string, label: string, meta: SampleMeta) {
  const path = accuracyPaths.meta(docsDir, label);
  await ensureDir(join(path, ".."));
  await Deno.writeTextFile(path, JSON.stringify(meta, null, 2) + "\n");
}

/**
 * シード値ごとに件数を等分して抜き取る（--seed 101,202,303 --n 450 なら 150 件ずつ）。
 * 重複は除く
 */
export function drawMany<T extends Item>(pool: T[], n: number, seeds: number[]): T[] {
  const per = Math.ceil(n / seeds.length);
  const out: T[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    for (const x of sample(pool, per, seed)) {
      if (seen.has(x.e.id) || out.length >= n) continue;
      seen.add(x.e.id);
      out.push(x);
    }
  }
  // シード値の間で重複した分は、残りから追加で抜き取って件数をそろえる
  if (out.length < n) {
    out.push(...sample(pool.filter((x) => !seen.has(x.e.id)), n - out.length, seeds[0] + 1));
  }
  return out;
}

/**
 * 3 つの辞書の抜き取り。L 除外辞書は検証済み辞書の一部なので、検証済みの抜き取りのうち
 * L 除外辞書に入る候補はそのまま使い（一様な抜き取りの部分集合も一様）、足りない分だけ
 * 残りから追加で抜き取る
 */
export function drawSamples(
  volumes: CleanVolume[],
  inNoL: (e: CleanEntry) => boolean,
  n: number,
  seeds: number[],
): Record<DictionaryName, Item[]> {
  const all = volumes.flatMap((v) => v.entries.map((e) => ({ pid: v.pid, e })));
  const verifiedPool = all.filter(({ e }) => e.status === "accepted");
  const noLPool = verifiedPool.filter(({ e }) => inNoL(e));
  const unverifiedPool = all.filter(({ e }) => e.status === "unverified");

  const verified = drawMany(verifiedPool, n, seeds);
  const reused = verified.filter(({ e }) => inNoL(e)).slice(0, n);
  const taken = new Set(reused.map(({ e }) => e.id));
  const topUp = sample(
    noLPool.filter(({ e }) => !taken.has(e.id)),
    n - reused.length,
    seeds[0] + 7919,
  );
  return {
    verified,
    noL: [...reused, ...topUp],
    unverified: drawMany(unverifiedPool, n, seeds),
  };
}

const COLUMNS = [
  "no",
  "id",
  "skk_key",
  "notation",
  "reading",
  "method",
  "judgment",
  "note",
] as const;

type Row = Record<(typeof COLUMNS)[number], string>;

export function parseTsv(text: string): Row[] {
  const [head, ...lines] = text.split("\n").filter((l) => l.trim());
  const cols = head.split("\t");
  return lines.map((l) => {
    const cells = l.split("\t");
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""])) as Row;
  });
}

const judgmentKey = (r: Pick<Row, "id" | "skk_key" | "notation">) =>
  `${r.id}\t${r.skk_key}\t${r.notation}`;

/** 過去の判定（docs/accuracy/ 以下のすべての一覧）。id・見出し・表記が同じ候補の判定を引き継ぐ */
async function knownJudgments(docsDir: string): Promise<Map<string, Row>> {
  const known = new Map<string, Row>();
  const root = accuracyPaths.root(docsDir);
  if (!(await exists(root))) return known;
  for await (const label of Deno.readDir(root)) {
    if (!label.isDirectory) continue;
    for await (const f of Deno.readDir(join(root, label.name))) {
      if (!f.name.endsWith(".tsv")) continue;
      for (const r of parseTsv(await Deno.readTextFile(join(root, label.name, f.name)))) {
        if (r.judgment === "o" || r.judgment === "x") known.set(judgmentKey(r), r);
      }
    }
  }
  return known;
}

export async function writeSamples(
  samples: Record<DictionaryName, Item[]>,
  { docsDir, distDir, label, images }: {
    docsDir: string;
    distDir: string;
    label: string;
    images: boolean;
  },
): Promise<Record<DictionaryName, { total: number; pending: number }>> {
  const known = await knownJudgments(docsDir);
  const sheets = accuracyPaths.sheets(distDir, label);
  await ensureDir(sheets);
  const summary = {} as Record<DictionaryName, { total: number; pending: number }>;
  for (const name of DICTIONARIES) {
    const items = samples[name];
    const rows = items.map(({ e }, i): Row => {
      const r = {
        no: String(i + 1),
        id: e.id,
        skk_key: e.skkKey ?? "",
        notation: e.notation ?? "",
        reading: e.reading,
        method: e.method,
        judgment: "",
        note: "",
      };
      const prev = known.get(judgmentKey(r));
      return prev ? { ...r, judgment: prev.judgment, note: prev.note } : r;
    });
    const path = accuracyPaths.tsv(docsDir, label, name);
    await ensureDir(join(path, ".."));
    await Deno.writeTextFile(
      path,
      [COLUMNS.join("\t"), ...rows.map((r) => COLUMNS.map((c) => r[c]).join("\t"))].join("\n") +
        "\n",
    );
    // 紙面の切り出しは未判定の候補だけ（一覧で judgment が空の行を上から順に並べる）
    if (images) {
      // 画像ライブラリは切り出しを作るときだけ読み込む
      const { writeSheets } = await import("./accuracy_sheets.ts");
      await writeSheets(items.filter((_, i) => !rows[i].judgment), sheets, name);
    }
    summary[name] = { total: rows.length, pending: rows.filter((r) => !r.judgment).length };
  }
  return summary;
}

/** Wilson スコア区間（95%） */
export function wilson(k: number, n: number, z = 1.959964): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const denom = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const half = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export type AccuracyResult = {
  name: DictionaryName;
  file: string;
  n: number;
  correct: number;
  rate: number;
  ci: [number, number];
  errors: Row[];
};

export async function computeAccuracy(docsDir: string, label: string): Promise<AccuracyResult[]> {
  const results: AccuracyResult[] = [];
  for (const name of DICTIONARIES) {
    const rows = parseTsv(await Deno.readTextFile(accuracyPaths.tsv(docsDir, label, name)));
    const pending = rows.filter((r) => r.judgment !== "o" && r.judgment !== "x");
    if (pending.length > 0) {
      throw new Error(
        `${name}: 判定の無い行が ${pending.length} 件あります（no ${
          pending.slice(0, 10).map((r) => r.no).join(", ")
        } …）`,
      );
    }
    const correct = rows.filter((r) => r.judgment === "o").length;
    results.push({
      name,
      file: DICTIONARY_FILES[name],
      n: rows.length,
      correct,
      rate: correct / rows.length,
      ci: wilson(correct, rows.length),
      errors: rows.filter((r) => r.judgment === "x"),
    });
  }
  return results;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export type SvgOptions = {
  meta?: SampleMeta;
  /** 基準線（既定 0.99） */
  target: number;
  /** 拡大図の軸の下限（既定 0.95）。信頼区間の下限がこれ以上の辞書を拡大図にも載せる */
  zoomMin: number;
  /** 図を出力した日 */
  measuredAt: string;
  /** シード値を判定より前に記録したかの確認結果 */
  preregistration: Preregistration;
  /** 人の確認が必要か、実施したか */
  humanCheck: HumanCheck;
};

export type Preregistration = {
  /** シード値を記録した sample.json を最初に含むコミット */
  seedCommit?: { hash: string; date: string };
  /** 判定（o / x）を最初に含むコミット */
  judgedCommit?: { hash: string; date: string };
  /** シード値の記録が判定を含むコミットより前（祖先）にあるか */
  verified: boolean;
  summary: string;
};

type Commit = { full: string; hash: string; date: string };

async function runGit(repoRoot: string, ...args: string[]) {
  const out = await new Deno.Command("git", { args, cwd: repoRoot }).output()
    .catch(() => undefined);
  return {
    ok: out?.success ?? false,
    text: out ? new TextDecoder().decode(out.stdout).trim() : "",
  };
}

/**
 * シード値を判定より前に記録したか（結果を見て選び直していないか）を git の履歴で確かめる。
 * sample.json（シード値と件数）を最初に含むコミットが、判定（o / x）を最初に含むコミットの
 * 祖先（別のより前のコミット）なら確認できたとする
 */
export async function checkPreregistration(
  repoRoot: string,
  docsDir: string,
  label: string,
  note?: string,
): Promise<Preregistration> {
  const rel = (p: string) => p.slice(repoRoot.length).replace(/^\//, "");
  const commits = async (path: string): Promise<Commit[]> =>
    (await runGit(repoRoot, "log", "--reverse", "--format=%H %h %cs", "--", rel(path))).text
      .split("\n").filter(Boolean).map((l) => {
        const [full, hash, date] = l.split(" ");
        return { full, hash, date };
      });
  const seedCommit = (await commits(accuracyPaths.meta(docsDir, label)))[0];
  let judgedCommit: Commit | undefined;
  for (const name of DICTIONARIES) {
    const path = accuracyPaths.tsv(docsDir, label, name);
    for (const c of await commits(path)) {
      const { text } = await runGit(repoRoot, "show", `${c.full}:${rel(path)}`);
      if (parseTsv(text).some((r) => r.judgment === "o" || r.judgment === "x")) {
        const earlier = !judgedCommit ||
          (await runGit(repoRoot, "merge-base", "--is-ancestor", c.full, judgedCommit.full)).ok;
        if (earlier) judgedCommit = c;
        break;
      }
    }
  }
  const verified = Boolean(
    seedCommit && judgedCommit && seedCommit.full !== judgedCommit.full &&
      (await runGit(repoRoot, "merge-base", "--is-ancestor", seedCommit.full, judgedCommit.full))
        .ok,
  );
  const summary = verified
    ? `確認済み（シード値の記録 ${seedCommit!.hash} ${seedCommit!.date} → 判定の記録 ${
      judgedCommit!.hash
    } ${judgedCommit!.date}）`
    : `未確認（${
      note ?? (!seedCommit
        ? "シード値を記録した sample.json がまだコミットされていない"
        : `シード値の記録 ${seedCommit.hash} が判定を含むコミットより前にない`)
    }）`;
  return {
    seedCommit: seedCommit && { hash: seedCommit.hash, date: seedCommit.date },
    judgedCommit: judgedCommit && { hash: judgedCommit.hash, date: judgedCommit.date },
    verified,
    summary,
  };
}

export type HumanCheck = {
  /** 人の確認が必要か */
  required: boolean;
  /** 必要な理由 */
  reasons: string[];
  summary: string;
};

/** 人の確認で、AI が o とした候補から見る件数（辞書ごと） */
export const HUMAN_CHECK_O_SAMPLE = 50;

/**
 * n 件を見て 90% の確率で 1 件以上見つかる誤判定の率（1 - 0.1^(1/n)）。
 * これより低い率の誤判定は、確認しても見つからないことが多い
 */
export function detectableRate(n: number, power = 0.9): number {
  return 1 - Math.pow(1 - power, 1 / n);
}

/** 抜き取りの条件の文言（450 件・シード値 3 つなら「450 件（150 件ずつ 3 回、シード値 101、202、303）」） */
export function describeDraw(meta?: SampleMeta): string {
  if (!meta) return "? 件";
  const { n, seeds } = meta;
  return seeds.length > 1
    ? `${n} 件（${Math.ceil(n / seeds.length)} 件ずつ ${seeds.length} 回、シード値 ${
      seeds.join("、")
    }）`
    : `${n} 件（シード値 ${seeds[0]}）`;
}

/** "cb202ad (v1.0.0)" や "cb202ad-dirty" からハッシュを取り出す */
const commitHash = (c?: string) => c?.split(" ")[0].replace(/-dirty$/, "");

/**
 * 人の確認が必要かを、前回の評価（ほかのラベルで直前に抜き取ったもの）と比べて決める。
 * 必要になるのは、最初の評価、OCR 済みの入力が変わったとき（OCR のエンジン・設定の変更を含む）、
 * HUMAN_CHECK_PATHS のファイル（OCR・クレンジングの規則、辞書への振り分け）が変わったとき、
 * 抜き取ったときに未コミットの変更があったとき
 */
export async function checkHumanReview(
  repoRoot: string,
  docsDir: string,
  label: string,
  meta?: SampleMeta,
): Promise<HumanCheck> {
  const prev = (await otherSampleMetas(docsDir, label))
    .filter(({ meta: m }) => !meta || m.sampledAt < meta.sampledAt).at(-1);
  const reasons: string[] = [];
  if (!prev) {
    reasons.push("最初の評価");
  } else {
    if (!meta?.inputs || !prev.meta.inputs || meta.inputs !== prev.meta.inputs) {
      reasons.push(`OCR 済みの入力が ${prev.label} と異なるか、記録が無い`);
    }
    const from = commitHash(prev.meta.commit);
    const to = commitHash(meta?.commit);
    const diff = from && to
      ? await runGit(repoRoot, "diff", "--name-only", from, to, "--", ...HUMAN_CHECK_PATHS)
      : undefined;
    if (!diff?.ok) reasons.push(`${prev.label} からの規則の変更を履歴で確かめられない`);
    else if (diff.text) {
      reasons.push(`${prev.label} から規則が変わった（${diff.text.split("\n").join("、")}）`);
    }
  }
  if (meta?.commit?.includes("-dirty")) reasons.push("抜き取ったときに未コミットの変更があった");
  const required = reasons.length > 0;
  const summary = !required
    ? `不要（${prev!.label} から OCR 済みの入力と規則に変更なし）`
    : meta?.humanCheck
    ? `実施（${meta.humanCheck}。o から辞書ごとに ${HUMAN_CHECK_O_SAMPLE} 件の確認で見つけられるのは、AI の誤判定の率がおよそ ${
      Math.round(detectableRate(HUMAN_CHECK_O_SAMPLE) * 100)
    }% 以上の場合。理由: ${reasons.join("、")}）`
    : `必要だが未実施（理由: ${reasons.join("、")}）`;
  return { required, reasons, summary };
}

/** 注記を幅に収まるよう折り返す（全角を 1 字、半角を 0.55 字として概算する。英数字の語は切らず、句読点を行頭に置かない） */
function wrap(text: string, width: number, fontSize: number): string[] {
  const out: string[] = [];
  let line = "";
  let w = 0;
  // 英数字の連なりは途中で切らない
  for (const ch of text.match(/[\w.,()-]+|./gu) ?? []) {
    const cw = [...ch].reduce(
      (sum, c) => sum + (c.codePointAt(0)! < 0x2000 ? 0.55 : 1) * fontSize,
      0,
    );
    // 句読点と閉じ括弧は行頭に置かない（少しはみ出しても前の行に付ける）
    if (w + cw > width && line && !/^[、。，．）」』]/.test(ch)) {
      out.push(line);
      line = "　";
      w = fontSize;
    }
    line += ch;
    w += cw;
  }
  if (line) out.push(line);
  return out;
}

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

/** 1 つのパネル（軸 [min, max]）を描き、SVG 要素と高さを返す */
function panel(
  results: AccuracyResult[],
  { y0, min, max, title, target, left, plotW, footnote }: {
    y0: number;
    /** パネルの下に添える一行 */
    footnote?: string;
    min: number;
    max: number;
    title: string;
    target: number;
    left: number;
    plotW: number;
  },
): { svg: string; height: number } {
  const rowH = 66;
  const top = y0 + 30;
  const plotBottom = top + rowH * results.length;
  const x = (v: number) => left + ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * plotW;
  // 目盛りは切りのよい刻み（0〜100% なら 25%、95〜100% なら 1%）
  const step = [0.01, 0.02, 0.05, 0.1, 0.25].find((s) => (max - min) / s <= 6) ?? 0.25;
  const ticks = Array.from(
    { length: Math.floor((max - min) / step + 1e-9) + 1 },
    (_, i) => max - step * i,
  ).reverse();
  const fmtTick = (t: number) => `${Number((t * 100).toFixed(2))}%`;
  const grid = ticks.map((t) => `
  <line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${plotBottom}"/>
  <text class="sub" x="${x(t)}" y="${plotBottom + 18}" text-anchor="middle">${fmtTick(t)}</text>`)
    .join("");
  const targetLine = target > min && target < max
    ? `
  <line class="target" x1="${x(target)}" x2="${x(target)}" y1="${top - 6}" y2="${plotBottom}"/>
  <text class="target-label" x="${x(target)}" y="${top - 10}" text-anchor="middle">基準 ${
      fmtTick(target)
    }</text>`
    : "";
  const rows = results.map((r, i) => {
    // 辞書名は区間の上に左寄せで置き、区間と点はその下の行に描く
    const yLabel = top + rowH * i + 16;
    const y = yLabel + 22;
    const [lo, hi] = r.ci;
    return `
  <g>
    <title>${esc(r.file)}: ${pct(r.rate)}（95% 信頼区間 ${pct(lo)}〜${
      pct(hi)
    }、${r.correct}/${r.n}）</title>
    <text class="label" x="${left}" y="${yLabel}">${
      esc(r.file)
    }<tspan class="count" dx="10">サンプル数 ${r.n} 件（正しい ${r.correct} 件）</tspan></text>
    <line class="ci" x1="${x(lo)}" x2="${x(hi)}" y1="${y}" y2="${y}"/>
    <line class="ci" x1="${x(lo)}" x2="${x(lo)}" y1="${y - 6}" y2="${y + 6}"/>
    <line class="ci" x1="${x(hi)}" x2="${x(hi)}" y1="${y - 6}" y2="${y + 6}"/>
    <circle class="dot" cx="${x(r.rate)}" cy="${y}" r="5"/>
    <text class="value" x="${left + plotW + 16}" y="${y - 2}">${pct(r.rate)}</text>
    <text class="sub" x="${left + plotW + 16}" y="${y + 14}">${pct(lo)}〜${pct(hi)}</text>
  </g>`;
  }).join("");
  return {
    svg: `
  <text class="panel-title" x="${left}" y="${y0 + 6}">${
      esc(title)
    }</text>${grid}${targetLine}${rows}${
      footnote
        ? `
  <text class="sub" x="${left}" y="${plotBottom + 40}">${esc(footnote)}</text>`
        : ""
    }`,
    height: plotBottom + (footnote ? 52 : 30) - y0,
  };
}

/**
 * 正解率と 95% 信頼区間のグラフ（横向きの点と区間）。
 * 0〜100% の図に加え、信頼区間の下限が zoomMin 以上の辞書を zoomMin〜100% の軸で拡大した図を添える。
 * 基準線（target）を引き、判定の方法・抜き取りの条件（シード値、件数、日付、コミット）を注記に印字する。
 * 1 系列なので凡例は付けず、値は点の横に直接書く。明暗は prefers-color-scheme で切り替える
 */
export function renderSvg(results: AccuracyResult[], label: string, opts: SvgOptions): string {
  const W = 720;
  const left = 24;
  const plotW = W - left - 150;
  const full = panel(results, {
    y0: 64,
    min: 0,
    max: 1,
    title: "0〜100% の軸",
    target: opts.target,
    left,
    plotW,
  });
  const zoomed = results.filter((r) => r.ci[0] >= opts.zoomMin);
  const outside = results.filter((r) => r.ci[0] < opts.zoomMin);
  const zoom = zoomed.length > 0
    ? panel(zoomed, {
      y0: 64 + full.height + 16,
      min: opts.zoomMin,
      max: 1,
      title: `拡大（${Number((opts.zoomMin * 100).toFixed(2))}〜100% の軸）`,
      target: opts.target,
      left,
      plotW,
      footnote: outside.length > 0
        ? `範囲外のため載せていない辞書: ${
          outside.map((r) => `${r.file}（${pct(r.rate)}）`).join("、")
        }`
        : undefined,
    })
    : { svg: "", height: 0 };
  const m = opts.meta;
  const notes = [
    `点は正解率、線は 95% 信頼区間（Wilson スコア区間）、破線は基準 ${pct(opts.target)}。`,
    `判定: ${
      m?.judge ?? DEFAULT_JUDGE
    }（SKK の見出しと表記の両方が紙面の見出しと合うものを正とする。注釈は評価の対象外）。`,
    `抜き取り: 各辞書から無作為に ${describeDraw(m)}、${
      m?.sampledAt.slice(0, 10) ?? "?"
    }、コミット ${m?.commit ?? "?"}。`,
    `図の出力: ${opts.measuredAt}。`,
    `シード値の事前記録: ${opts.preregistration.summary}`,
    `人の確認: ${opts.humanCheck.summary}`,
    ...(m?.caveat ? [`注意: ${m.caveat}`] : []),
  ];
  const lines = notes.flatMap((n) => wrap(n, W - left * 2, 10.5));
  const notesTop = 64 + full.height + (zoom.height ? zoom.height + 16 : 0) + 12;
  const H = notesTop + lines.length * 16 + 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="title desc">
  <title id="title">辞書ごとの正解率（${esc(label)}）</title>
  <desc id="desc">${
    results.map((r) =>
      `${r.file}: ${pct(r.rate)}（95% 信頼区間 ${pct(r.ci[0])}〜${
        pct(r.ci[1])
      }、${r.correct}/${r.n}）`
    ).join("、")
  }。${esc(notes.join(" "))}</desc>
  <style>
    svg { --surface: #fcfcfb; --text-primary: #0b0b0b; --text-secondary: #52514e; --grid: #e4e3df; --series-1: #2a78d6; --target: #52514e; }
    @media (prefers-color-scheme: dark) {
      svg { --surface: #1a1a19; --text-primary: #ffffff; --text-secondary: #c3c2b7; --grid: #3a3a37; --series-1: #3987e5; --target: #c3c2b7; }
    }
    .bg { fill: var(--surface); }
    text { font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif; }
    .title { fill: var(--text-primary); font-size: 16px; font-weight: 600; }
    .panel-title { fill: var(--text-primary); font-size: 12px; font-weight: 600; }
    .label { fill: var(--text-primary); font-size: 13px; }
    .value { fill: var(--text-primary); font-size: 13px; font-weight: 600; }
    .sub { fill: var(--text-secondary); font-size: 11px; font-weight: 400; }
    .count { fill: var(--text-secondary); font-size: 12px; font-weight: 400; }
    .note { fill: var(--text-secondary); font-size: 10.5px; }
    .grid { stroke: var(--grid); stroke-width: 1; }
    .target { stroke: var(--target); stroke-width: 1; stroke-dasharray: 4 3; }
    .target-label { fill: var(--text-secondary); font-size: 10.5px; }
    .ci { stroke: var(--series-1); stroke-width: 2; stroke-linecap: round; }
    .dot { fill: var(--series-1); stroke: var(--surface); stroke-width: 2; }
  </style>
  <rect class="bg" width="${W}" height="${H}" rx="8"/>
  <text class="title" x="${left}" y="34">辞書ごとの正解率と 95% 信頼区間（${
    esc(label)
  }）</text>${full.svg}${zoom.svg}
${
    lines.map((n, i) =>
      `  <text class="note" x="${left}" y="${notesTop + 12 + i * 16}">${esc(n)}</text>`
    ).join("\n")
  }
</svg>
`;
}

export function renderMarkdown(
  results: AccuracyResult[],
  label: string,
  svgPath: string,
  prereg: Preregistration,
  humanCheck: HumanCheck,
  meta?: SampleMeta,
): string {
  const rows = results.map((r) =>
    `| \`${r.file}\` | ${r.correct} / ${r.n} | ${pct(r.rate)} | ${pct(r.ci[0])}〜${pct(r.ci[1])} |`
  );
  return `![辞書ごとの正解率と 95% 信頼区間（${label}）](${svgPath})

| 辞書（${label}） | 正しい / 抜き取り | 正解率 | 95% 信頼区間 |
| --- | ---: | ---: | ---: |
${rows.join("\n")}

- 抜き取りの条件: 各辞書から ${
    describeDraw(meta)
  }（[docs/accuracy/${label}/sample.json](docs/accuracy/${label}/sample.json)）
- シード値の事前記録: ${prereg.summary}
- 人の確認: ${humanCheck.summary}
${meta?.caveat ? `- 注意: ${meta.caveat}\n` : ""}`;
}

const START = "<!-- accuracy:start -->";
const END = "<!-- accuracy:end -->";

/** README の <!-- accuracy:start --> 〜 <!-- accuracy:end --> を置き換える */
export function replaceSection(readme: string, body: string): string {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) throw new Error(`README に ${START} と ${END} がありません`);
  return readme.slice(0, a + START.length) + "\n\n" + body + "\n" + readme.slice(b);
}
