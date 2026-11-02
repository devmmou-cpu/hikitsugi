# 夜間の自動実行の手順（追加4社の評価データ）

`night/eval-sets` ブランチで動かします。**API キーは使わず、Max プランの枠で動きます。** API の費用はかかりません。

| 段階 | モデル | エフォート | 指示 | 権限 |
|---|---|---|---|---|
| データの生成 | Sonnet 5.5 | medium | `eval-sets.md` | `eval-sets.settings.json` |
| 別の Claude による点検 | Opus 5.5 | high | `eval-sets-review.md` | `eval-sets-review.settings.json` |

## 寝る前
電源につなぎ、ふたを開けたままにして、次を実行します。生成が終わったあと、続けて点検が動きます。
```bash
cd ~/Developer/hikitsugi && git switch night/eval-sets && mkdir -p night-logs && \
caffeinate -is sh -c '
env -u ANTHROPIC_API_KEY claude -p "$(cat docs/night/eval-sets.md)" \
  --model claude-sonnet-5-5 --effort medium \
  --settings docs/night/eval-sets.settings.json --permission-mode dontAsk \
  --output-format stream-json --verbose < /dev/null > night-logs/eval-sets.jsonl 2>&1
env -u ANTHROPIC_API_KEY claude -p "$(cat docs/night/eval-sets-review.md)" \
  --model claude-opus-5-5 --effort high \
  --settings docs/night/eval-sets-review.settings.json --permission-mode dontAsk \
  --output-format stream-json --verbose < /dev/null > night-logs/eval-sets-review.jsonl 2>&1
'
```
画面には何も出ません。終わるとプロンプトが戻ります。途中で止めるときは Ctrl+C を押します。

## 朝の確認
上から順に実行します。
```bash
cd ~/Developer/hikitsugi
# 1. 空であること（検査、テスト、オコジョ精工のデータを変更していない）
git diff --stat night-base/eval-sets..night/eval-sets -- test eval/lib eval/tools eval/schemas eval/run.mjs eval/sets/okojo plugin scripts package.json .gitignore CLAUDE.md docs/design.md docs/night/eval-sets.md docs/night/eval-sets-review.md docs/night/eval-sets.settings.json docs/night/eval-sets-review.settings.json
# 2. 変更したファイルの一覧（4社のフォルダと報告書だけのはず）
git diff --stat night-base/eval-sets..night/eval-sets | tail -40
# 3. 全件成功すること
npm test
# 4. 「問題なし」と出ること
node scripts/check-secrets.mjs
# 5. 報告書と点検結果を読む
cat docs/night/eval-sets-report.md
cat night-logs/eval-sets-review-tuning.md
cat night-logs/eval-sets-review-holdout.md
```
**1 に差分が出たら取り込まないでください。** テストが通らない場合も同じです。

### 点検結果の扱い
- `eval-sets-review-holdout.md` は、**開発の Claude Code に貼らないでください。** 保留の会社の誤りが分かると、最終確認の意味がなくなります
- 問題が見つかった場合は、修正の担当を決めてから取り込みます。正解データの修正は、理由を書いた単独のコミットにします

問題がなければ、main に取り込みます。main が先に進んでいる場合は、rebase してからもう一度 3 と 4 を確かめます。

## 途中で失敗していたら
最後の結果はログの末尾で分かります。
```bash
tail -n 1 night-logs/eval-sets.jsonl
tail -n 1 night-logs/eval-sets-review.jsonl
```
