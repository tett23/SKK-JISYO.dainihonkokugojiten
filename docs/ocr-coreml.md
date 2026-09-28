# ndlocr-lite の CoreML 実行プロバイダーの調査（2026年9月28日）

ndlocr-lite は onnxruntime で推論する。onnxruntime には Apple Silicon の GPU・Neural Engine を使う CoreML 実行プロバイダーがあるので、CUDA なしで Mac の OCR を速くできるかを調べた。
いつの時点で何を試したかは [ocr-coreml-log.md](ocr-coreml-log.md) を参照。
結論として、**採用しない**。GPU を使うと検出が約 2.8 倍速くなるが OCR の結果が変わり（行の取りこぼしが増える）、結果を変えない設定では全体で数 % しか速くならない。

## 環境

- Apple M1 Max、macOS、Python 3.11
- ndlocr-lite 1.0.0（uv tool）、onnxruntime 1.23.2（`CoreMLExecutionProvider` を含む）
- ndlocr-lite のモデル: レイアウト検出 DEIM（`deim-s-1024x1024.onnx`、入力 800×800）、文字認識 PARSeq 3 種（行の長さで 30・50・100 文字のモデルを段階的に使う）
- ndlocr-lite は `--device` に cpu と cuda しか選べない。CPU では DEIM は既定のスレッド数、PARSeq は 1 スレッドのセッションを行ごとにスレッドプールで並列に動かす

## どこに時間がかかっているか

4 ページを cProfile で測ると、1 ページあたり文字認識（PARSeq の段階的な認識）が約 1.9 秒、レイアウト検出（DEIM）が約 0.5 秒（うち推論 0.39 秒）、読み順の推定が約 0.2 秒だった。
時間の大半は文字認識にかかる。

## モデルごとの推論時間（1 回あたり）

`MLComputeUnits` は CoreML に使わせる計算装置、`ModelFormat` は onnxruntime が作る Core ML モデルの形式。

| モデル          | CPU（onnxruntime） | CoreML NeuralNetwork | CoreML MLProgram CPUAndGPU | CoreML MLProgram ALL | CoreML MLProgram CPUAndNeuralEngine | CoreML MLProgram CPUOnly |
| --------------- | -----------------: | -------------------: | -------------------------: | -------------------: | ----------------------------------: | -----------------------: |
| DEIM            |        381〜391 ms |     失敗 / 1,162 ms※ |        失敗 / 138〜140 ms※ |       失敗 / 157 ms※ |                                失敗 |                  297 ms※ |
| PARSeq 30 文字  |              14 ms |                74 ms |                      23 ms |                25 ms |                               25 ms |                        — |
| PARSeq 100 文字 |              50 ms |               198 ms |                          — |                    — |                                   — |                        — |

※ DEIM は入力のバッチ次元 N が動的なので、そのままでは CoreML がモデルを作れない（MLProgram は「実行計画を作れない」、NeuralNetwork は推論時に失敗）。`add_free_dimension_override_by_name("N", 1)` と `RequireStaticInputShapes` で N を 1 に固定すると動く（ndlocr-lite は 1 ページずつ推論するので問題ない）。そのときの値。CoreML に割り当てられた部分グラフは MLProgram で 23、NeuralNetwork で 108。

- CoreML へのモデルの変換に 1 モデルあたり 10〜130 秒かかる（`ModelCacheDirectory` で 2 回目以降は省ける）
- PARSeq は自己回帰で小さな演算を繰り返すため、CoreML ではどの設定でも CPU より遅い

## 結果が変わるか

DEIM の検出（スコア 0.2 以上）を、CPU の結果と箱の座標で照合した（R0000200 のページ、954646）。

| 設定                       | 検出数（CPU は 407） | CPU の検出と一致 |
| -------------------------- | -------------------: | ---------------: |
| CoreML MLProgram CPUOnly   |                  407 |              407 |
| CoreML MLProgram CPUAndGPU |                  469 |              313 |

GPU では計算の精度が下がる（スコアの差が最大 0.27。CPUOnly では 0.00015）ため、検出が変わる。
20 ページ（954646 の R0000200〜R0000219）を通しで OCR すると、GPU では 20 ページすべてのテキストが CPU と違い、R0000200 では CPU の 302 行に対して 228 行しか出なかった（行の取りこぼし）。精度を落とすので使えない。

## 20 ページを通しで OCR した時間

| 設定                                   |          時間 | 結果が CPU と同じか     |
| -------------------------------------- | ------------: | ----------------------- |
| ndlocr-lite そのまま（CPU）            | 56.2〜58.3 秒 | —                       |
| DEIM だけ CoreML CPUAndGPU（変換済み） |       44.0 秒 | 違う（20 ページすべて） |
| DEIM だけ CoreML CPUOnly（変換済み）   |       54.4 秒 | 同じ                    |
| CPU のまま 10 ページずつ 2 プロセス    |       50.7 秒 | 同じ                    |

結果を変えない設定（CoreML の CPUOnly）では約 3〜7% しか速くならず、測定のばらつきと同じ程度なので採用しない。
CPU のまま 2 プロセスに分けると約 10% 速くなる（1 プロセスでは CPU を 10 コア中 6 コアほどしか使っていない）。これまでも見出しの読み直しは 2 プロセスで動かしている。

## 試していないこと

- coremltools で ONNX を経ずに Core ML モデルを作り、計算の精度を FP32 に指定する方法（元の PyTorch のモデルが必要）
- PARSeq を GPU で、CPU のスレッドと並行して動かす方法（1 回が CPU より遅く、GPU の精度の問題もあるため見送った）
