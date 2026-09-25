import { join } from "@std/path";
import { DATA_DIR } from "./config.ts";

/**
 * 読み直しの種類。head は見出しの列の上端から 360px（読みを大きく写す）、full は見出しの列の全体
 * （表記まで写す。head では表記が切れて読めない候補の三つ目の表記を得る）
 */
export type RecheckMode = "head" | "full";

const suffix = (mode: RecheckMode) => (mode === "head" ? "" : `-${mode}`);

export const recheckPaths = {
  input: (pid: string, mode: RecheckMode = "head") =>
    join(DATA_DIR, "tmp", `recheck${suffix(mode)}-input`, pid),
  raw: (pid: string, mode: RecheckMode = "head") =>
    join(DATA_DIR, "raw", `recheck${suffix(mode)}`, pid),
  json: (pid: string, mode: RecheckMode = "head") =>
    join(DATA_DIR, `recheck${suffix(mode)}`, `${pid}.json`),
};
