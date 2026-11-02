# 表示プログラムの直したい点

後でまとめて直します。

## 画面
- [ ] 手順のチェック欄と番号「1.」が重なっている
- [ ] 手順の一覧だけ左の余白が大きい

## 確認日
- [ ] 確認日の「2026年11月20日」が未来の日付になっている。2026年11月5日など、撮影日より前の日付に直す

確認日の修正は表示プログラムではなく、評価セットの変更です。**理由つきの単独コミット**にします。直すときは次の点に注意します。

- 変更先は `eval/sets/okojo/` の `case.json`、`input/survey.json`、`input/transcript.fixture.json`、`hidden/tanaka_facts.json` と、`test/fixtures/manual-t1.json`
- 聞き取り記録は手で編集せず、`node eval/tools/build-transcript.mjs okojo` で作り直す
- `test/eval-sets.acceptance.test.mjs` の `OKOJO_SHA256` を同じコミットで更新する（オコジョ精工のデータの基準値のため）。夜間の生成が動いている間は変更しない
- `test/renderer.acceptance.test.mjs` など、この日付に依存するテストがないか確かめる

## 機能
- [ ] 定期作業（routines）と機器の一覧（devices）を表示する。今は表示プログラムが受け付けないので、`plugin/lib/handover.mjs` が件数を示して外している
