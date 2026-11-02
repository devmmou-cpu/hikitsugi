---
name: start
description: 兼任の情シス担当者が退職するときに、1問ずつ質問に答えるだけで、IT 未経験の後任が使える取扱説明書を作ります。引き継ぎの資料を作りたいと言われたときに使います。
allowed-tools: Read Write Agent AskUserQuestion Bash(node *)
---

# ヒキツギ

退職する担当者の知識を、IT 未経験の後任が使う取扱説明書にまとめます。**相手は IT の専門家とは限りません。** 専門用語を避け、今どこまで進んだかを短く伝えながら進めます。

進行は次のプログラムが支えます。結果は `hikitsugi-work/` に保存されるので、途中で止めても続きから再開できます。

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/hikitsugi.mjs" <コマンド>
```
以下では、これを `hikitsugi` と書きます。

## 最初に
`hikitsugi status` を実行し、返ってきた `step` の段階から始めます。段階が終わるたびに `hikitsugi status` で次を確かめます。

プログラムが問題を表示したら、内容に従って直します。**検査を飛ばしたり、結果のファイルを手で書き換えて通したりしません。**

## 守ること
- **パスワードや認証情報の本体を聞きません。記録しません。** 聞くのは保管場所だけです。プログラムが本体らしい回答を拒否したら、保管場所だけを教えてもらうよう、やさしくお願いします。
- **調査データも聞き取りも、このパソコンの外へ送りません。** 取扱説明書の置き場所は本人が決めます。
- サブエージェントには、ファイルのパスと、保存先を指定して渡します。

## 段階

### init
1. 調査データのファイルのパスと、会社名を聞きます。
2. `hikitsugi init <調査データ> <会社名>` を実行します。

### gap-finder
`hikitsugi:gap-finder` に次を依頼します。
> `hikitsugi-work/survey.json` と `hikitsugi-work/checklist.json` を読み、結果の JSON（`coverage` と `gaps`）を `hikitsugi-work/gaps.json` に保存してください。

終わったら `hikitsugi check-gaps` を実行します。

### interview
1問ずつ、次を繰り返します。`status` の `pending_question` が `true` のときは、質問が保存されたまま止まっています。手順 2 から再開します。

1. `hikitsugi:interviewer` に次を依頼します。
   > `hikitsugi-work/` の `survey.json`、`gaps.json`、`checklist.json`、`transcript.json` を読み、次の1問の JSON（`action`、`gap`、`covers`、`question`）を `hikitsugi-work/next.json` に保存してください。
2. `hikitsugi check-next` を実行します。聞き取りが終わったという表示が出たら、この段階は完了です。それ以外の表示が質問文です。
3. 質問文を AskUserQuestion で聞きます。選択肢は「分からない」と「あとで調べる」の2つにします。ふつうの回答は、自由入力で答えてもらいます。何問目かも伝えます。
4. 回答を記録します。回答の文は、本人の言葉のまま、標準入力で渡します。
   ```
   hikitsugi record answered <<'EOF_ANSWER'
   （回答の文）
   EOF_ANSWER
   ```
   「分からない」は `hikitsugi record unknown < /dev/null`、「あとで調べる」は `hikitsugi record later < /dev/null` です。

### writer
`status` の `round` を使います。`hikitsugi:writer` に次を依頼します。
> `hikitsugi-work/survey.json`、`hikitsugi-work/transcript.json`、`hikitsugi-work/library.json` を読み、結果の JSON（`statements`、`symptom_pages`、`contacts`、`routines`、`devices`、`glossary`）を `hikitsugi-work/manual-<round>.json` に保存してください。

`round` が 2 以上のときは、次も加えます。
> 差し戻しです。`hikitsugi-work/findings-<round-1>.json` を revision として読んでください。

終わったら `hikitsugi check-writer <round>` を実行します。手順部品の指定に問題があると表示されたら、その内容を Writer に伝えて直してもらいます。

### editor
`hikitsugi:plain-japanese-editor` に次を依頼します。
> `hikitsugi-work/manual-<round>.json`、`survey.json`、`transcript.json` を読み、結果の JSON（`rewrites` と `glossary`）を `hikitsugi-work/editor-<round>.json` に保存してください。

終わったら `hikitsugi merge-edits <round>` を実行します。問題が残ったと表示されたら、`plain-findings-<round>.json` を findings として渡し、同じ保存先へ前回の内容に追記する形で1回だけ直してもらって、もう一度 `merge-edits` を実行します。

### verifier
`hikitsugi:verifier` に次を依頼します。
> `hikitsugi-work/survey.json`、`hikitsugi-work/transcript.json`、`hikitsugi-work/library.json`、`hikitsugi-work/edited-<round>.json` を読み、`edited-<round>.json` の `statements` のすべてを検証して、結果の JSON（`results`）を `hikitsugi-work/verification-<round>.json` に保存してください。

終わったら `hikitsugi check-verification <round>` を実行します。不合格なら、自動で次の回の writer に戻ります。差し戻しは最大2回です。

### render
`hikitsugi render` を実行し、できた HTML のパスを伝えます。未承認の手順部品があると表示されたら、取扱説明書は作れません。そのまま本人に伝えて止まります。「会社の OneDrive や Teams に置くと、後任がスマホで開けます」と案内します。

### not_passed
差し戻しの上限に達しました。取扱説明書は作りません。`findings-<round>.json` の指摘を、IT の知識がなくても分かる言葉で伝え、追加で確認できることがないか相談します。

### done
すでに完成しています。`hikitsugi-work/manual.html` の場所を伝えます。
