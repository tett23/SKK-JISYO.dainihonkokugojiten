import { join } from "@std/path";
import type { CleanEntry, CleanVolume } from "./cleanse.ts";

/**
 * 2 つのビルド（クレンジング結果のディレクトリ）を比べ、状態・検証方法の件数と、
 * 候補ごとの変化（状態の遷移、SKK の見出しの変化）をまとめる。
 */

async function load(dir: string): Promise<Map<string, CleanEntry>> {
  const out = new Map<string, CleanEntry>();
  for await (const e of Deno.readDir(dir)) {
    if (!e.name.endsWith(".json")) continue;
    const v: CleanVolume = JSON.parse(await Deno.readTextFile(join(dir, e.name)));
    for (const entry of v.entries) out.set(entry.id, entry);
  }
  return out;
}

function countBy<T>(xs: Iterable<T>, f: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
  return m;
}

function sideBySide(title: string, a: Map<string, number>, b: Map<string, number>, total: number) {
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) =>
    (b.get(y) ?? 0) - (b.get(x) ?? 0)
  );
  const pct = (n: number) => `${(n / total * 100).toFixed(1)}%`;
  return `### ${title}\n\n| 値 | 旧 | 新 | 差 |\n| --- | ---: | ---: | ---: |\n` +
    keys.map((k) => {
      const x = a.get(k) ?? 0;
      const y = b.get(k) ?? 0;
      return `| ${k} | ${x}（${pct(x)}） | ${y}（${pct(y)}） | ${y - x >= 0 ? "+" : ""}${y - x} |`;
    }).join("\n") + "\n";
}

const label = (e: CleanEntry) => `${e.status}${e.status === "accepted" ? `/${e.method}` : ""}`;

export async function compareBuilds(oldDir: string, newDir: string): Promise<string> {
  const [a, b] = await Promise.all([load(oldDir), load(newDir)]);
  const total = b.size;
  const transitions = new Map<string, number>();
  const keyChanged: [CleanEntry, CleanEntry][] = [];
  for (const [id, n] of b) {
    const o = a.get(id);
    if (!o) continue;
    if (label(o) !== label(n)) {
      const k = `${label(o)} → ${label(n)}`;
      transitions.set(k, (transitions.get(k) ?? 0) + 1);
    }
    if (o.status === "accepted" && n.status === "accepted" && o.skkKey !== n.skkKey) {
      keyChanged.push([o, n]);
    }
  }
  const rows = [...transitions].sort((x, y) => y[1] - x[1]);
  return `# ビルドの比較

- 旧: \`${oldDir}\`（${a.size} 件）
- 新: \`${newDir}\`（${b.size} 件）

${
    sideBySide(
      "状態",
      countBy(a.values(), (e) => e.status),
      countBy(b.values(), (e) => e.status),
      total,
    )
  }
${
    sideBySide(
      "検証方法（accepted のみ）",
      countBy([...a.values()].filter((e) => e.status === "accepted"), (e) => e.method),
      countBy([...b.values()].filter((e) => e.status === "accepted"), (e) => e.method),
      total,
    )
  }
### 状態・検証方法の遷移

| 旧 → 新 | 件数 |
| --- | ---: |
${rows.map(([k, n]) => `| ${k} | ${n} |`).join("\n")}

### 検証済みのまま SKK の見出しが変わった候補（${keyChanged.length} 件、先頭 30 件）

| id | 表記 | 旧 | 新 |
| --- | --- | --- | --- |
${
    keyChanged.slice(0, 30).map(([o, n]) =>
      `| ${n.id} | ${n.notation} | ${o.skkKey}（${o.method}） | ${n.skkKey}（${n.method}） |`
    ).join("\n")
  }
`;
}
