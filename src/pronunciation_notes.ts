import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { DATA_DIR, paths, REPO_ROOT } from "./config.ts";
import type { CleanEntry, CleanVolume } from "./cleanse.ts";
import { imageFileName } from "./ndl.ts";
import { ndlocrPython } from "./ndlocr_python.ts";

/**
 * 読みの傍の発音の注記（小さな片仮名）を紙面から取り出した結果。
 *
 * 底本は 大夫・太夫 の たいふ に、い の傍の ュ と ふ の傍の ウ で たゆう と添える。注記の無い
 * たいふ（官名の 御史大夫 など）は たいふ と読む。OCR はこの注記を読まないので、紙面の画像から
 * い の傍の ュ の有無を調べる（scripts/pronunciation_notes.py、docs/pronunciation-notes.md）。
 * 紙面と照合した 53 件で 49 件が正しく、誤りの 4 件はどれも ュ の見落としだった（ュ を誤って見つけたものは無い）。
 */
export type PronunciationNote = {
  /** 注記の位置（読みの列の上端・右端からの相対座標）と、傍の字の番号 */
  notes: [number, number, number, number, number][];
  /** 調べた字（たいふ の い）の傍に ュ がある */
  yu: boolean;
};

export type PronunciationNotes = Record<string, PronunciationNote>;

export const pronunciationNotesPath = (pid: string) =>
  join(DATA_DIR, "pronunciation-notes", `${pid}.json`);

const TAIFU_NOTATION = /[大太]夫/;
const TAIFU_READING = /[ただ]いふ/;

/** 注記を調べる候補（表記に 大夫・太夫、読みに たいふ を含む）と、調べる字（い）の番号 */
export function noteTargets(volume: CleanVolume): { e: CleanEntry; index: number }[] {
  return volume.entries.flatMap((e) => {
    if (e.status === "excluded" || !e.notation || !TAIFU_NOTATION.test(e.notation)) return [];
    const m = e.reading.replaceAll("-", "").match(TAIFU_READING);
    return m ? [{ e, index: m.index! + 1 }] : [];
  });
}

/** 紙面の画像から注記を取り出し、pronunciationNotesPath(pid) に保存する。件数を返す */
export async function extractNotes(volume: CleanVolume): Promise<number> {
  const pid = volume.pid;
  const targets = noteTargets(volume);
  const jobs = [...Map.groupBy(targets, (t) => t.e.frame)].map(([frame, list]) =>
    JSON.stringify({
      page: join(paths.imagesDir(pid), imageFileName(frame)),
      items: list.map(({ e, index }) => ({ id: e.id, bbox: e.bbox, reading: e.reading, index })),
    })
  );
  const child = new Deno.Command(await ndlocrPython(), {
    args: [join(REPO_ROOT, "scripts", "pronunciation_notes.py")],
    stdin: "piped",
    stdout: "piped",
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(jobs.join("\n") + "\n"));
  await w.close();
  const { success, stdout } = await child.output();
  if (!success) throw new Error("pronunciation_notes.py が失敗した");
  const results: PronunciationNotes = {};
  for (const line of new TextDecoder().decode(stdout).split("\n")) {
    if (!line.trim()) continue;
    const { id, notes, yu } = JSON.parse(line);
    results[id] = { notes, yu };
  }
  const dest = pronunciationNotesPath(pid);
  await ensureDir(dirname(dest));
  await Deno.writeTextFile(
    dest,
    JSON.stringify({ schemaVersion: 1, pid, results }, null, 1) + "\n",
  );
  return Object.keys(results).length;
}

export async function loadNotes(pid: string): Promise<PronunciationNotes> {
  return await Deno.readTextFile(pronunciationNotesPath(pid))
    .then((t) => JSON.parse(t).results as PronunciationNotes)
    .catch(() => ({}));
}

/** 注記に従って 大夫 の見出しを直す。い の傍に ュ があれば たゆう にする（たいふ・たいう を置き換える） */
export function applyNotes(volume: CleanVolume, notes: PronunciationNotes): number {
  let changed = 0;
  for (const { e } of noteTargets(volume)) {
    const note = notes[e.id];
    // 注記の見落とし（紙面と照合した 53 件で 4 件）がある一方、ュ を誤って見つけたことは無いので、
    // ュ があるときだけ たゆう に直す。無いときは L・JMdict・対応付けで決めた見出しのままにする
    if (!note?.yu || !e.skkKey) continue;
    const to = "ゆう";
    const key = e.skkKey.replace(/(?<=[ただ])(いふ|ゆう|いう)/, to);
    if (key === e.skkKey) continue;
    e.fixes.push({
      field: "modern",
      from: e.skkKey,
      to: key,
      reason: "発音の注記（ュ）に従って たゆう",
    });
    e.skkKey = key;
    if (e.modern) e.modern = e.modern.replace(/(?<=[ただ])(いふ|ゆう|いう)/, to);
    changed++;
  }
  return changed;
}
