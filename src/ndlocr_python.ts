/** ndlocr-lite の Python（PIL を含む）。NDLOCR_LITE_PYTHON か、ndlocr-lite のスクリプトの shebang から決める */
export async function ndlocrPython(): Promise<string> {
  const env = Deno.env.get("NDLOCR_LITE_PYTHON");
  if (env) return env;
  const { stdout } = await new Deno.Command("which", { args: ["ndlocr-lite"] }).output();
  const script = new TextDecoder().decode(stdout).trim();
  const first = (await Deno.readTextFile(script)).split("\n")[0];
  if (!first.startsWith("#!")) {
    throw new Error("ndlocr-lite の Python が分からない（NDLOCR_LITE_PYTHON を設定する）");
  }
  return first.slice(2).trim();
}
