# 夜間の作業：調査スクリプトと、複数 PC の結果をまとめるプログラム

あなたは「ヒキツギ」の調査スクリプトの担当です。依頼者は寝ていて、質問には答えられません。判断に迷ったら、安全で小さい方を選び、報告書に書いてください。最初に `CLAUDE.md` と `docs/design.md` を読んでください。

## 作るもの
1. `plugin/scripts/survey.ps1`：PC 1台の情報を読み取り、1つの JSON ファイルに保存する
2. `plugin/lib/merge-survey.mjs` と `plugin/scripts/merge-survey.mjs`：複数 PC の結果を、`plugin/schemas/survey.schema.json` の形にまとめる
3. `plugin/skills/start/SKILL.md` の `init` の段階：調査の実行、中身の確認、まとめ方の案内を足す
4. `docs/survey-test.md`：本人が Windows 11 Pro で試す手順書
5. `.gitignore`：`hikitsugi-survey-*` を足す

約束は `test/survey.acceptance.test.mjs` の冒頭にあります。1台分の形は `test/fixtures/survey-raw/` の見本のとおりです。

## 調査スクリプトの決まり
- **読み取り専用です。** 設定の変更、結果以外のファイルの書き換え、ネットワークへの送信、他の PC や機器への走査をしません
- Windows 11 と 10 に標準で入っている Windows PowerShell 5.1 だけで動きます。追加のインストールをしません
- **管理者権限を求めません。** 権限がなくて取れない項目は `denied`、取れない項目は `unavailable` として記録し、止まらずに続けます
- 実行するとまず、集める内容と集めない内容を日本語で表示します。同意（`y`）があるまで何も集めません
- 結果は今いるフォルダの `hikitsugi-survey-<PC 名>-<日付>.json` に保存し、中身を確かめてから渡すよう案内します
- 文字の案内は、IT の知識がなくても分かる日本語にします

## 集める項目
| 区分（category） | 項目名（key） | 値 |
|---|---|---|
| os | `os.caption`、`os.version` | OS の名前とバージョン |
| hardware | `hw.maker`、`hw.model`、`hw.memory_gb`、`disk.c_free_gb` | メーカー、型番、メモリ（GB の整数）、C ドライブの空き（GB の整数） |
| network | `net.ip_mode`、`net.gateway`、`net.dns`、`net.wifi_ssid` | `DHCP` か `固定`、ゲートウェイ、DNS、接続中の Wi-Fi 名（なければ `null` で `unavailable`） |
| share | `share.drive.<文字>` | ネットワーク ドライブの接続先 |
| printer | `printer.<番号>` | プリンターの名前と接続先 |
| software | `software.<番号>` | インストール済みソフトの名前とバージョン。レジストリの Uninstall キーから読む |
| security | `security.last_update`、`security.feature_update`、`security.antivirus`、`security.bitlocker` | 最後の更新日、大型更新の保留の設定、ウイルス対策の状態、BitLocker の有無 |
| account | `account.join_type`、`account.m365_signed_in` | ドメインかワークグループか、Microsoft 365 にサインイン済みか |

PC 名は項目ではなく、生データの `host` に入れます。

## 集めない項目
パスワード、Wi-Fi のパスワード、保存済みの認証情報、ファイルの中身、メールの中身、閲覧履歴、個人のユーザーフォルダの一覧、他の PC やネットワーク機器の情報。

**次のものは、読むだけに見えても使いません。** `Win32_Product`（読むと修復が走ることがある）、`netsh wlan show profile`（パスワードに近い情報）、`Get-ChildItem`（フォルダの一覧になる）。

## 落とし穴
- 5.1 は BOM のない UTF-8 の日本語を読み違えます。ファイルは BOM つき UTF-8 で保存します
- `ConvertTo-Json` は既定で深さ2までで、1件だけの配列は配列になりません。`-Depth` を指定し、配列は `@()` で包みます
- 結果を書くときは、BOM なし UTF-8 で書きます（`[System.IO.File]::WriteAllText`）。`Out-File` は使いません
- 自分で定義する関数の名前は「動詞-名詞」の形にしません（例：`AddResult`）。テストが、許可されていないコマンドとして止めます
- 大きな整数や日付は、文字列と数値を約束の形にそろえます。日付は `yyyy-MM-dd`、取得日時はタイムゾーンつきです

## 実行できないことの扱い
この Mac には PowerShell がないので、スクリプトは実行できません。**動かしたと書かないでください。** 静的な検査に合格しただけであること、実機で確かめてほしい箇所を、報告書に具体的に書きます。

## 合格条件
- `npm test` が全件成功すること
- `node scripts/check-secrets.mjs` が「問題なし」と出ること

## 守ること
- 変更してよいのは、上の「作るもの」のファイル、`docs/night/survey-report.md`、`night-logs/` だけ。**`test/`、`eval/`、`plugin/schemas/`、`plugin/lib/` の既存のファイル、`plugin/library/`、`plugin/agents/`、`package.json`、`CLAUDE.md` を変更しない**
- テストが厳しすぎると思っても、弱めない。通せなければ、理由を報告書に書いて止まる
- push しない。ブランチを切り替えない。API、ネットワーク、外部ライブラリを使わない
- 架空のルールを守る。実在の IP や接続先をスクリプトや文書に書かない
- コメントは日本語

## コミットのしかた
動く単位でコミットします。**コマンドは1つずつ実行し、`&&` でつなぎません。** メッセージの末尾には、次の行を付けます（`-m` を2つ続けて指定できます）。

`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## 終わるとき
1. `docs/night/survey-report.md` に報告書を書く：作ったもの、仕様にない判断と理由、実機で確かめてほしい箇所、残った問題
2. 報告書をコミットする
