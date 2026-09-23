import { basename, join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { paths } from "./config.ts";

/**
 * ndlocr_cli (https://github.com/ndl-lab/ndlocr_cli) の実行設定。
 *
 * - NDLOCR_CLI_DIR: ndlocr_cli のチェックアウト先（コマンドの作業ディレクトリ）
 * - NDLOCR_CMD: 実行コマンドのテンプレート。{input} と {output} が置換される。
 *   既定値は `python3 main.py infer {input} {output} -s s -x`
 * - NDLOCR_PATH_MAP: `ホスト側prefix=コンテナ側prefix`。docker exec 経由で実行する場合に
 *   {input}/{output} のパスをコンテナ内のパスに書き換える。
 */
export type NdlocrConfig = {
  cwd?: string;
  command: string[];
  pathMap?: [string, string];
};

export function ndlocrConfigFromEnv(): NdlocrConfig {
  const template = Deno.env.get("NDLOCR_CMD") ?? "python3 main.py infer {input} {output} -s s -x";
  const map = Deno.env.get("NDLOCR_PATH_MAP");
  const [host, container] = map?.split("=") ?? [];
  return {
    cwd: Deno.env.get("NDLOCR_CLI_DIR"),
    command: template.split(/\s+/).filter(Boolean),
    pathMap: host && container ? [host, container] : undefined,
  };
}

function mapPath(path: string, pathMap?: [string, string]): string {
  if (!pathMap || !path.startsWith(pathMap[0])) return path;
  return pathMap[1] + path.slice(pathMap[0].length);
}

/** ndlocr_cli の single input dir mode 用に <input>/img/ へ画像をハードリンク（失敗時はコピー）する */
async function prepareInput(pid: string): Promise<string> {
  const input = paths.ndlocrInput(pid);
  await Deno.remove(input, { recursive: true }).catch((e) => {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  });
  const imgDir = join(input, "img");
  await ensureDir(imgDir);
  let count = 0;
  for await (const entry of Deno.readDir(paths.imagesDir(pid))) {
    if (!entry.isFile || !entry.name.endsWith(".jpg")) continue;
    const src = join(paths.imagesDir(pid), entry.name);
    const dest = join(imgDir, entry.name);
    await Deno.link(src, dest).catch(() => Deno.copyFile(src, dest));
    count++;
  }
  if (count === 0) throw new Error(`no images in ${paths.imagesDir(pid)}; run fetch first`);
  return input;
}

/**
 * ndlocr_cli を実行する。出力は paths.rawNdlocr(pid) 配下に ndlocr_cli が作るディレクトリ
 * （<pid> または <pid>_<timestamp>）へそのまま残し、過去の実行結果は削除しない。
 */
export async function runNdlocr(pid: string, config: NdlocrConfig): Promise<void> {
  const input = await prepareInput(pid);
  const output = paths.rawNdlocr(pid);
  await ensureDir(output);

  const [cmd, ...args] = config.command.map((a) =>
    a.replaceAll("{input}", mapPath(input, config.pathMap))
      .replaceAll("{output}", mapPath(output, config.pathMap))
  );
  const startedAt = new Date().toISOString();
  const logPath = join(output, `run-${startedAt.replaceAll(/[:.]/g, "-")}.log`);
  console.log(`  $ ${[cmd, ...args].join(" ")}`);

  const child = new Deno.Command(cmd, {
    args,
    cwd: config.cwd,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const log = await Deno.open(logPath, { write: true, create: true });
  const tee = async (stream: ReadableStream<Uint8Array>, out: typeof Deno.stdout) => {
    for await (const chunk of stream) {
      await out.write(chunk);
      await log.write(chunk);
    }
  };
  const [status] = await Promise.all([
    child.status,
    tee(child.stdout, Deno.stdout),
    tee(child.stderr, Deno.stderr),
  ]);
  log.close();

  await Deno.writeTextFile(
    join(output, `run-${startedAt.replaceAll(/[:.]/g, "-")}.json`),
    JSON.stringify(
      {
        command: [cmd, ...args],
        cwd: config.cwd,
        startedAt,
        code: status.code,
        log: basename(logPath),
      },
      null,
      2,
    ) + "\n",
  );
  if (!status.success) {
    throw new Error(`ndlocr_cli exited with code ${status.code} (log: ${logPath})`);
  }
}

/** 最新の ndlocr_cli 実行結果の XML パスを返す（読み順認識済みの *.sorted.xml を優先） */
export async function findLatestNdlocrXml(pid: string): Promise<string | undefined> {
  const root = paths.rawNdlocr(pid);
  if (!(await exists(root))) return undefined;
  const runs: string[] = [];
  for await (const e of Deno.readDir(root)) {
    if (e.isDirectory && e.name.startsWith(pid)) runs.push(e.name);
  }
  for (const run of runs.sort().reverse()) {
    const xmlDir = join(root, run, "xml");
    if (!(await exists(xmlDir))) continue;
    const xmls: string[] = [];
    for await (const e of Deno.readDir(xmlDir)) if (e.name.endsWith(".xml")) xmls.push(e.name);
    const picked = xmls.find((n) => n.endsWith(".sorted.xml")) ?? xmls[0];
    if (picked) return join(xmlDir, picked);
  }
  return undefined;
}

export type NdlocrLine = {
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  conf?: number;
  text: string;
};

export type NdlocrPage = {
  imageName: string;
  width?: number;
  height?: number;
  lines: NdlocrLine[];
};

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    switch (e) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[m[1]] = unescapeXml(m[2] ?? m[3]);
  }
  return attrs;
}

const num = (s: string | undefined) => (s === undefined || s === "" ? undefined : Number(s));

/** ndlocr_cli の出力 XML（OCRDATASET > PAGE > … > LINE）を読み順のままパースする */
export function parseNdlocrXml(xml: string): NdlocrPage[] {
  const pages: NdlocrPage[] = [];
  for (const pm of xml.matchAll(/<PAGE\b([^>]*?)(?:\/>|>([\s\S]*?)<\/PAGE>)/g)) {
    const pa = parseAttrs(pm[1]);
    const lines: NdlocrLine[] = [];
    for (const lm of (pm[2] ?? "").matchAll(/<LINE\b([^>]*?)\/?>/g)) {
      const a = parseAttrs(lm[1]);
      lines.push({
        type: a.TYPE,
        x: Number(a.X),
        y: Number(a.Y),
        width: Number(a.WIDTH),
        height: Number(a.HEIGHT),
        conf: num(a.CONF),
        text: a.STRING ?? "",
      });
    }
    pages.push({ imageName: pa.IMAGENAME, width: num(pa.WIDTH), height: num(pa.HEIGHT), lines });
  }
  return pages;
}
