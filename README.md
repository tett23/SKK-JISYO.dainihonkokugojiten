# SKK-JISYO.dainihonkokugojiten

『大日本国語辞典』（上田万年・松井簡治 著、金港堂書籍、1915〜1919）をもとに SKK 辞書を作るプロジェクト。

国立国会図書館（NDL）から本文データを取得して OCR し、見出し語と表記の候補を抽出・クレンジングして SKK 辞書をビルドする。

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

読み・表記の照合と補正には次のデータを使い、辞書にはこれらに由来する内容が含まれる（ビルド時に取得し、リポジトリには同梱しない）。
権利表示の全文は [NOTICE](NOTICE)、ライセンスの本文は [LICENSES/](LICENSES/) を参照。

- [SKK-JISYO.L](https://github.com/skk-dev/dict)（SKK Development Team ほか, GPL-2.0-or-later）
- [JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project)（Electronic Dictionary Research and Development Group, [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html)）。
  This publication has included material from the JMdict (EDICT, etc.) dictionary files in accordance with the licence provisions of the Electronic Dictionaries Research Group.
- [Unihan Database](https://www.unicode.org/charts/unihan.html)（Unicode, Inc., [Unicode License v3](LICENSES/Unicode-3.0.txt)）

## 権利関係

- 底本の著者は上田万年（1937年没）と松井簡治（1945年没）。共同著作物の保護期間は最後に亡くなった著作者の死後50年なので、1995年末に満了している。2018年の70年への延長は、その時点で権利が残っていた著作物にしか適用されない（TPP整備法附則7条）。戦時加算は連合国民の著作物だけが対象なので関係しない。
- NDLデジタルコレクションでは「インターネット公開（保護期間満了）」、rights は PDM（Public Domain Mark）。[申請不要で自由に利用できる](https://www.ndl.go.jp/jp/use/reproduction/index.html)。出典の明示には協力が求められている。
- NDLラボの全文テキストも PDM。[加工した場合はそのことを明記し、原作者や NDL が作成したように見せないこと](https://lab.ndl.go.jp/service/tsugidigi/)が求められている。
- 使うのは初版（1915〜1919年刊）のみ。修訂版（1939〜41年、松井驥 修訂）や索引巻は混ぜない。`fetch` は刊行年がこの範囲外の資料を取得しない。

## ライセンス

GNU General Public License バージョン3、または（選択により）それ以降のバージョン（GPL-3.0-or-later）。
本文は [LICENSE](LICENSE)、著作権表示と出典は [NOTICE](NOTICE) を参照。

- 読み・表記の照合と補正に JMdict（CC BY-SA 4.0）を使い、その内容が辞書に反映される。CC BY-SA 4.0 は GPLv3 とは互換（一方向）だが GPLv2 とは互換でないため、GPLv3 以降とする。
- SKK-JISYO.L（GPL-2.0-or-later）は、照合と、L に含まれる語を除いた辞書の作成に使う。「バージョン2以降」なので GPLv3 で扱える。
- 底本と NDL のデータはパブリックドメインであり、このライセンスはこのリポジトリのコードと、ここで作る辞書に適用される。

## 使い方

Deno 2 と [ndlocr-lite](https://github.com/ndl-lab/ndlocr-lite)（`ndlocr-lite` コマンド）が必要。

```sh
deno task fetch   # NDL から書誌・全文テキスト・画像を取得
deno task ocr     # 画像に ndlocr-lite を実行
deno task work    # 生データから作業用 JSON を生成
deno task extract # 作業用 JSON から見出し語・表記の候補を抽出
deno task all     # 上記を順に実行

deno task resources # クレンジングに使う SKK-JISYO.L・Unihan・JMdict を取得
deno task recheck   # NDL 側 OCR と読みが食い違う見出しを切り出して読み直す（画像が必要、数時間）
deno task cleanse   # 候補を照合・補正して data/cleanse/<pid>.json に保存
deno task build     # SKK 辞書とレポートを dist/ に出力（DIST_DIR で出力先を変えられる）
deno task compare <旧 cleanse> <新 cleanse>  # 2 つのビルドを比べる
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

## 正解率

辞書ごとに候補を無作為に抜き取り、紙面の見出しと照らし合わせて正誤を判定した。
SKK の見出し（現代仮名遣いの読み）と表記の両方が紙面の見出しと合っているものを正しいとする（底本の見出しが古い語形でも、底本どおりなら正しい）。
候補の注釈（歴史的仮名遣いの読みと品詞）は評価の対象外で、正しさは確かめていない。
判定は AI（Claude）が紙面の画像と照合して行った。
区間は正解率の 95% 信頼区間（Wilson スコア区間）。判定の一覧は [docs/accuracy/](docs/accuracy/) にある。

<!-- accuracy:start -->

<!-- accuracy:v1.0.2:start -->

### v1.0.2

![辞書ごとの正解率と 95% 信頼区間（v1.0.2）](docs/accuracy/v1.0.2.svg)

| 辞書（v1.0.2）                      | 正しい / 抜き取り | 正解率 | 95% 信頼区間 |
| ----------------------------------- | ----------------: | -----: | -----------: |
| `SKK-JISYO.dainihonkokugojiten.noL` |       1993 / 2000 |  99.7% | 99.3%〜99.8% |

- 抜き取りの条件: 各辞書から 2000 件（シード値 3561625952）（[docs/accuracy/v1.0.2/sample.json](docs/accuracy/v1.0.2/sample.json)）
- シード値の事前記録: 確認済み（シード値の記録 8784c3e 2026-09-25 → 判定の記録 e0e8404 2026-09-25）
- 人の確認: 必要だが未実施（理由: v1.0.2-rc1 から規則が変わった（src/cleanse.ts、src/kana.ts））
- 注意: L 除外辞書だけを評価した（検証済み・未検証の辞書は測っていない）。規則は v1.0.0・v1.0.2-rc1 の判定と開発用の抜き取り（計 600 件）の誤りを見て直したが、この標本はそれらと別のシード値で、規則を固めてコミットした後に抜き取った。判定に迷った 1 件（京國）は誤りとして数えた

<!-- accuracy:v1.0.2:end -->

<!-- accuracy:v1.0.2-rc1:start -->

### v1.0.2-rc1

![辞書ごとの正解率と 95% 信頼区間（v1.0.2-rc1）](docs/accuracy/v1.0.2-rc1.svg)

| 辞書（v1.0.2-rc1）                  | 正しい / 抜き取り | 正解率 | 95% 信頼区間 |
| ----------------------------------- | ----------------: | -----: | -----------: |
| `SKK-JISYO.dainihonkokugojiten.noL` |       1192 / 1200 |  99.3% | 98.7%〜99.7% |

- 抜き取りの条件: 各辞書から 1200 件（シード値 1696687518）（[docs/accuracy/v1.0.2-rc1/sample.json](docs/accuracy/v1.0.2-rc1/sample.json)）
- シード値の事前記録: 確認済み（シード値の記録 c088352 2026-09-25 → 判定の記録 36ebfd2 2026-09-25）
- 人の確認: 必要だが未実施（理由: v1.0.0 から規則が変わった（src/align.ts、src/build.ts、src/cleanse.ts））
- 注意: L 除外辞書だけを評価した（検証済み・未検証の辞書は測っていない）。v1.0.2 の途中の評価で、リリースしていない。目標（信頼区間の下限 99%）に届かなかったが、この結果は捨てずに記録する

<!-- accuracy:v1.0.2-rc1:end -->

<!-- accuracy:v1.0.0:start -->

### v1.0.0

![辞書ごとの正解率と 95% 信頼区間（v1.0.0）](docs/accuracy/v1.0.0.svg)

| 辞書（v1.0.0）                             | 正しい / 抜き取り | 正解率 | 95% 信頼区間 |
| ------------------------------------------ | ----------------: | -----: | -----------: |
| `SKK-JISYO.dainihonkokugojiten`            |         448 / 450 |  99.6% | 98.4%〜99.9% |
| `SKK-JISYO.dainihonkokugojiten.noL`        |         446 / 450 |  99.1% | 97.7%〜99.7% |
| `SKK-JISYO.dainihonkokugojiten.unverified` |         250 / 450 |  55.6% | 50.9%〜60.1% |

- 抜き取りの条件: 各辞書から 450 件（150 件ずつ 3 回、シード値 101、202、303）（[docs/accuracy/v1.0.0/sample.json](docs/accuracy/v1.0.0/sample.json)）
- シード値の事前記録: 未確認（シード値 101、202、303 は beta5 の評価で各 150 件を判定する前に決めたが、初めて記録したのは結果と同じコミット a6bc598 のため、履歴では確かめられない）
- 人の確認: 必要だが未実施（理由: 最初の評価）
- 注意: 検証済みの辞書の抜き取りは beta5 の評価と同じ標本（L 除外辞書もその一部を使う）。この標本は規則の調整には使っていないが、beta ごとに新しい標本で測り、点推定が初めて 99% を超えた回で止めて 1.0.0 としたため、偶然高めに出た回を採りやすく、正解率は高めに出ている可能性がある。1.0.0 の根拠は点推定が 99% 以上であることで、信頼区間の下限（98.4%）は 99% を下回っている

<!-- accuracy:v1.0.0:end -->

<!-- accuracy:end -->

評価は次の手順で行う（件数は既定 450、シード値は既定で乱数。使ったシード値と件数は `docs/accuracy/<label>/sample.json` に残る）。

```sh
deno task accuracy sample --label v1.0.0                 # 抜き取って判定用の一覧と紙面の切り出しを作る
deno task accuracy sample --label v1.0.0 --n 600 --seed 42  # 件数・シード値を指定する
# docs/accuracy/<label>/*.tsv の judgment 列に o / x を記入する（紙面は dist/accuracy/<label>/）
deno task accuracy report --label v1.0.0                 # 集計して、グラフと README の表を更新する
deno task accuracy report --label v1.0.0 --target 0.99 --zoom-min 0.95 --judge "人が紙面と照合"  # 基準線・拡大図の軸・判定の方法を指定する
deno task accuracy report --label v1.0.0 --human-check "AI の x 全件と o 50 件を人が照合"  # 人の確認を記録する
```

グラフには、0〜100% の図に加えて、信頼区間の下限が `--zoom-min`（既定 95%）以上の辞書を拡大した図を添え、`--target`（既定 99%）の基準線を引く。
図だけが転載されても条件が分かるよう、判定の方法（既定「AI（Claude）が紙面画像と照合」）、抜き取りの件数・シード値・日付・コミット、シード値の事前記録と人の確認の状況、結果を読むときの注意を図の下に印字する。これらは `docs/accuracy/<label>/sample.json` に記録される。

### シード値

評価のたびに新しいシード値を使い、判定の前にコミットして固定する。
避けたいのは、版をまたいで同じシード値を使うこと（同じ標本で測り続けると、その標本に合わせた調整が効いて見える）と、結果を見てからシード値を選び直すことの二つである。

- `sample` のシード値は既定で乱数。ほかのラベルで使ったシード値を指定すると止まる（過去の評価を再現するときだけ `--reuse-seed` を付ける）。
- 抜き取りの条件（`sample.json`）は判定を記入する前にコミットする。
  一覧（`*.tsv`）は過去の判定を引き継いで判定済みの行を含むことがあるので、このコミットには入れない。
  `report` は、`sample.json` を最初に含むコミットが判定（o / x）を最初に含むコミットより前（祖先）にあるかを git の履歴で確かめ、結果を図と上の表の下に出す。

```sh
deno task accuracy sample --label v1.0.3
git add docs/accuracy/v1.0.3/sample.json && git commit -m "v1.0.3 の正解率の抜き取り条件を記録する"   # 判定の前に、抜き取りの条件だけをコミットする
# 判定を記入する
deno task accuracy report --label v1.0.3
git add docs/accuracy README.md && git commit -m "v1.0.3 の正解率を記録する"
```

### 人の確認

判定は既定では AI が行う。次のどれかに当たる評価では、AI の判定に加えて人が紙面と照合する。
その場で「大きな変更か」を判断しないよう、対象は変更の種類で決めておき、`report` が前回の評価（ほかのラベルで直前に抜き取ったもの）と比べて判定する。

- 最初の評価
- OCR をやり直したとき（エンジン・モデル・設定の変更を含む）。`sample` が記録する OCR 済みの入力（`data/extract`・`data/extract-ndl`・`data/recheck`）のハッシュが前回と違えば当たる。
- OCR・読み直し・抽出のコード（`src/ndlocr_lite.ts`、`src/work.ts`、`src/extract.ts`、`src/extract_ndl.ts`、`src/recheck.ts`）を変えたとき
- クレンジングの規則や辞書への振り分け（`src/cleanse.ts`、`src/align.ts`、`src/kana.ts`、`src/build.ts`）を追加・変更したとき
- 抜き取ったときに未コミットの変更があったとき
- 判定の基準（上の「正しい」の定め）を変えたとき（コードに現れないので、評価する人が `--human-check` の記録に理由を書く）

人の確認では、AI が x とした候補すべてと、o とした候補から辞書ごとに 50 件を無作為に選んで照合する。
食い違いがあれば人の判定を採って一覧の note に残し、`deno task accuracy report --label <label> --human-check "<確認した内容>"` で記録する。
必要なのに記録が無ければ、図と上の表の下に「人の確認: 必要だが未実施」と出る。

この確認の能力には限りがある。o の 50 件の確認で見つけられるのは、AI の誤判定の率がおよそ 5% 以上の場合である（誤判定の率が p のとき 1 件以上見つかる確率は 1 − (1 − p)^50 で、90% になるのは p ≈ 4.5%。p = 1% なら約 40%）。
したがってこの確認で示せるのは「AI の誤判定は数% を超えるほど多くはない」までで、99% の主張そのものを裏付ける精度は無い。
99% の主張を人の確認で裏付けるには、o から見る件数を増やす必要がある（誤判定の率が 1% のとき、90% の確率で見つけるには約 230 件）。
図と表の「人の確認: 実施」には、この検出の下限を併せて出す。

条件にクレンジングの規則の変更が入っているため、実際にはほとんどのリリースで人の確認が必要になる。
負担が大きいときは、無理に毎回行わず、「必要だが未実施」のまま公表してよい。未実施であることは図と表に出るので、隠れることはない。

### v1.0.0 の数字について

- 検証済みの辞書の抜き取りは、beta5 の評価（2026年9月24日）と同じ標本である（L 除外辞書もその一部を使う）。
  規則の調整に使ったのは beta4 までの抜き取り（シード値 2024、5、99、7）で、beta5 の抜き取りから判定、コミット（`715d4d5`）までの間に規則は変えていない。
  ただし `715d4d5` と結果の記録（`a6bc598`）は同じ時刻のコミットで、この前後関係は履歴では確かめられない。
- この結果が 99% に達したのを見て 1.0.0 としたため、正解率は高めに出ている可能性がある。
  標本は調整に使っていなくても、beta ごとに新しい標本で測り、点推定が初めて 99% を超えた回で止めると、偶然高めに出た回を採りやすい（基準を超えたところで測るのをやめると、結果は楽観側に偏る）。
- 1.0.0 の根拠は、点推定が 99% 以上であることを基準にした。信頼区間の下限（98.4%）は 99% を下回っている。
- シード値 101、202、303 は beta5 の評価で各 150 件を判定する前に決めて使い、選び直してはいないが、初めて記録したのは結果と同じコミット（`a6bc598`）である。
  L 除外辞書と未検証の辞書の抜き取りも同じシード値から決まる（`deno task accuracy sample --label v1.0.0 --seed 101,202,303` で再現できる）。
- 判定は AI のみで、人の確認はしていない。
- 偏りの大きさは、新しいシード値で抜き取り直した再評価と並べれば分かる。

過去に判定した候補（id・見出し・表記が同じもの）は判定を引き継ぐので、辞書を作り直した後も、変わった候補だけを判定すればよい。
L 除外辞書は検証済みの辞書の一部なので、検証済みの辞書の抜き取りのうち L 除外辞書に入る候補はそのまま使い、足りない分だけ追加で抜き取る。

## CI とリリース

| ワークフロー                             | 契機                            | 内容                                                                               |
| ---------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| [CI](.github/workflows/ci.yml)           | push、プルリクエスト            | 整形・lint・型チェック・テストと、辞書のビルド（成果物は Actions の artifact）     |
| [Release](.github/workflows/release.yml) | バージョンタグ `v*` の push     | そのタグのリリースを作る。ハイフンを含むタグ（`v1.1.0-beta.1` など）はプレリリース |
| 〃                                       | 毎週日曜 03:00（JST）、手動実行 | タグ `build-YYYYMMDD` のプレリリースを作る                                         |

どちらもビルドは共通の [Build](.github/workflows/build.yml) で行う。

- JMdict のライセンスは、JMdict を使うソフトウェアに最新版からの定期的な更新の手順を求めているので、毎回最新の JMdict を取得してビルドし、毎週リリースし直す。
- OCR（数時間かかる）はワークフローでは行わない。OCR 済みの見出し語の候補（`data/extract/`、`data/extract-ndl/`、`data/recheck/`）をタグ `inputs` のリリースに置き、それを使う。
- リリースのアーカイブには、辞書3種の UTF-8 版と EUC-JP 版、`entries.tsv.gz`、`report.md`、使ったリソースの取得元と取得日時（`resources.json`）、`LICENSE`・`NOTICE`・`LICENSES/`・`README.md` を入れる（[scripts/package-release.sh](scripts/package-release.sh)）。

バージョンを付けてリリースするには、タグを push する。

```sh
git tag v1.0.0
git push origin v1.0.0
```

OCR や抽出の処理を変えたときは、入力データを作り直して `inputs` のリリースを更新する。

```sh
deno task extract
deno task cleanse          # data/extract-ndl/ が無ければ NDL 側 OCR の候補も作られる
deno task recheck          # 読み直しの対象はクレンジング結果から選ぶ
deno task cleanse
deno task pack-inputs      # dist/inputs.tar.gz
gh release upload inputs dist/inputs.tar.gz --clobber
```

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
├── raw/resources/                SKK-JISYO.L（コミット固定）と Unihan.zip
├── work/<pid>.json               作業用 JSON
├── extract/<pid>.json            見出し語・表記の候補
├── extract-ndl/<pid>.json        NDL 側 OCR から取り出した見出し語の候補（クレンジングでの突き合わせ用）
├── recheck/<pid>.json            見出しの切り出しの読み直しの結果（raw/recheck/ に OCR の出力）
└── cleanse/<pid>.json            クレンジング結果（補正の記録つき）
```

### ビルドされる辞書（`dist/`）

辞書は UTF-8 版（`utf-8/`）と EUC-JP 版（`euc-jp/`）の2つを出す。ファイル名はどちらも同じ。

| ファイル                                                     | 内容                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `utf-8/SKK-JISYO.dainihonkokugojiten`、`euc-jp/…`            | 検証済み（SKK-JISYO.L・JMdict との一致、または Unihan の音訓で読みと表記が対応）のエントリ |
| `utf-8/SKK-JISYO.dainihonkokugojiten.noL`、`euc-jp/…`        | 上から SKK-JISYO.L にある候補を除いたもの                                                  |
| `utf-8/SKK-JISYO.dainihonkokugojiten.unverified`、`euc-jp/…` | 検証できなかったエントリ。誤りを多く含む                                                   |
| `entries.tsv`                                                | 全候補の一覧（状態、検証方法、補正の記録、紙面画像の切り出し URL）                         |
| `report.md`                                                  | 件数の内訳                                                                                 |

EUC-JP 版は、従来の SKK 辞書（SKK-JISYO.L など）と同じく ASCII と JIS X 0208 の範囲で符号化する。
JIS X 0208 に無い文字（一部の旧字体など）を含む候補は EUC-JP 版から除く（除いた数は `report.md` に出す）。多くは旧字体の候補で、同じ語の新字体の候補は残る。

候補には新字体と、底本の字体（旧字体）の両方を入れる。
候補の注釈には、現代の読みと違う場合は底本の歴史的仮名遣いの読みを、続けて品詞を付ける（`ちょうちょう /蝶蝶;てふてふ（名）/`）。

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
