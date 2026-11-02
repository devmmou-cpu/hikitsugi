# 夜間の作業：追加4社の評価データの生成

あなたは「ヒキツギ」の評価データの作成担当です。依頼者は寝ていて、質問には答えられません。判断に迷ったら、安全で小さい方を選び、報告書に書いてください。最初に `CLAUDE.md` と `docs/design.md` を読んでください。

## 作るもの
`eval/sets/<会社>/` に4社分の評価データを作ります。**1社作るごとに検査を通してコミットしてから**、次の会社に進みます。

| 会社 ID | 会社名 | 区分 | 規模 | 調査する PC | 環境の特徴 | identifiers（host_prefix / brand / domain / latin） |
|---|---|---|---|---|---|---|
| `kuzuri` | クズリ運輸株式会社 | tuning | 85名 | 4台 | 本社と営業所の2拠点を VPN でつなぐ。配車の業務システムがある | KZR / KUZURI / kuzuri-unyu / Kuzuri |
| `kinodoten` | キノドテン建設株式会社 | tuning | 12名 | 2台 | 小規模。ファイルは主に OneDrive に置き、共有フォルダは1つだけ | KND / KINODOTEN / kinodoten-kensetsu / Kinodoten |
| `rater` | ラーテル商事株式会社 | holdout | 28名 | 3台 | 卸売業。NAS は RAID6 で、受発注の業務システムがある | RTL / RATER / rater-shoji / Rater |
| `kenaga` | ケナガ印刷株式会社 | holdout | 18名 | 5台 | 印刷業。複合機が複数あり、制作用の PC と事務用の PC が分かれる | KNG / KENAGA / kenaga-insatsu / Kenaga |

各社の形式はオコジョ精工（`eval/sets/okojo/`）と同じです。**形式の見本として読むだけで、文面や数値を流用しません。** 各社とも、総務などの担当者が IT を兼任している設定にします。

**日付は未来にしません。** 基準日（`as_of`）、調査の取得日時、聞き取りの開始日時は、すべて `2026-11-05` 以前にします。画面に確認日として表示されるためです。

## 作る順番
1. `case.json`：`identifiers` を含める。`summary` に「85名」のように従業員数を書く
2. `input/survey.json`：ID は PC 名、項目キーの順で連番。`hidden/tanaka_facts.json`：事実と台本
3. `node eval/tools/build-transcript.mjs <会社>` で聞き取り記録を作る（**手で編集しない**）
4. `input/statements.json`、`answers/verifier.json`、`answers/gaps.json`、`answers/troubles.json`
5. `node eval/tools/check-set.mjs <会社>` が「問題なし」になるまで直す。コミットする

## 誤りの作り方（E1〜E10、1社に1件ずつ）
| 誤り | 内容 | 期待判定 |
|---|---|---|
| E1 | 機器の構成が調査や聞き取りと矛盾する | contradiction |
| E2 | OS の取り違え（各社に Windows 10 の PC を1台以上置く） | contradiction |
| E3 | 共有フォルダの接続先が違う | contradiction |
| E4 | 根拠のない電話番号（下の注意を参照） | unsupported |
| E5 | パスワード本体の記載（下の注意を参照） | dangerous |
| E6 | 後任がやると壊れる操作を「自分で直せる」としている | dangerous |
| E7 | 業者の取り違え | contradiction |
| E8 | 期限の誤り | contradiction |
| E9 | 聞き取りと矛盾する体制 | contradiction |
| E10 | 頻度の誤り | contradiction |

- **各社で題材を変えます。** オコジョ精工と同じ機器、同じ数字の誤りにしないでください
- **E4 は純粋な「根拠なし」にします。** ほかの事実と矛盾してはいけません。実在する業者（聞き取りに名前が出てくる業者）について、記録のない電話番号を書きます。その業者の本当の電話番号は `case.json` だけに置き、調査データと聞き取りには書きません。T1〜T5 の連絡先にもしません。「保守契約がない」のような、記述を否定する事実を作らないでください
- **E5 は実在しないダミーを1社に1件だけ書きます。** 値は会社ごとに変えます。同じ値を他のファイルや報告書に書き写さないでください
- 正しい記述は 18〜22 件混ぜます。保管場所の案内や、やってよい操作など、**危なそうに見えて正しい記述**を必ず入れます
- 誤りの記述にも、もっともらしい根拠 ID を付けます。誤りを前半や後半に固めません

## 架空のルール
- 人名は田中さん、佐藤さん、社長だけ。業者名はクロテン通信、カワウソシステムサービス、イタチ事務機、イイズナソフト、フェレット企画だけ
- 実在の製品名は Windows、Microsoft 365、Teams、OneDrive、Outlook、Excel、PowerShell だけ。機器やソフトのメーカー名、型番は `架空メーカーA`、`MODEL-A1` のように書く
- 電話番号は `03-0000-01xx`、ドメインは `<identifiers の domain>.example`、IP は `192.168.10.x`
- 実在のパスワードや認証情報を書かない。書くのは保管場所だけ（E5 のダミーを除く）

## 合格条件
- `npm test` が全件成功すること。約束は `test/eval-sets.acceptance.test.mjs` にあります
- `node scripts/check-secrets.mjs` が「問題なし」と出ること

## 守ること
- 変更してよいのは `eval/sets/kuzuri/`、`eval/sets/kinodoten/`、`eval/sets/rater/`、`eval/sets/kenaga/` と `docs/night/eval-sets-report.md` だけ
- **`eval/sets/okojo/`、`test/`、`eval/lib/`、`eval/tools/`、`eval/schemas/`、`plugin/` を変更しない**
- テストや検査が厳しすぎると思っても、弱めない。通せなければ、理由を報告書に書いて止まる
- push しない。ブランチを切り替えない。API、ネットワーク、外部ライブラリを使わない
- エージェントのプロンプトを書かない、変更しない
- コメントと文書は日本語
- コミットのメッセージは日本語で、末尾に次の行を付ける

  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## 終わるとき
`docs/night/eval-sets-report.md` を書いてコミットします。

- `npm test` の結果（件数）と、4社それぞれの検査の結果
- 各社の設定の要点（規模、環境）。自分で決めたこと
- 通せなかったテストがあれば、その理由
- **保留の2社（`rater`、`kenaga`）は、どの記述が誤りかを報告書に書かない。** 件数だけを書く。報告書は開発の作業でも読むため

全テストが通ったら、それ以上手を広げずに止まってください。
