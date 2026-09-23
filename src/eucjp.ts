/**
 * EUC-JP（JIS X 0208）への符号化。
 *
 * Deno（WHATWG Encoding）の TextEncoder は UTF-8 しか扱わないので、TextDecoder("euc-jp") で
 * JIS X 0208 の各符号を復号して逆引きの表を作る。
 * 従来の SKK 辞書（SKK-JISYO.L など）と同じく、ASCII と JIS X 0208 の範囲だけを使う。
 * JIS X 0208 に無い文字（一部の旧字体など）は符号化できない。
 */

/** JIS X 0208 の区（1〜8 区: 記号・かな等、16〜84 区: 漢字）。NEC 特殊文字などの拡張は含めない */
const ROWS = [
  ...Array.from({ length: 8 }, (_, i) => i + 1),
  ...Array.from({ length: 69 }, (_, i) => i + 16),
];

let table: Map<string, [number, number]> | undefined;

function encodeTable(): Map<string, [number, number]> {
  if (table) return table;
  table = new Map();
  const decoder = new TextDecoder("euc-jp", { fatal: true });
  for (const row of ROWS) {
    for (let cell = 1; cell <= 94; cell++) {
      const bytes: [number, number] = [0xa0 + row, 0xa0 + cell];
      let ch: string;
      try {
        ch = decoder.decode(new Uint8Array(bytes));
      } catch {
        continue;
      }
      if (!table.has(ch)) table.set(ch, bytes);
    }
  }
  return table;
}

/** EUC-JP（ASCII と JIS X 0208）で表せる文字列か */
export function isEucJpEncodable(s: string): boolean {
  const t = encodeTable();
  for (const ch of s) {
    if (ch.codePointAt(0)! < 0x80) continue;
    if (!t.has(ch)) return false;
  }
  return true;
}

/** 文字列を EUC-JP に符号化する。表せない文字があれば例外を投げる */
export function encodeEucJp(s: string): Uint8Array {
  const t = encodeTable();
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) {
      out.push(cp);
      continue;
    }
    const bytes = t.get(ch);
    if (!bytes) {
      throw new Error(`EUC-JP で表せない文字: ${ch} (U+${cp.toString(16).toUpperCase()})`);
    }
    out.push(...bytes);
  }
  return new Uint8Array(out);
}
