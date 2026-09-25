import { parseArgs } from "@std/cli/parse-args";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import {
  BLOCKED_MAX_RETRIES,
  BLOCKED_WAIT_MS,
  DEFAULT_VOLUMES,
  DIST_DIR,
  FIRST_EDITION_YEARS,
  IMAGE_INTERVAL_MS,
  paths,
  REPO_ROOT,
} from "./config.ts";
import { BlockedError, download } from "./http.ts";
import { imageFileName, isInternetPublic, ndlUrls, parseManifest } from "./ndl.ts";
import { ndlocrLiteConfigFromEnv, runNdlocrLite } from "./ndlocr_lite.ts";
import { type ExtractVolume, extractVolume } from "./extract.ts";
import { buildContext, cleanseVolume, type CleanVolume } from "./cleanse.ts";
import { buildDicts, forEucJp, renderDict, renderReport, renderTsv } from "./build.ts";
import { encodeEucJp } from "./eucjp.ts";
import { compareBuilds } from "./compare.ts";
// 見出しの切り出し（recheck、review）は画像ライブラリを使うので、そのコマンドのときだけ読み込む。
// cleanse・build は画像もネットワークも使わずに動く（CI で実行する）
import type { RecheckVolume } from "./recheck.ts";
import { recheckPaths } from "./recheck_paths.ts";
import { fetchResources, loadSkkL, loadUnihan, resourcePaths } from "./resources.ts";
import { loadJmdict } from "./jmdict.ts";
import {
  extractNdlVolume,
  fromNdlExtractJson,
  type NdlCandidate,
  toNdlExtractJson,
} from "./extract_ndl.ts";
import { buildWork, type WorkSource, type WorkVolume } from "./work.ts";

const USAGE =
  `Usage: deno task <fetch|ocr|work|extract|resources|cleanse|build|compare|all> [options] [pid...]

pid を省略すると初版全4巻 (${DEFAULT_VOLUMES.map((v) => v.pid).join(", ")}) を対象にする。

fetch  NDL から書誌・IIIF manifest・NDLラボ全文テキスト・画像を取得して data/raw/ndl/<pid>/ に保存する。
  --pages <a-b>    画像を取得するコマ範囲（例: 10-20）
  --force          取得済みでも再取得する
ocr    画像に ndlocr-lite を実行し、出力を data/raw/ndlocr-lite/<pid>/ に保存する。
       OCR 済みの画像はスキップする（中断しても続きから処理する）。
  --force-ocr      既存の出力を退避し、全画像を OCR し直す
work   生データから作業用 JSON を data/work/<pid>.json に生成する。
  --source <ndl-lab-fulltext|ndlocr-lite>  使用する生データ（既定: ndlocr-lite の結果があれば ndlocr-lite）
extract  作業用 JSON から見出し語・表記の候補を data/extract/<pid>.json に抽出する。
resources  クレンジングに使う SKK-JISYO.L と Unihan を取得する。
cleanse  候補を SKK-JISYO.L・Unihan・NDL 側 OCR と照合して補正し、data/cleanse/<pid>.json に保存する。
build  クレンジング結果から SKK 辞書とレポートを dist/ に出力する（pid の指定は対象の絞り込み）。
recheck  検証済み・未検証の候補のうち NDL 側 OCR と読みが一致しないものの見出しを切り出して
       ndlocr-lite で読み直し、data/recheck/<pid>.json に保存する（検証済みを先に処理する）。
       --status <accepted|unverified>  対象を絞る
       --full  見出しの列の全体を切り出して読み直す（表記まで写す）。系統間で読みか表記が一致せずに
               未検証にした候補が対象で、data/recheck-full/<pid>.json に保存する|unverified>  対象を絞る
accuracy sample  3 つの辞書（検証済み・L 除外・未検証）から候補を無作為に抜き取り、判定用の一覧
       （docs/accuracy/<label>/*.tsv）と紙面の切り出し（dist/accuracy/<label>/）を出力する。
       過去の同じ候補の判定は引き継ぐ。一覧の judgment 列に o / x を記入する。
       --n <件数>（既定 450） --seed <シード値,...>（既定は乱数。複数なら件数を等分）
       使ったシード値と件数は docs/accuracy/<label>/sample.json に記録し、同じラベルでは再利用する。
       --label <名前>（既定 latest） --no-images（切り出しを作らない） --judge <判定の方法>
       --dicts <辞書,...>（verified, noL, unverified。既定 すべて）
       ほかのラベルで使ったシード値は拒む（過去の評価を再現するときだけ --reuse-seed を付ける）。
accuracy report  判定を集計して正解率と 95% 信頼区間（Wilson）を求め、グラフ
       （docs/accuracy/<label>.svg）と README の表を更新する。 --label <名前>
       --target <基準>（既定 0.99） --zoom-min <拡大図の軸の下限>（既定 0.95）
       --judge <判定の方法>（既定「AI（Claude）が紙面画像と照合」。sample.json に記録する）
       --human-check <人が行った確認の内容>（sample.json に記録する）
review  正解率の抜き取り評価用に、区分ごとに候補を無作為に抜き取り、紙面の切り出しと一覧を
       dist/review/ に出力する。
       --n <件数>（既定 30） --seed <シード値>（既定 1） --strata <区分,...>（既定 すべて）
compare <旧 cleanse ディレクトリ> <新 cleanse ディレクトリ>  2 つのビルドを比べた結果を出力する。
all    fetch → ocr → work → extract を順に実行する。`;

function parsePages(s: string | undefined): ((frame: number) => boolean) | undefined {
  if (!s) return undefined;
  const ranges = s.split(",").map((r) => {
    const [a, b] = r.split("-").map(Number);
    return [a, b ?? a] as const;
  });
  return (f) => ranges.some(([a, b]) => a <= f && f <= b);
}

/** 画像を取得する。アクセス制限（403）に掛かったら時間を置いて再開する */
async function downloadImage(url: string, dest: string, force: boolean) {
  for (let attempt = 1;; attempt++) {
    try {
      return await download(url, dest, {
        force,
        missingStatuses: [404],
        intervalMs: IMAGE_INTERVAL_MS,
      });
    } catch (e) {
      if (!(e instanceof BlockedError) || attempt > BLOCKED_MAX_RETRIES) throw e;
      console.warn(
        `  ${e.message}。${
          BLOCKED_WAIT_MS / 60_000
        }分待って再開します (${attempt}/${BLOCKED_MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, BLOCKED_WAIT_MS));
    }
  }
}

async function fetchVolume(pid: string, opts: { force: boolean; pages?: string }) {
  const force = opts.force;
  console.log(`[fetch] ${pid}`);
  // 初版以外が混入しないよう、刊行年を確認してから他のデータを取得する
  const bookResult = await download(ndlUrls.labBook(pid), paths.labBookJson(pid), { force });
  if (bookResult === "missing") throw new Error(`${pid}: ${ndlUrls.labBook(pid)} が取得できません`);
  const book = JSON.parse(await Deno.readTextFile(paths.labBookJson(pid)));
  if (
    !(FIRST_EDITION_YEARS.min <= book.publishyear && book.publishyear <= FIRST_EDITION_YEARS.max)
  ) {
    await Deno.remove(paths.rawNdl(pid), { recursive: true });
    throw new Error(
      `${pid}: 刊行年 ${book.publishyear} は初版 (${FIRST_EDITION_YEARS.min}-${FIRST_EDITION_YEARS.max}) の範囲外のため取得しません`,
    );
  }
  console.log(`  ${bookResult}: ${paths.labBookJson(pid)}`);

  for (
    const [url, dest] of [
      [ndlUrls.item(pid), paths.itemJson(pid)],
      [ndlUrls.manifest(pid), paths.manifestJson(pid)],
    ] as const
  ) {
    const r = await download(url, dest, { force });
    if (r === "missing") throw new Error(`${pid}: ${url} が取得できません`);
    console.log(`  ${r}: ${dest}`);
  }

  const item = JSON.parse(await Deno.readTextFile(paths.itemJson(pid)));
  if (!isInternetPublic(item)) {
    throw new Error(`${pid}: インターネット公開資料ではありません (${item.item.permission.type})`);
  }

  const ft = await download(ndlUrls.labFulltext(pid), paths.labFulltextJson(pid), { force });
  console.log(`  fulltext ${ft}: ${paths.labFulltextJson(pid)}`);

  const inRange = parsePages(opts.pages) ?? (() => true);
  const canvases = parseManifest(JSON.parse(await Deno.readTextFile(paths.manifestJson(pid))))
    .filter((c) => inRange(c.frame));
  await ensureDir(paths.imagesDir(pid));
  for (const [i, c] of canvases.entries()) {
    const dest = join(paths.imagesDir(pid), imageFileName(c.frame));
    const r = await downloadImage(c.imageUrl, dest, force);
    if (r === "missing") throw new Error(`${pid}: 画像が取得できません ${c.imageUrl}`);
    if (r === "downloaded") console.log(`  image ${i + 1}/${canvases.length}: ${dest}`);
  }
}

async function ocrVolume(pid: string, opts: { forceOcr: boolean }) {
  console.log(`[ocr] ${pid}`);
  await runNdlocrLite(pid, ndlocrLiteConfigFromEnv(), { force: opts.forceOcr });
}

async function workVolume(pid: string, source?: WorkSource) {
  console.log(`[work] ${pid}`);
  const work = await buildWork(pid, source);
  const dest = paths.workJson(pid);
  await ensureDir(dirname(dest));
  await Deno.writeTextFile(dest, JSON.stringify(work, null, 2) + "\n");
  console.log(`  ${work.source.kind}: ${work.pages.length} pages -> ${dest}`);
}

async function extractStep(pid: string) {
  console.log(`[extract] ${pid}`);
  const work: WorkVolume = JSON.parse(await Deno.readTextFile(paths.workJson(pid)));
  const result = extractVolume(work);
  const dest = paths.extractJson(pid);
  await ensureDir(dirname(dest));
  await Deno.writeTextFile(dest, JSON.stringify(result, null, 2) + "\n");
  const kinds = Object.entries(Object.groupBy(result.candidates, (c) => c.notationKind))
    .map(([k, v]) => `${k}=${v?.length}`).join(" ");
  console.log(`  ${result.candidates.length} candidates (${kinds}) -> ${dest}`);
}

/**
 * NDL 側 OCR の候補を読み込む。キャッシュ（data/extract-ndl/）があればそれを使い、
 * 無ければ NDLラボ全文テキストから取り出してキャッシュする
 */
async function loadNdlCandidates(pid: string): Promise<Map<number, NdlCandidate[]>> {
  const cache = paths.extractNdlJson(pid);
  try {
    return fromNdlExtractJson(JSON.parse(await Deno.readTextFile(cache)));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const work = await buildWork(pid, "ndl-lab-fulltext").catch(() => undefined);
  if (!work) {
    console.warn(`  ${pid}: NDL 側 OCR の候補がありません（突き合わせをせずに続けます）`);
    return new Map();
  }
  const ndl = extractNdlVolume(work);
  await ensureDir(dirname(cache));
  await Deno.writeTextFile(cache, JSON.stringify(toNdlExtractJson(pid, ndl)) + "\n");
  return ndl;
}

async function cleanseStep(pids: string[]) {
  const [L, unihan, jm] = await Promise.all([
    loadSkkL(),
    loadUnihan(),
    Deno.env.get("NO_JMDICT") ? undefined : loadJmdict(resourcePaths.jmdict),
  ]);
  const ctx = buildContext(L, unihan, jm);
  for (const pid of pids) {
    console.log(`[cleanse] ${pid}`);
    const extract: ExtractVolume = JSON.parse(await Deno.readTextFile(paths.extractJson(pid)));
    const ndl = await loadNdlCandidates(pid);
    const recheck = await Deno.readTextFile(paths.recheckJson(pid))
      .then((t) => (JSON.parse(t) as RecheckVolume).results)
      .catch(() => ({}));
    const recheckFull = await Deno.readTextFile(recheckPaths.json(pid, "full"))
      .then((t) => (JSON.parse(t) as RecheckVolume).results)
      .catch(() => ({}));
    const result = cleanseVolume(extract, ndl, ctx, recheck, recheckFull);
    const dest = paths.cleanseJson(pid);
    await ensureDir(dirname(dest));
    await Deno.writeTextFile(dest, JSON.stringify(result, null, 2) + "\n");
    const statuses = Object.entries(Object.groupBy(result.entries, (e) => e.status))
      .map(([k, v]) => `${k}=${v?.length}`).join(" ");
    console.log(`  ${result.entries.length} entries (${statuses}) -> ${dest}`);
  }
}

async function buildStep(pids: string[]) {
  const L = await loadSkkL();
  const volumes: CleanVolume[] = [];
  for (const pid of pids) {
    volumes.push(JSON.parse(await Deno.readTextFile(paths.cleanseJson(pid))));
  }
  const dicts = buildDicts(volumes, L);
  await ensureDir(DIST_DIR);
  const name = "SKK-JISYO.dainihonkokugojiten";
  const kinds: [string, keyof typeof dicts, string][] = [
    [name, "verified", "検証済みのエントリ"],
    [`${name}.noL`, "noL", "検証済みのうち SKK-JISYO.L に無い候補"],
    [`${name}.unverified`, "unverified", "検証できなかったエントリ（誤りを多く含む）"],
  ];
  // 辞書は UTF-8 版（utf-8/）と、従来の SKK 辞書と同じ EUC-JP 版（euc-jp/）を出す
  const dropped: string[] = [];
  for (const encoding of ["utf-8", "euc-jp"] as const) {
    const dir = join(DIST_DIR, encoding);
    await ensureDir(dir);
    for (const [file, key, description] of kinds) {
      const path = join(dir, file);
      if (encoding === "utf-8") {
        await Deno.writeTextFile(path, renderDict(dicts[key], file, description, encoding));
      } else {
        const { dict, dropped: n } = forEucJp(dicts[key]);
        dropped.push(`- ${file}: ${n}`);
        await Deno.writeFile(path, encodeEucJp(renderDict(dict, file, description, encoding)));
      }
      console.log(`  -> ${path}`);
    }
  }
  const outputs: [string, string][] = [
    ["entries.tsv", renderTsv(volumes)],
    [
      "report.md",
      renderReport(volumes, dicts) +
      "\n## EUC-JP 版で除いた候補\n\nJIS X 0208 に無い文字を含む候補の数。\n\n" +
      dropped.join("\n") + "\n",
    ],
  ];
  for (const [file, text] of outputs) {
    await Deno.writeTextFile(join(DIST_DIR, file), text);
    console.log(`  -> ${join(DIST_DIR, file)}`);
  }
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["force", "force-ocr", "help", "images", "reuse-seed", "full"],
    string: [
      "pages",
      "source",
      "status",
      "n",
      "seed",
      "strata",
      "label",
      "judge",
      "target",
      "zoom-min",
      "human-check",
      "dicts",
    ],
    default: { images: true },
    negatable: ["images"],
  });
  const [command, ...rest] = args._.map(String);
  if (args.help || !command) {
    console.log(USAGE);
    Deno.exit(command ? 0 : 1);
  }
  const pids = rest.length > 0 ? rest : DEFAULT_VOLUMES.map((v) => v.pid);
  const source = args.source as WorkSource | undefined;
  if (source && source !== "ndl-lab-fulltext" && source !== "ndlocr-lite") {
    console.error(`unknown --source: ${source}`);
    Deno.exit(1);
  }

  const opts = {
    force: args.force,
    forceOcr: args["force-ocr"],
    pages: args.pages,
  };
  if (command === "resources") {
    await fetchResources({ force: args.force });
    Deno.exit(0);
  }
  if (command === "cleanse") {
    await cleanseStep(pids);
    Deno.exit(0);
  }
  if (command === "recheck") {
    const { collectResults, makeCrops, ocrCrops, recheckPaths, targets } = await import(
      "./recheck.ts"
    );
    const mode = args.full ? "full" : "head";
    const statuses = args.status ? [args.status] : ["accepted", "unverified"];
    for (const status of statuses) {
      for (const pid of pids) {
        const volume: CleanVolume = JSON.parse(await Deno.readTextFile(paths.cleanseJson(pid)));
        const list = targets(volume, mode).filter((e) => e.status === status);
        console.log(`[recheck] ${pid} ${status} ${mode}: ${list.length} entries`);
        const count = await makeCrops(pid, list, mode);
        await ocrCrops(pid, count, ndlocrLiteConfigFromEnv(), mode);
        const results = await collectResults(pid, mode);
        const dest = recheckPaths.json(pid, mode);
        await ensureDir(dirname(dest));
        await Deno.writeTextFile(dest, JSON.stringify(results) + "\n");
        console.log(`  ${Object.keys(results.results).length} results -> ${dest}`);
      }
    }
    Deno.exit(0);
  }
  if (command === "accuracy") {
    const sub = rest[0];
    const label = args.label ?? "latest";
    const docsDir = join(REPO_ROOT, "docs");
    const acc = await import("./accuracy.ts");
    if (sub === "sample") {
      const { inNoL } = await import("./build.ts");
      const L = await loadSkkL();
      const volumes: CleanVolume[] = [];
      for (const v of DEFAULT_VOLUMES) {
        volumes.push(JSON.parse(await Deno.readTextFile(paths.cleanseJson(v.pid))));
      }
      // シード値は既定で乱数。--seed で固定する。同じラベルで抜き取り直すときは記録したシード値と件数を使い、
      // 判定済みの一覧を別の抜き取りで置き換えないようにする
      const meta = await acc.readSampleMeta(docsDir, label);
      const seeds = args.seed
        ? String(args.seed).split(",").map(Number)
        : meta?.seeds ?? [crypto.getRandomValues(new Uint32Array(1))[0]];
      const n = Number(args.n ?? meta?.n ?? 450);
      // 版をまたいで同じシード値を使わない（同じ標本で測り続けると、その標本に合わせた調整が効いて見える）
      const reused = await acc.seedsUsedElsewhere(docsDir, label, seeds);
      if (reused.length > 0 && !args["reuse-seed"]) {
        console.error(
          `シード値 ${
            reused.map((r) => `${r.seeds.join(",")}（${r.label}）`).join("、")
          } はほかの評価で使っています。` +
            "新しいシード値を使ってください（--seed を省くと乱数になる）。" +
            "過去の評価を再現するときだけ --reuse-seed を付けます。",
        );
        Deno.exit(1);
      }
      const dicts = args.dicts
        ? String(args.dicts).split(",") as typeof acc.DICTIONARIES[number][]
        : meta?.dicts ?? [...acc.DICTIONARIES];
      const unknown = dicts.filter((d) => !acc.DICTIONARIES.includes(d));
      if (unknown.length > 0) {
        console.error(`--dicts には ${acc.DICTIONARIES.join(", ")} を指定してください: ${unknown}`);
        Deno.exit(1);
      }
      const samples = acc.drawSamples(volumes, (e) => inNoL(L, e), n, seeds);
      const same = meta && meta.n === n && meta.seeds.join(",") === seeds.join(",");
      await acc.writeSampleMeta(docsDir, label, {
        n,
        seeds,
        ...(dicts.length < acc.DICTIONARIES.length ? { dicts } : {}),
        sampledAt: new Date().toISOString(),
        commit: await acc.currentCommit(REPO_ROOT),
        judge: args.judge ?? meta?.judge ?? acc.DEFAULT_JUDGE,
        inputs: await acc.digestFiles(
          DEFAULT_VOLUMES.flatMap((v) => [
            paths.extractJson(v.pid),
            paths.extractNdlJson(v.pid),
            paths.recheckJson(v.pid),
            recheckPaths.json(v.pid, "full"),
          ]),
        ),
        // 同じ条件で抜き取り直したときは、記録済みの説明を引き継ぐ
        ...(same
          ? {
            preregistrationNote: meta.preregistrationNote,
            humanCheck: meta.humanCheck,
            caveat: meta.caveat,
          }
          : {}),
      });
      console.log(`  n = ${n}, seed = ${seeds.join(",")}`);
      const summary = await acc.writeSamples(samples, {
        docsDir,
        distDir: DIST_DIR,
        label,
        images: args.images,
        dicts,
      });
      for (const [name, s] of Object.entries(summary)) {
        console.log(`  ${name}: ${s.total} 件（未判定 ${s.pending} 件）`);
      }
      console.log(`  一覧: ${join(docsDir, "accuracy", label)}`);
      console.log(`  紙面: ${acc.accuracyPaths.sheets(DIST_DIR, label)}`);
      Deno.exit(0);
    }
    if (sub === "report") {
      let meta = await acc.readSampleMeta(docsDir, label);
      const results = await acc.computeAccuracy(docsDir, label, meta?.dicts);
      const svg = acc.accuracyPaths.svg(docsDir, label);
      if (meta && (args.judge || args["human-check"])) {
        meta = {
          ...meta,
          judge: args.judge ?? meta.judge,
          humanCheck: args["human-check"] ?? meta.humanCheck,
        };
        await acc.writeSampleMeta(docsDir, label, meta);
      }
      const prereg = await acc.checkPreregistration(
        REPO_ROOT,
        docsDir,
        label,
        meta?.preregistrationNote,
      );
      const humanCheck = await acc.checkHumanReview(REPO_ROOT, docsDir, label, meta);
      await Deno.writeTextFile(
        svg,
        acc.renderSvg(results, label, {
          meta,
          target: Number(args.target ?? 0.99),
          zoomMin: Number(args["zoom-min"] ?? 0.95),
          measuredAt: new Date().toISOString().slice(0, 10),
          preregistration: prereg,
          humanCheck,
        }),
      );
      const readmePath = join(REPO_ROOT, "README.md");
      const body = acc.renderMarkdown(
        results,
        label,
        `docs/accuracy/${label}.svg`,
        prereg,
        humanCheck,
        meta,
      );
      await Deno.writeTextFile(
        readmePath,
        acc.replaceSection(await Deno.readTextFile(readmePath), body, label),
      );
      // 表の列幅などを deno fmt の形にそろえる（fmt --check を通すため）
      await new Deno.Command(Deno.execPath(), { args: ["fmt", "--quiet", readmePath] }).output();
      for (const r of results) {
        console.log(
          `  ${r.file}: ${r.correct}/${r.n} = ${(r.rate * 100).toFixed(1)}%` +
            `（95% CI ${(r.ci[0] * 100).toFixed(1)}〜${(r.ci[1] * 100).toFixed(1)}%）`,
        );
      }
      console.log(`  シード値の事前記録: ${prereg.summary}`);
      console.log(`  人の確認: ${humanCheck.summary}`);
      console.log(`  -> ${svg}, ${readmePath}`);
      Deno.exit(0);
    }
    console.error("accuracy には sample か report を指定してください");
    Deno.exit(1);
  }
  if (command === "review") {
    const { STRATA, writeReview } = await import("./review.ts");
    const { inNoL } = await import("./build.ts");
    const names = args.strata ? String(args.strata).split(",") : STRATA.map((s) => s.name);
    const L = names.includes("noL") ? await loadSkkL() : undefined;
    const volumes: CleanVolume[] = [];
    for (const pid of pids) {
      volumes.push(JSON.parse(await Deno.readTextFile(paths.cleanseJson(pid))));
    }
    const out = join(DIST_DIR, "review");
    await writeReview(volumes, out, {
      n: Number(args.n ?? 30),
      seed: Number(args.seed ?? 1),
      strata: STRATA.filter((s) => names.includes(s.name)),
      ctx: { inNoL: (e) => (L ? inNoL(L, e) : false) },
    });
    console.log(`  -> ${out}`);
    Deno.exit(0);
  }
  if (command === "compare") {
    if (rest.length !== 2) {
      console.error("compare には旧・新のクレンジング結果のディレクトリを指定してください");
      Deno.exit(1);
    }
    console.log(await compareBuilds(rest[0], rest[1]));
    Deno.exit(0);
  }
  if (command === "build") {
    await buildStep(pids);
    Deno.exit(0);
  }
  for (const pid of pids) {
    switch (command) {
      case "fetch":
        await fetchVolume(pid, opts);
        break;
      case "ocr":
        await ocrVolume(pid, opts);
        break;
      case "work":
        await workVolume(pid, source);
        break;
      case "extract":
        await extractStep(pid);
        break;
      case "all":
        await fetchVolume(pid, opts);
        await ocrVolume(pid, opts);
        await workVolume(pid, source);
        await extractStep(pid);
        break;
      default:
        console.error(USAGE);
        Deno.exit(1);
    }
  }
}
