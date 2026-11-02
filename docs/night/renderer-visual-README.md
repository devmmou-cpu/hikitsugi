# 長時間の作業の手順（画面の作り直し）

`day/renderer-visual` ブランチを、専用のフォルダで動かします。**API キーは使わず、Max の枠で動きます。** モデルは Opus 5.5（high）です。外部へは通信しません。撮影にはインストール済みの Chrome を使います。

## 起動
電源につないで、次を実行します。
```bash
git -C ~/Developer/hikitsugi-live worktree add ~/Developer/hikitsugi-visual day/renderer-visual && \
cd ~/Developer/hikitsugi-visual && mkdir -p night-logs && \
caffeinate -is env -u ANTHROPIC_API_KEY claude -p "$(cat docs/night/renderer-visual.md)" \
  --model claude-opus-5-5 --effort high \
  --settings docs/night/renderer-visual.settings.json --permission-mode dontAsk \
  --output-format stream-json --verbose < /dev/null > night-logs/renderer-visual.jsonl 2>&1
```
画面には何も出ません。終わるとプロンプトが戻ります。途中で止めるときは Ctrl+C を押します。

別のターミナルで動いているか確かめるには、次を実行します。
```bash
ls -l ~/Developer/hikitsugi-visual/night-logs/ && git -C ~/Developer/hikitsugi-visual log --oneline -3
```

## 終わったあとの確認
上から順に実行します。
```bash
cd ~/Developer/hikitsugi-visual
# 1. 空であること（テスト、評価データ、部品を変更していない）
git diff --stat day-base/renderer-visual..day/renderer-visual -- test eval scripts plugin/schemas plugin/lib plugin/library plugin/checklist plugin/agents plugin/skills plugin/scripts package.json .gitignore CLAUDE.md docs/design docs/design.md docs/night/renderer-visual.md docs/night/renderer-visual.settings.json docs/night/renderer-visual-README.md
# 2. 変更したファイルの一覧（plugin/renderer と報告書だけのはず）
git diff --stat day-base/renderer-visual..day/renderer-visual
git status --short
# 3. 全件成功すること
npm test
# 4. 「問題なし」と出ること
node scripts/check-secrets.mjs
# 5. 報告書を読み、画面を見る
cat docs/night/renderer-visual-report.md
open night-logs/screenshots/pc
open night-logs/screenshots/phone
open night-logs/manual-full.html
```
**1 に差分が出たら取り込まないでください。** テストが通らない場合も同じです。`git status --short` に未コミットの変更が残っていたら、コミットできていないので 1 と 2 の結果を信用しないでください。

問題がなければ、取り込みを依頼してください。

## 途中で失敗していたら
```bash
tail -n 1 ~/Developer/hikitsugi-visual/night-logs/renderer-visual.jsonl
```
