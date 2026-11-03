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
調査は、本人が自分の PC の PowerShell で実行します。**同意の確認があるので、こちらからは実行しません。** 調査の結果は、本人が中身を確かめるまで開きません。

1. 会社名と、退職する人の名前を聞きます。すでにまとめた調査データがあれば、そのパスも聞いて手順 6 へ進みます。
2. 調査を実行してもらいます。次のコマンドを、`${CLAUDE_PLUGIN_ROOT}` を実際のパスに置き換えて見せます。結果は、そのとき開いているフォルダに `hikitsugi-survey-<PC 名>-<日付>.json` として保存されます。
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/scripts/survey.ps1"
   ```
   次のことを伝えます。
   - 集める内容と集めない内容が画面に出ます。よければ `y` を入力します。パスワードやファイルの中身は集めません
   - 管理者として実行する必要はありません。`ExecutionPolicy Bypass` は今回の実行だけの指定で、PC の設定は変わりません
   - 読めない項目があっても止まりません。あとの質問で補います
3. PC が複数あれば、`survey.ps1` を社内の USB メモリなどで運び、各 PC で同じように実行してもらいます。
4. 中身を確かめてもらいます。結果のファイルをメモ帳で開き、渡したくない内容がないかを見てもらいます。AskUserQuestion で聞きます。選択肢は「確かめた」と「気になる内容がある」の2つです。気になる内容があれば、そのファイルは使わず、どうするかを相談します。
5. 確かめた結果のファイルを、すべてまとめます。会社の ID は、会社名から決める英小文字の短い名前です。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/merge-survey.mjs" hikitsugi-survey-merged.json <会社の ID> <結果1.json> [結果2.json ...]
   ```
   問題が表示されたら、内容を伝えて止まります。認証情報らしい値があると表示されたら、本人に元のファイルを確かめてもらい、調査をやり直すか相談します。**値を読み上げたり、聞き返したりしません。**
6. `hikitsugi init <調査データ> <退職する人の名前> <会社名>` を実行します。まとめた場合の調査データは `hikitsugi-survey-merged.json` です。

### gap-finder
`hikitsugi:gap-finder` に次を依頼します。
> `hikitsugi-work/survey.json` と `hikitsugi-work/checklist.json` を読み、結果の JSON を `hikitsugi-work/gaps.json` に保存してください。保存する形は `hikitsugi-work/gaps-format.json` です。項目の名前と値は、このとおりにしてください。

終わったら `hikitsugi check-gaps` を実行します。問題が表示されたら、その内容を伝えて直してもらいます。

### interview
1問ずつ、次を繰り返します。`status` の `pending_question` が `true` のときは、質問が保存されたまま止まっています。手順 2 から再開します。

1. `hikitsugi:interviewer` に次を依頼します。
   > `hikitsugi-work/` の `survey.json`、`gaps.json`、`checklist.json`、`transcript.json`、`interview-progress.json`（進み具合）を読み、次の1問の JSON（`action`、`gap`、`covers`、`question`、`unfilled`）を `hikitsugi-work/next.json` に保存してください。
2. `hikitsugi check-next` を実行します。聞き取りが終わったという表示が出たら、この段階は完了です。それ以外の表示が質問文です。問題が表示されたときは、その質問を本人に見せず、手順 1 からやり直します。
3. 質問文を AskUserQuestion で聞きます。選択肢は「分からない」と「あとで調べる」の2つにします。ふつうの回答は、自由入力で答えてもらいます。何問目かも伝えます。
4. 回答を記録します。回答の文は、本人の言葉のまま、標準入力で渡します。
   ```
   hikitsugi record answered <<'EOF_ANSWER'
   （回答の文）
   EOF_ANSWER
   ```
   「分からない」は `hikitsugi record unknown < /dev/null`、「あとで調べる」は `hikitsugi record later < /dev/null` です。

### writer
Writer は1回に1つの部分だけを書きます。`status` の `round` と `part` を使います。`part` は `common`（連絡先や手順ページの一覧など）か、手順ページの ID（`T1` など）です。

1. `hikitsugi writer-task <round> <part>` を実行します。
2. `hikitsugi:writer` に次を依頼します。
   > `hikitsugi-work/survey.json`、`hikitsugi-work/transcript.json`、`hikitsugi-work/library.json`、`hikitsugi-work/writer-task.json` を読み、`writer-task.json` を task として、その部分の結果の JSON だけを `hikitsugi-work/writer-<round>-<part>.json` に保存してください。
3. `hikitsugi check-writer <round> <part>` を実行します。問題が表示されたら、その内容を Writer に structure_problems として伝えて直してもらいます。

`status` が次の部分を示すあいだ、繰り返します。1ページごとに、いくつ終わったかを短く伝えます。

### editor
`hikitsugi:plain-japanese-editor` に次を依頼します。
> `hikitsugi-work/manual-<round>.json`、`survey.json`、`transcript.json` を読み、結果の JSON（`rewrites` と `glossary`）を `hikitsugi-work/editor-<round>.json` に保存してください。

`round` が 2 以上のときは、次も加えます。
> `hikitsugi-work/editor-findings-<round>.json` を findings として読み、そこにある文章だけを直してください。すでにある用語の説明は作り直しません。

終わったら `hikitsugi merge-edits <round>` を実行します。問題が残ったと表示されたら、`plain-findings-<round>.json` を findings として渡し、同じ保存先へ前回の内容に追記する形で1回だけ直してもらって、もう一度 `merge-edits` を実行します。

### verifier
`hikitsugi:verifier` に次を依頼します。
> `hikitsugi-work/survey.json`、`hikitsugi-work/transcript.json`、`hikitsugi-work/library.json`、`hikitsugi-work/edited-<round>.json`、`hikitsugi-work/verify-scope-<round>.json`、`hikitsugi-work/state.json` を読み、`state.json` の `retiree` を退職する担当者として、`verify-scope-<round>.json` にある ID の記述を、`edited-<round>.json` の `statements` から探して検証し、結果の JSON（`results`）を `hikitsugi-work/verification-<round>.json` に保存してください。

終わったら `hikitsugi check-verification <round>` を実行します。不合格なら、自動で次の回の writer に戻り、指摘のあった部分だけを書き直します。差し戻しは最大2回です。

### phrases
`hikitsugi phrase-task` を実行し、`hikitsugi:phrase-writer` に次を依頼します。
> `hikitsugi-work/phrase-pages.json` を読み、結果の JSON（`pages`）を `hikitsugi-work/phrases.json` に保存してください。

終わったら `hikitsugi check-phrases` を実行します。問題が表示されたら、その内容を伝えて直してもらいます。

### review
前任者本人に、ページごとに確認してもらいます。**全文を精読してもらう必要はありません。** 確認が終わるまで、取扱説明書には「下書き（前任者の確認前）」の帯が付き、確認の印は出ません。

1. `reviewer` が `null` のときは、`state.json` の `retiree` の名前で `hikitsugi review-start <名前>` を実行します。表示された「退職前にやること」は、本人にしかできない作業の一覧です。後任向けの取扱説明書には載らないので、そのまま本人に見せます。あとで見るときは `hikitsugi before-leaving` です。続けて `hikitsugi render` を実行し、下書きの HTML の場所を伝えます。
2. `status` の `page` について `hikitsugi review-show <page>` を実行し、表示された内容を見せます。
3. AskUserQuestion で聞きます。選択肢は「このままでよい」と「直す」の2つです。何ページ目かも伝えます。
4. 「このままでよい」なら `hikitsugi review-ok <page>` を実行します。
5. 「直す」なら、直す内容を一言で聞いて、本人の言葉のまま標準入力で渡します。
   ```
   hikitsugi review-fix <page> <<'EOF_ANSWER'
   （直す内容）
   EOF_ANSWER
   ```
   この内容は聞き取りの記録になり、そのページだけを書き直して検証し直します。`status` の段階に従います。合格すると、同じページの確認に戻ります。

全ページが「このままでよい」になると、確認の印が付きます。

### render
`hikitsugi render` を実行し、できた HTML のパスと、隣の `phone` フォルダの場所を伝えます。未承認の手順部品があると表示されたら、取扱説明書は作れません。そのまま本人に伝えて止まります。「PC では HTML を開きます。スマホでは、`phone` フォルダごと会社の OneDrive に置くと、フォルダの一覧を目次にして症状のファイルを開けます」と案内します。

### not_passed
差し戻しの上限に達しました。取扱説明書は作りません。`findings-<round>.json` の指摘を、IT の知識がなくても分かる言葉で伝え、追加で確認できることがないか相談します。

### done
すでに完成しています。`hikitsugi-work/manual.html` と `hikitsugi-work/phone` の場所を伝えます。
