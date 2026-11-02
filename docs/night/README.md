# 夜間の自動実行の手順（表示プログラム T1）

## 仕組み
| 守るもの | 方法 |
|---|---|
| テストと評価データ | 権限設定で編集を拒否し、朝に基準点との差分でも確かめる |
| push、外部通信、ブランチの切り替え | 権限設定で拒否（ローカルの複製で確認済み） |
| 許可していない操作 | `dontAsk` で自動的に拒否。質問で止まらない |
| Max プランの枠 | `ANTHROPIC_API_KEY` を外して起動し、API クレジットを使わない |

権限設定は `renderer-t1.settings.json`、作業指示は `renderer-t1.md` です。

## 寝る前
電源につなぎ、ふたを開けたままにして、次を実行します。
```bash
cd ~/Developer/hikitsugi && git switch night/renderer-t1 && mkdir -p night-logs && \
caffeinate -is env -u ANTHROPIC_API_KEY claude -p "$(cat docs/night/renderer-t1.md)" \
  --model claude-opus-5-5 --effort high \
  --settings docs/night/renderer-t1.settings.json --permission-mode dontAsk \
  --output-format stream-json --verbose < /dev/null > night-logs/renderer-t1.jsonl 2>&1
```
画面には何も出ません。終わるとプロンプトが戻ります。途中で止めるときは Ctrl+C を押します。

別のターミナルで動いているか確かめるには、次を実行します。
```bash
ls -l ~/Developer/hikitsugi/night-logs/ && git -C ~/Developer/hikitsugi log --oneline -3
```

## 朝の確認
上から順に実行します。
```bash
cd ~/Developer/hikitsugi
# 1. 空であること（テストや評価データを変更していない）
git diff --stat night-base/renderer-t1..night/renderer-t1 -- test eval plugin/schemas plugin/lib plugin/checklist scripts package.json .gitignore CLAUDE.md docs/night/renderer-t1.md docs/night/renderer-t1.settings.json
# 2. 変更したファイルの一覧（plugin/renderer と報告書だけのはず）
git diff --stat night-base/renderer-t1..night/renderer-t1
# 3. 全件成功すること
npm test
# 4. 「問題なし」と出ること
node scripts/check-secrets.mjs
# 5. 報告書を読み、画面を見る
cat docs/night/renderer-t1-report.md
open night-logs/manual-t1.html
```
**1 に差分が出たら取り込まないでください。** テストが通らない場合も同じです。

問題がなければ、main に早送りマージして push します。
```bash
git switch main && git merge --ff-only night/renderer-t1 && npm test && node scripts/check-secrets.mjs && git push origin main
```

途中で失敗していたら、最後の結果はログの末尾で分かります。
```bash
tail -n 1 night-logs/renderer-t1.jsonl
```
