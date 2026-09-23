import { basename, extname, join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { paths } from "./config.ts";

/**
 * ndlocr-lite (https://github.com/ndl-lab/ndlocr-lite) の実行設定。
 *
 * - NDLOCR_LITE_CMD: 実行コマンドのテンプレート。{input} と {output} が置換される。
 *   既定値は `ndlocr-lite --sourcedir {input} --output {output}`
 */
export type NdlocrLiteConfig = {
  command: string[];
};

export function ndlocrLiteConfigFromEnv(): NdlocrLiteConfig {
  const template = Deno.env.get("NDLOCR_LITE_CMD") ??
    "ndlocr-lite --sourcedir {input} --output {output}";
  return { command: template.split(/\s+/).filter(Boolean) };
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".jp2", ".bmp", ".webp"]);

async function listNames(dir: string, filter: (name: string) => boolean): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) if (e.isFile && filter(e.name)) names.push(e.name);
  return names.sort();
}

const stem = (name: string) => basename(name, extname(name));

/** OCR 結果（<stem>.xml）がまだ無い画像を入力ディレクトリにハードリンク（失敗時はコピー）する */
async function prepareInput(
  pid: string,
  output: string,
): Promise<{ input: string; count: number }> {
  const images = await listNames(paths.imagesDir(pid), (n) => IMAGE_EXTS.has(extname(n)));
  if (images.length === 0) {
    throw new Error(`no images in ${paths.imagesDir(pid)}; run fetch first`);
  }
  const done = new Set((await listNames(output, (n) => n.endsWith(".xml"))).map(stem));
  const input = paths.ndlocrLiteInput(pid);
  await Deno.remove(input, { recursive: true }).catch((e) => {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  });
  await ensureDir(input);
  let count = 0;
  for (const name of images) {
    if (done.has(stem(name))) continue;
    const src = join(paths.imagesDir(pid), name);
    const dest = join(input, name);
    await Deno.link(src, dest).catch(() => Deno.copyFile(src, dest));
    count++;
  }
  return { input, count };
}

async function toolVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await new Deno.Command("uv", { args: ["tool", "list"], stderr: "null" })
      .output();
    return new TextDecoder().decode(stdout).split("\n").find((l) => l.startsWith("ndlocr-lite"));
  } catch {
    return undefined;
  }
}

/**
 * ndlocr-lite を実行し、出力を paths.rawNdlocrLite(pid) にそのまま保存する。
 * OCR 済みの画像はスキップするので、中断しても再実行すれば続きから処理する。
 * force の場合は既存の出力を <pid>-<timestamp> に退避してから全画像を処理し直す。
 */
export async function runNdlocrLite(
  pid: string,
  config: NdlocrLiteConfig,
  { force = false } = {},
): Promise<void> {
  const output = paths.rawNdlocrLite(pid);
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replaceAll(/[:.]/g, "-");
  if (force && (await exists(output))) {
    const archived = `${output}-${stamp}`;
    await Deno.rename(output, archived);
    console.log(`  既存の出力を ${archived} に退避しました`);
  }
  await ensureDir(output);

  const { input, count } = await prepareInput(pid, output);
  if (count === 0) {
    console.log("  すべての画像が OCR 済みです");
    return;
  }

  const [cmd, ...args] = config.command.map((a) =>
    a.replaceAll("{input}", input).replaceAll("{output}", output)
  );
  const logPath = join(output, `run-${stamp}.log`);
  console.log(`  ${count} images: $ ${[cmd, ...args].join(" ")}`);

  const child = new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).spawn();
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
    join(output, `run-${stamp}.json`),
    JSON.stringify(
      {
        command: [cmd, ...args],
        version: await toolVersion(),
        startedAt,
        finishedAt: new Date().toISOString(),
        images: count,
        code: status.code,
        log: basename(logPath),
      },
      null,
      2,
    ) + "\n",
  );
  if (!status.success) {
    throw new Error(`ndlocr-lite exited with code ${status.code} (log: ${logPath})`);
  }
  await Deno.remove(input, { recursive: true });
}

/** ndlocr-lite の出力 XML のパス（画像名順） */
export async function listNdlocrLiteXmls(pid: string): Promise<string[]> {
  const dir = paths.rawNdlocrLite(pid);
  return (await listNames(dir, (n) => n.endsWith(".xml"))).map((n) => join(dir, n));
}

export type NdlocrLine = {
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  conf?: number;
  /** 読み順 */
  order?: number;
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

/**
 * NDLOCR 形式の XML（OCRDATASET > PAGE > TEXTBLOCK > LINE）をパースする。
 * LINE に ORDER（読み順）があればその順に並べる。
 */
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
        order: num(a.ORDER),
        text: a.STRING ?? "",
      });
    }
    if (lines.every((l) => l.order !== undefined)) {
      lines.sort((a, b) => (a.order as number) - (b.order as number));
    }
    pages.push({ imageName: pa.IMAGENAME, width: num(pa.WIDTH), height: num(pa.HEIGHT), lines });
  }
  return pages;
}
