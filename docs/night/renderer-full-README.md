# 夜間の自動実行の手順（表示プログラムの完成版）

`night/renderer-full` ブランチで動かします。**API キーは使わず、Max の枠で動きます。** モデルは Opus 5.5（high）です。外部へは通信しません。スクリーンショットにはインストール済みの Chrome を使うので、追加で入れるものはありません。

## 寝る前
電源につなぎ、ふたを開けたままにして、次を実行します。
```bash
cd ~/Developer/hikitsugi && git switch night/renderer-full && mkdir -p night-logs && \
caffeinate -is env -u ANTHROPIC_API_KEY claude -p "$(cat docs/night/renderer-full.md)" \
  --model claude-opus-5-5 --effort high \
  --settings docs/night/renderer-full.settings.json --permission-mode dontAsk \
  --output-format stream-json --verbose < /dev/null > night-logs/renderer-full.jsonl 2>&1
```
画面には何も出ません。終わるとプロンプトが戻ります。途中で止めるときは Ctrl+C を押します。

## 朝の確認
上から順に実行します。
```bash
cd ~/Developer/hikitsugi
# 1. 空であること（テストや評価データを変更していない）
git diff --stat night-base/renderer-full..night/renderer-full -- test eval scripts plugin/schemas plugin/lib plugin/library plugin/checklist plugin/agents plugin/skills plugin/scripts package.json .gitignore CLAUDE.md docs/design.md docs/night/renderer-full.md docs/night/renderer-full.settings.json docs/night/renderer-full-README.md
# 2. 変更したファイルの一覧（plugin/renderer、docs/renderer-todo.md、報告書だけのはず）
git diff --stat night-base/renderer-full..night/renderer-full
git status --short
# 3. 全件成功すること
npm test
# 4. 「問題なし」と出ること
node scripts/check-secrets.mjs
# 5. 報告書を読み、画面を見る
cat docs/night/renderer-full-report.md
open night-logs/screenshots
open night-logs/manual-full.html
```
**1 に差分が出たら取り込まないでください。** テストが通らない場合も同じです。`git status --short` に未コミットの変更が残っていたら、コミットできていないので 1 と 2 の結果を信用しないでください。

問題がなければ、取り込みを依頼してください。main が先に進んでいるので、rebase してから取り込みます。

## 途中で失敗していたら
最後の結果はログの末尾で分かります。
```bash
tail -n 1 night-logs/renderer-full.jsonl
```
