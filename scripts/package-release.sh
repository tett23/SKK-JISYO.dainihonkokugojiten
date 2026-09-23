#!/usr/bin/env bash
# リリース用のアーカイブとリリースノートを作る。
# 使い方: scripts/package-release.sh <タグ> <ビルドの出力ディレクトリ> <出力先>
#
# アーカイブには辞書と、GPL が求めるライセンスの本文（LICENSE）、第三者の権利表示（NOTICE、
# LICENSES/）を入れる。
set -euo pipefail

tag="$1"
dist="$2"
out="$3"

name="SKK-JISYO.dainihonkokugojiten-$tag"
pkg="$out/$name"
mkdir -p "$pkg"
# 辞書は UTF-8 版（utf-8/）と EUC-JP 版（euc-jp/）
cp -R "$dist/utf-8" "$dist/euc-jp" "$pkg/"
cp "$dist/report.md" "$dist/resources.json" "$pkg/"
gzip -c "$dist/entries.tsv" > "$pkg/entries.tsv.gz"
cp README.md LICENSE NOTICE "$pkg/"
cp -R LICENSES "$pkg/"
tar -czf "$out/$name.tar.gz" -C "$out" "$name"

{
  echo "大日本国語辞典（1915-1919）を元にした SKK 辞書です。OCR の誤りを含みます。"
  echo
  echo "- ビルド: $(date -u +%Y-%m-%dT%H:%M:%SZ)（commit ${GITHUB_SHA:-unknown}）"
  jq -r '.[] | "- \(.url)（取得 \(.fetchedAt)）"' "$dist/resources.json"
  echo
  echo "権利表示とライセンスは同梱の NOTICE、LICENSE（GPL-3.0-or-later）、LICENSES/ を参照してください。"
  echo "This publication has included material from the JMdict (EDICT, etc.) dictionary files in accordance with the licence provisions of the Electronic Dictionaries Research Group."
  echo
  cat "$dist/report.md"
} > "$out/notes.md"
