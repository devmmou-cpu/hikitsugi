# 夜間の作業報告：調査スクリプトと、複数 PC の結果をまとめるプログラム

## 結論：完了していません
**`plugin/scripts/` にファイルを作れず、合格条件の `npm test` を満たせないまま止まりました。** 権限の設定に拒否されたためです。設定の変更や別の経路での書き込みはせず、作ったものを `night-logs/draft/` に下書きとして残しました。

| 確認 | 結果 |
|---|---|
| `npm test` | **296件中 285件成功、11件失敗。** 失敗は `test/survey.acceptance.test.mjs` の11件で、原因は `survey.ps1` と `merge-survey.mjs`（コマンド）がないこと（内訳は下） |
| `node scripts/check-secrets.mjs` | 問題なし |
| 変更したテスト | なし |
| `survey.ps1` の実行 | **一度も実行していません。** この Mac には PowerShell がありません |
| コマンドの `merge-survey.mjs` の実行 | **一度も実行していません。** 下書きの場所からは読み込み先が解決できないため |

失敗の内訳
- `survey.ps1` がないことによる失敗：8件（BOM、コマンドの許可リスト、書き込み、同意、必須の項目、失敗の受け止め、JSON、中身の確認の案内）
- コマンドの `merge-survey.mjs` がないことによる失敗：3件（保存と BOM、終了コード、通信なしの検査）

## 止まった理由
`plugin/scripts/survey.ps1` と `plugin/scripts/merge-survey.mjs` への書き込みが、どちらも次の表示で拒否されました。

> File is in a directory that is denied by your permission settings.

`docs/night/survey.settings.json` は両方のファイルを allow に挙げていますが、deny に `Edit(scripts/**)` があります。これがリポジトリ直下だけでなく `plugin/scripts/` にも当たり、deny が優先されたのだと思います。**これは設定の文面からの推測で、確かめてはいません。**

## 朝にしてほしいこと
1. 下書きを読んで、問題がなければ正しい場所へ置きます。
   ```bash
   cp night-logs/draft/survey.ps1 plugin/scripts/survey.ps1
   cp night-logs/draft/merge-survey.mjs plugin/scripts/merge-survey.mjs
   ```
2. テストと点検を実行します。下書きの検査の結果からは合格を見込んでいますが、**まだ確かめていません。**
   ```bash
   npm test
   node scripts/check-secrets.mjs
   ```
3. 合格したらコミットします。
   ```bash
   git add .gitignore plugin/lib/merge-survey.mjs plugin/scripts/survey.ps1 plugin/scripts/merge-survey.mjs plugin/skills/start/SKILL.md docs/survey-test.md
   ```
4. `docs/survey-test.md` の手順で、Windows 11 Pro で試します。
5. 下の「仕様にない判断」のうち、残すものを `docs/design.md` の決定事項に移します。今回は変更が禁止されているので、ここにだけ書いています。

別の夜間の実行で続ける場合は、`Edit(scripts/**)` の見直しが必要だと思います。

## コミットの状態
**コミットしたのはこの報告書だけです。** ほかの変更は作業フォルダに未コミットで残しています。`CLAUDE.md` の「コミット前に `npm test` を通す」を満たせないためです。報告書だけは、指示の「報告書をコミットする」に従いました。このコミットの時点でも `npm test` は失敗しています。

| ファイル | 状態 |
|---|---|
| `plugin/lib/merge-survey.mjs` | 未コミット。合格テストのうち、この部分の検査は通過 |
| `.gitignore` | 未コミット。`hikitsugi-survey-*` を追加 |
| `plugin/skills/start/SKILL.md` | 未コミット。`init` の段階に、調査の実行、中身の確認、まとめ方を追加 |
| `docs/survey-test.md` | 未コミット。実機の手順書 |
| `night-logs/draft/survey.ps1` | 下書き。git の対象外 |
| `night-logs/draft/merge-survey.mjs` | 下書き。git の対象外 |
| `night-logs/draft/draft-check.test.mjs` | 下書きの検査。正しい場所へ置いたあとは不要 |

## 確かめたことと、確かめていないこと
- **確かめた：** `plugin/lib/merge-survey.mjs` は、複数 PC のまとめ、並び順、基準日、形の検査、認証情報の検査、999件の上限の合格テストに通っています
- **確かめた：** `survey.ps1` の下書きは、`draft-check.test.mjs` の11件に通っています。合格テストの静的な検査の主なものを写したもので、**合格テストそのものではありません。** 文字列を調べるだけで、構文やコマンドの動きは確かめていません
- **確かめていない：** `survey.ps1` が動くこと。コマンドの `merge-survey.mjs` が動くこと（終了コード、BOM の読み取り、出力ファイルを作らないこと）

## 仕様にない判断と理由
### 調査スクリプト
| 判断 | 理由 |
|---|---|
| 同意の確認をファイルの先頭に置き、関数の定義もそのあとにする | 同意の前に何も読まないことを、読むだけで確かめられるようにするため |
| 共有フォルダの一覧を読めないときは、`share.drive.A` を `null` で記録する | 「読めなかった」と「共有フォルダがない」を混ぜないため。項目名に文字が必要なので、ネットワーク ドライブにまず使わない A にした。**見直す余地があります** |
| プリンターとソフトの一覧を読めないときは、`printer.0`、`software.0` を `null` で記録する | 同じ理由。一覧が空のときは何も記録しない |
| 共有フォルダは `Get-SmbMapping` と `HKCU:\Network` から読み、`Get-PSDrive` は使わない | `Get-PSDrive` は許可されていますが、接続先の機器に問い合わせて、機器が止まっていると待たされる可能性があるため。他の機器に触らない方を選んだ |
| PDF への保存などの仮想のプリンターを除き、接続先は `Win32_TCPIPPrinterPort` で IP に置き換える | 後任に必要なのは実際のプリンターと接続先のため。IP を読めなければポート名を出す |
| Windows の部品と更新プログラムをソフトの一覧から除き、同じ表示は1件にする | 件数が増えて、ID の上限に早く届くのを防ぐため |
| メモリは四捨五入、C ドライブの空きは切り捨てにする | メモリは表示に近い値にし、空きは多く見せないため |
| 接続が複数あれば、ゲートウェイの優先度がいちばん高いものを使う | 1台に1組の値という約束に合わせるため |
| ウイルス対策は、標準のものが動いていれば「Windows 標準のウイルス対策（有効）」とし、それ以外は `root/SecurityCenter2` から製品名を読む | 見本の表示に合わせるため。スクリプトに実在の製品名を書かずに済む |
| Microsoft 365 は、記録が何もなければ `false` ではなく `unavailable` にする | 記録がないだけでは、サインインしていないと言い切れないため。メールアドレスなどの値は記録しない |
| `security.feature_update` は保留がなくても「大型更新の保留の設定なし」と記録する | 「設定なし」と「読めなかった」を区別するため |
| 日付と日時は InvariantCulture で文字列にする | 和暦の設定の PC でも形を変えないため |
| 値の `BitLocker` の語をスクリプトの案内と手順書に書く | `CLAUDE.md` の製品名の一覧にはありませんが、指示の項目名と説明にあるため。**ルールとの関係を確認してください** |

### まとめるプログラム
| 判断 | 理由 |
|---|---|
| 認証情報の検査は、既存の `plugin/lib/transcript.mjs` の `hasCredential` を使う | 聞き取りと同じ基準にするため |
| 約束にない欄、項目と区分の不一致、項目ごとの型の違い（整数、真偽値、日付の形、`DHCP` か `固定`）も止める | PowerShell の型のずれを、後の段階に流さないため |
| JSON を読めないときは、解析エラーの文を出さない | 解析エラーの文には、ファイルの値の一部が含まれるため |
| 出力と生データが同じファイルなら、終了コード 2 で止める | 生データを上書きしないため |
| PC 名の重複は、大文字と小文字を区別せずに調べる | Windows の PC 名は区別しないため |

### スキルと手順書
| 判断 | 理由 |
|---|---|
| 調査はこちらから実行せず、本人に実行してもらう | 同意の確認は本人が行うものなので。スキルの権限も `node` だけ |
| 本人が中身を確かめるまで、結果のファイルを開かない | 「中身を確かめてから渡す」という約束のため |
| 実行のコマンドに `-ExecutionPolicy Bypass` を付ける | 既定の設定だと実行できない PC があるため。この実行だけの指定で、設定は変わらない。スクリプトの中には書いていない |
| まとめた結果の名前を `hikitsugi-survey-merged.json` にする | `.gitignore` の対象に入れるため |

## 実機で確かめてほしい箇所
下書きを書くときに、次のことは記憶に頼りました。特に見てください。手順は `docs/survey-test.md` にあります。

1. **`Get-BitLockerVolume` を管理者でなく実行したときの動き。** `denied` に分類できるエラーになるか。エラーにならず空の結果を返すと `unavailable` になります
2. **`netsh wlan show interfaces` の結果。** 日本語の Windows でも `SSID` の行を読めるか。Windows 11 の新しい版では位置情報の設定が必要な場合があり、その場合は Wi-Fi でも `unavailable` になります。日本語の Wi-Fi 名が崩れないかも見てください
3. **Microsoft 365 のサインインの判定。** `HKCU:\SOFTWARE\Microsoft\Office\16.0\Common\Identity` の `ADUserName`、`ConnectedAccountWamAad`、OneDrive の `Business1` の `UserEmail` を見ています。**いちばん不確かです。** サインインしているのに `false` にならないか確かめてください
4. **大型更新の保留。** 読んでいるレジストリの値（`DeferFeatureUpdates`、`TargetReleaseVersion`、`DeferFeatureUpdatesPeriodInDays`、`PauseFeatureUpdatesEndTime`）が、設定画面の操作と一致するか
5. **`security.last_update`。** `Get-HotFix` の `InstalledOn` が空でないか。Windows Update の履歴と大きくずれないか
6. **`ConvertTo-Json` の結果。** `items` が配列のままか。余計な `Count` や `value` の欄がないか。`hw.memory_gb` が数値のままか
7. **プリンターの除外。** 仮想のプリンターが残らないか。実際のプリンターが消えないか
8. **読めないときの分類。** 権限の問題が `denied` に入るか。判定の文の一部はエラーの文面に頼っています
9. **かかる時間。** プリンターの一覧の取得は、印刷サーバーの状態によって待たされる可能性があります

## 残った問題
- **合格条件を満たしていません。** 上のとおりです
- **ID の上限：** ID が3桁なので、全部で999件を超えると止まります。1台100件のソフトがあると、10台ほどで届きます。スキーマの変更が必要で、今回は変更していません
- **クラウドの参加の判定：** `dsregcmd` が使えないので、`account.join_type` はドメインかワークグループかだけです。クラウドのディレクトリに参加している PC は、ワークグループと記録されるはずです
- **決定事項：** `CLAUDE.md` は判断を `docs/design.md` に残すよう求めていますが、今回の指示では変更が禁止なので、この報告書にだけ書きました
