# 夜間の自動実行の手順（調査スクリプト）

`night/survey` ブランチを、専用のフォルダで動かします。**API キーは使わず、Max の枠で動きます。** モデルは Opus 5.5（high）です。読み取り専用の決まりを守るスクリプトなので、高い設定にします。外部へは通信しません。

この Mac には PowerShell がないので、夜間の確認は静的な検査だけです。**実機の確認は、朝に本人が Windows 11 Pro で行います**（`docs/survey-test.md`）。

## 寝る前
電源につなぎ、ふたを開けたままにして、次を実行します。
```bash
git -C ~/Developer/hikitsugi-live worktree add ~/Developer/hikitsugi-survey night/survey && \
cd ~/Developer/hikitsugi-survey && mkdir -p night-logs && \
caffeinate -is env -u ANTHROPIC_API_KEY claude -p "$(cat docs/night/survey.md)" \
  --model claude-opus-5-5 --effort high \
  --settings docs/night/survey.settings.json --permission-mode dontAsk \
  --output-format stream-json --verbose < /dev/null > night-logs/survey.jsonl 2>&1
```
画面には何も出ません。終わるとプロンプトが戻ります。途中で止めるときは Ctrl+C を押します。

## 朝の確認
上から順に実行します。
```bash
cd ~/Developer/hikitsugi-survey
# 1. 空であること（テストや評価データを変更していない）
git diff --stat night-base/survey..night/survey -- test eval scripts plugin/schemas plugin/library plugin/checklist plugin/agents plugin/renderer plugin/scripts/hikitsugi.mjs package.json CLAUDE.md docs/design docs/design.md docs/night/survey.md docs/night/survey.settings.json docs/night/survey-README.md
# 2. 変更したファイルの一覧
git diff --stat night-base/survey..night/survey
git status --short
# 3. 全件成功すること
npm test
# 4. 「問題なし」と出ること
node scripts/check-secrets.mjs
# 5. 報告書と、スクリプトの本文を読む
cat docs/night/survey-report.md
open docs/survey-test.md
```
**1 に差分が出たら取り込まないでください。** テストが通らない場合も同じです。

問題がなければ、`docs/survey-test.md` の手順で実機を試して、結果を教えてください。取り込みはそのあとに依頼してください。**実機の結果のファイルは、リポジトリに入れないでください。**

## 途中で失敗していたら
```bash
tail -n 1 ~/Developer/hikitsugi-survey/night-logs/survey.jsonl
```
