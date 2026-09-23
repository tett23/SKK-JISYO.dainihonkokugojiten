# SKK-JISYO.dainihonkokugojisyo

『大日本国語辞典』（上田万年・松井簡治 著、金港堂書籍、1915〜1919）をもとに SKK 辞書を作るプロジェクト。

現段階では、国立国会図書館（NDL）から本文データを取得し、見出し語と表記の候補を抽出するところまでを実装している。

## 対象資料

NDLデジタルコレクションでインターネット公開されている初版全4巻。

| PID                                       | 巻                  |
| ----------------------------------------- | ------------------- |
| [954645](https://dl.ndl.go.jp/pid/954645) | 第1巻 あ〜き (1915) |
| [954646](https://dl.ndl.go.jp/pid/954646) | 第2巻 く〜し (1916) |
| [954647](https://dl.ndl.go.jp/pid/954647) | 第3巻 す〜な (1917) |
| [954648](https://dl.ndl.go.jp/pid/954648) | 第4巻 に〜ん (1919) |

## 出典

本プロジェクトのデータは、国立国会図書館（NDL）が公開するデータを元に作成している。

- 底本: 上田万年・松井簡治 著『大日本国語辞典』第1〜4巻（金港堂書籍, 1915〜1919）
- 画像・書誌: [国立国会図書館デジタルコレクション](https://dl.ndl.go.jp/)
  - [info:ndljp/pid/954645](https://dl.ndl.go.jp/pid/954645)（第1巻）
  - [info:ndljp/pid/954646](https://dl.ndl.go.jp/pid/954646)（第2巻）
  - [info:ndljp/pid/954647](https://dl.ndl.go.jp/pid/954647)（第3巻）
  - [info:ndljp/pid/954648](https://dl.ndl.go.jp/pid/954648)（第4巻）
- テキスト: [NDLOCR-Lite (ndlocr-lite)](https://github.com/ndl-lab/ndlocr-lite)（国立国会図書館, CC BY 4.0）による OCR 結果、および [国立国会図書館「次世代デジタルライブラリー」](https://lab.ndl.go.jp/dl/) の全文テキスト

本プロジェクトの成果物は、上記を元に本プロジェクトが抽出・加工・校正したものであり、原著者および国立国会図書館が作成したものではない。
底本のデータは保護期間満了（Public Domain Mark）であり、自由に二次利用できる。

## 権利関係

- 底本の著者は上田万年（1937年没）と松井簡治（1945年没）。共同著作物の保護期間は最後に亡くなった著作者の死後50年なので、1995年末に満了している。2018年の70年への延長は、その時点で権利が残っていた著作物にしか適用されない（TPP整備法附則7条）。戦時加算は連合国民の著作物だけが対象なので関係しない。
- NDLデジタルコレクションでは「インターネット公開（保護期間満了）」、rights は PDM（Public Domain Mark）。[申請不要で自由に利用できる](https://www.ndl.go.jp/jp/use/reproduction/index.html)。出典の明示には協力が求められている。
- NDLラボの全文テキストも PDM。[加工した場合はそのことを明記し、原作者や NDL が作成したように見せないこと](https://lab.ndl.go.jp/service/tsugidigi/)が求められている。
- 使うのは初版（1915〜1919年刊）のみ。修訂版（1939〜41年、松井驥 修訂）や索引巻は混ぜない。`fetch` は刊行年がこの範囲外の資料を取得しない。

- ソースコードのライセンスは [LICENSE](LICENSE)（MIT）。

## 使い方

Deno 2 と [ndlocr-lite](https://github.com/ndl-lab/ndlocr-lite)（`ndlocr-lite` コマンド）が必要。

```sh
deno task fetch   # NDL から書誌・全文テキスト・画像を取得
deno task ocr     # 画像に ndlocr-lite を実行
deno task work    # 生データから作業用 JSON を生成
deno task extract # 作業用 JSON から見出し語・表記の候補を抽出
deno task all     # 上記を順に実行
```

PID を引数に渡すと対象を絞れる（例: `deno task fetch 954645`）。オプションは `deno run src/main.ts --help` を参照。
クレンジングの方針は [docs/cleansing.md](docs/cleansing.md) を参照。

### 取得の流れ

1. NDLデジタルコレクションの書誌 API と IIIF manifest、NDLラボ（次世代デジタルライブラリー）の資料情報・全文テキスト（NDL が OCR したテキスト）を取得する。
2. IIIF から全コマの画像を取得する。
3. 画像を ndlocr-lite で OCR する。OCR 済みの画像はスキップするので、中断しても再実行すれば続きから処理する。`--force-ocr` で既存の出力を退避して OCR し直す。
4. ndlocr-lite の結果があればそれを、なければ NDLラボの全文テキストを作業用 JSON に変換する。`work --source ndl-lab-fulltext|ndlocr-lite` で明示的に選べる。
5. ndlocr-lite の作業用 JSON から見出し語・表記・品詞の候補を抽出する。

NDL への負荷を避けるため、リクエストは逐次で行い、取得済みのファイルは再取得しない（`--force` で再取得）。
間隔は書誌などが1秒（`NDL_REQUEST_INTERVAL_MS`）、画像が6秒（`NDL_IMAGE_INTERVAL_MS`）。
画像を1秒・3秒間隔で取得したところ、いずれも約130コマで NDL 側のアクセス制限（HTTP 403）に掛かった。
403 を受けたら15分（`NDL_BLOCKED_WAIT_MS`）待ってから再開する。

ndlocr-lite の実行コマンドは環境変数 `NDLOCR_LITE_CMD` で変更できる（既定値は `ndlocr-lite --sourcedir {input} --output {output}`、`{input}`/`{output}` が置換される）。

## データの配置

`data/` 以下はサイズが大きいため Git 管理外。

```
data/
├── raw/                          NDL・ndlocr-lite から得たデータを加工せずに保存
│   ├── ndl/<pid>/
│   │   ├── item.json             NDLデジタルコレクション書誌 API
│   │   ├── manifest.json         IIIF manifest
│   │   ├── lab-book.json         NDLラボ資料情報
│   │   ├── lab-fulltext.json     NDLラボ全文テキスト（存在しない資料は取得記録のみ）
│   │   ├── images/R0000001.jpg   IIIF 画像
│   │   └── *.fetch.json          各ファイルの取得記録（URL、HTTP ステータス、ヘッダ、SHA-256、取得日時）
│   └── ndlocr-lite/<pid>/
│       ├── R0000001.{xml,json,txt}  ndlocr-lite の出力（画像ごと）
│       └── run-*.json, run-*.log    実行コマンド・バージョンとログ
├── tmp/ndlocr-lite-input/<pid>/  ndlocr-lite の入力（未処理の画像へのハードリンク）
├── work/<pid>.json               作業用 JSON
└── extract/<pid>.json            見出し語・表記の候補
```

`--force-ocr` で退避した過去の OCR 結果は `raw/ndlocr-lite/<pid>-<timestamp>/` に残る。

### 作業用 JSON

```jsonc
{
  "schemaVersion": 1,
  "pid": "954645",
  "title": "大日本国語辞典",
  "volume": "第１巻あ～き",
  "generatedAt": "...",
  "source": { "kind": "ndlocr-lite", "rawPath": "raw/ndlocr-lite/954645" },
  "pages": [
    {
      "frame": 42, // コマ番号（見開き 1 コマ）
      "imageName": "R0000042.jpg",
      "width": 4562,
      "height": 2904,
      "imageUrl": "https://dl.ndl.go.jp/api/iiif/954645/R0000042/full/full/0/default.jpg",
      "text": "…", // コマ全体のテキスト（行を改行でつないだもの）
      "lines": [
        // 縦 1 列を 1 行とし、読み順（右ページ→左ページ、上の段→下の段、右の列→左の列）に並ぶ
        {
          "text": "あし-つぎ足繼(名)高くて、背丈の",
          "x": 3712,
          "y": 391,
          "width": 34,
          "height": 508,
          "conf": 0.69,
          "type": "本文"
        }
      ]
    }
  ]
}
```

NDLラボの全文テキスト由来（`source.kind: "ndl-lab-fulltext"`）の場合、`lines` は段をまたいで読み順が乱れた断片になる。

### 見出し語・表記の候補

紙面は縦書きの多段組（1ページ4段）で、各項目は新しい列の頭から「読み 表記 (品詞) 語釈…」の順に組まれている。
`extract` は ndlocr-lite の行のうち、行頭が「かなの読み + 表記 + 括弧内の品詞」の形になっているものを見出しとして取り出す。

- 品詞は凡例の略語（`名` `代` `自動` `他動` `形` `副` `枕` など）で始まるものに限る。ルビや参照の括弧（`(表袴)` など）を見出しと取り違えないため。
- 読みの中の区切り `-` が `―` や `〳〵` などに化けたものは `-` に直す。
- 表記の前にある漢語の記号（OCR では `一` になる）は表記から外し、`kango: true` とする。

```jsonc
{
  "id": "954645-042-0001", // <pid>-<コマ>-<コマ内の連番>
  "frame": 42,
  "side": "R", // 見開きの右ページ / 左ページ
  "tier": 1, // 段（上から 1 始まり）
  "offset": -9, // 段の本文開始位置から行頭までの距離（px）
  "reading": "あし-つぎ", // OCR されたままの読み（歴史的仮名遣い、"-" は語構成の区切り）
  "notation": "足繼",
  "notationKind": "written", // written | none（表記の無い語）
  "kango": false,
  "pos": "名", // 括弧内の品詞表示（OCR されたまま。活用の種類を含む）
  "line": "あし-つぎ足繼(名)高くて、背丈の",
  "conf": 0.69,
  "bbox": { "x": 3712, "y": 391, "width": 34, "height": 508 }
}
```

読みや表記の OCR 誤り、歴史的仮名遣いから現代仮名遣いへの変換は後段で扱う（[docs/cleansing.md](docs/cleansing.md)）。
