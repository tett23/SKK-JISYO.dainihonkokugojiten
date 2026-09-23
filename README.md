# SKK-JISYO.dainihonkokugojisyo

『大日本国語辞典』（上田万年・松井簡治 著、金港堂書籍、1915〜1919）をもとに SKK 辞書を作るプロジェクト。

現段階では、国立国会図書館（NDL）から本文データを取得し、作業用 JSON を作るところまでを実装している。

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
- テキスト: [国立国会図書館「次世代デジタルライブラリー」](https://lab.ndl.go.jp/dl/) の全文テキスト、または [NDLOCR (ndlocr_cli)](https://github.com/ndl-lab/ndlocr_cli)（国立国会図書館, CC BY 4.0）による OCR 結果

本プロジェクトの成果物は、上記を元に本プロジェクトが抽出・加工・校正したものであり、原著者および国立国会図書館が作成したものではない。
底本のデータは保護期間満了（Public Domain Mark）であり、自由に二次利用できる。

## 権利関係

- 底本の著者は上田万年（1937年没）と松井簡治（1945年没）。共同著作物の保護期間は最後に亡くなった著作者の死後50年なので、1995年末に満了している。2018年の70年への延長は、その時点で権利が残っていた著作物にしか適用されない（TPP整備法附則7条）。戦時加算は連合国民の著作物だけが対象なので関係しない。
- NDLデジタルコレクションでは「インターネット公開（保護期間満了）」、rights は PDM（Public Domain Mark）。[申請不要で自由に利用できる](https://www.ndl.go.jp/jp/use/reproduction/index.html)。出典の明示には協力が求められている。
- NDLラボの全文テキストも PDM。[加工した場合はそのことを明記し、原作者や NDL が作成したように見せないこと](https://lab.ndl.go.jp/service/tsugidigi/)が求められている。
- 使うのは初版（1915〜1919年刊）のみ。修訂版（1939〜41年、松井驥 修訂）や索引巻は混ぜない。`fetch` は刊行年がこの範囲外の資料を取得しない。
- ソースコードのライセンスは [LICENSE](LICENSE)（MIT）。

## 使い方

Deno 2 が必要。

```sh
deno task fetch   # NDL から生データを取得
deno task ocr     # 画像のみの資料に ndlocr_cli を実行
deno task work    # 生データから作業用 JSON を生成
deno task all     # 上記を順に実行
```

PID を引数に渡すと対象を絞れる（例: `deno task fetch 954645`）。オプションは `deno run src/main.ts --help` を参照。

### 取得の流れ

1. NDLデジタルコレクションの書誌 API と IIIF manifest、NDLラボ（次世代デジタルライブラリー）の資料情報を取得する。
2. NDLラボの全文テキスト（NDL が OCR したテキスト）を取得する。
3. 全文テキストが無い資料（画像のみ）は、IIIF から全コマの画像を取得し、ndlocr_cli で OCR する。
   全文テキストがある資料でも `--force-ocr`（`all` の場合）または `fetch --images` と `ocr --force-ocr` で ndlocr_cli を使える。
4. ndlocr_cli の結果があればそれを、なければ NDLラボの全文テキストを作業用 JSON に変換する。
   `work --source ndl-lab-fulltext|ndlocr` で明示的に選べる。

NDL への負荷を避けるため、リクエストは逐次・1秒間隔（`NDL_REQUEST_INTERVAL_MS` で変更可）で行い、取得済みのファイルは再取得しない（`--force` で再取得）。

### ndlocr_cli の設定

[ndlocr_cli](https://github.com/ndl-lab/ndlocr_cli) は NVIDIA GPU を使う Docker 環境を前提としている。
実行方法は環境変数で指定する。

| 変数              | 既定値                                           | 説明                                                                                 |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `NDLOCR_CLI_DIR`  | なし                                             | コマンドの作業ディレクトリ（ndlocr_cli のチェックアウト先）                          |
| `NDLOCR_CMD`      | `python3 main.py infer {input} {output} -s s -x` | 実行コマンド。`{input}`/`{output}` が置換される                                      |
| `NDLOCR_PATH_MAP` | なし                                             | `ホスト側prefix=コンテナ側prefix`。`{input}`/`{output}` をコンテナ内パスに書き換える |

Docker コンテナ（`ocr_cli_runner`）にこのリポジトリの `data/` を `/root/data` としてマウントしている場合の例:

```sh
NDLOCR_CMD="docker exec -w /root/ocr_cli ocr_cli_runner python main.py infer {input} {output} -s s -x" \
NDLOCR_PATH_MAP="$PWD/data=/root/data" \
deno task ocr
```

## データの配置

`data/` 以下はサイズが大きいため Git 管理外。

```
data/
├── raw/                          NDL・ndlocr_cli から得たデータを加工せずに保存
│   ├── ndl/<pid>/
│   │   ├── item.json             NDLデジタルコレクション書誌 API
│   │   ├── manifest.json         IIIF manifest
│   │   ├── lab-book.json         NDLラボ資料情報
│   │   ├── lab-fulltext.json     NDLラボ全文テキスト（存在しない資料は取得記録のみ）
│   │   ├── images/R0000001.jpg   IIIF 画像（画像のみの資料、または --images 指定時）
│   │   └── *.fetch.json          各ファイルの取得記録（URL、HTTP ステータス、ヘッダ、SHA-256、取得日時）
│   └── ndlocr/<pid>/
│       ├── <pid>[_<timestamp>]/  ndlocr_cli の出力（xml/, txt/ など）。再実行しても過去の結果は残る
│       └── run-*.json, run-*.log 実行コマンドとログ
├── tmp/ndlocr-input/<pid>/img/   ndlocr_cli の入力（raw の画像へのハードリンク）
└── work/<pid>.json               作業用 JSON
```

### 作業用 JSON

```jsonc
{
  "schemaVersion": 1,
  "pid": "954646",
  "title": "大日本国語辞典",
  "volume": "第２巻く～し",
  "generatedAt": "...",
  "source": {
    "kind": "ndl-lab-fulltext",
    "rawPath": "raw/ndl/954646/lab-fulltext.json",
    "sha256": "..."
  },
  "pages": [
    {
      "frame": 101, // コマ番号（見開き 1 コマ）
      "width": 4064,
      "height": 2880,
      "imageUrl": "https://dl.ndl.go.jp/api/iiif/954646/R0000101/full/full/0/default.jpg",
      "text": "…", // コマ全体のテキスト
      "lines": [{ "text": "…", "x": 3457, "y": 422, "width": 48, "height": 507 }]
    }
  ]
}
```

ndlocr_cli 由来の場合、`lines` には `conf`（確信度）と `type`（行種別）も入り、`imageName` にノド元分割後の画像名が入る。
