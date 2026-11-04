# 調査スクリプトを実機で試す手順

`plugin/scripts/survey.ps1` は、Windows のない環境で作りました。本人の実機（Windows 11 Pro、1台）で動きを確かめ、日本語の表示、同意しないときに何も集めないこと、同意したときの実行（約10秒）、まとめまで通りました。今の版の実行と `share.drive_count` も 11/4 に本人が確かめました。**Wi-Fi の接続名とネットワーク ドライブの読み取りは、確かめていません（Wi-Fi の実機確認は行わない判断です）。** 複数台のまとめは、実機の結果の複製で確かめました（`docs/journey.md`）。 この手順で確かめます。

**実機の結果のファイルは、リポジトリに入れないでください。** `.gitignore` で `hikitsugi-survey-*` を無視していますが、別の名前に変えると無視されません。結果のファイルには、PC 名、接続先、インストール済みのソフトが入ります。

## 準備
- 管理者ではない、ふだんのアカウントでサインインします。権限がないときの動きを確かめるためです
- `survey.ps1` を、デスクトップなど書き込めるフォルダに置きます。結果は、実行したときに開いているフォルダに保存されます

## 1. 同意しないと何も集めない
1. スタートメニューで「powershell」を検索して開きます（Windows PowerShell の方です）
2. `survey.ps1` を置いたフォルダへ移動します
   ```powershell
   cd $HOME\Desktop
   ```
3. 実行します。`-ExecutionPolicy Bypass` はこの実行だけの指定で、PC の設定は変わりません
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\survey.ps1
   ```
4. 次を確かめます
   - [ ] 集める内容と集めない内容が、文字化けせずに日本語で出る
   - [ ] 管理者権限を求める画面が出ない
5. `n` を入力して Enter を押します
   - [ ] 「何も集めていません」と出て終わる
   - [ ] `hikitsugi-survey-` で始まるファイルができていない

## 2. 同意すると、1つのファイルに保存する
1. もう一度実行し、同意の確認に `y` と入力します
2. 次を確かめます
   - [ ] 赤い文字のエラーが出ず、最後まで進む
   - [ ] かかった時間（目安は1分以内。長ければ、どこで止まったかを教えてください）
   - [ ] `hikitsugi-survey-<PC 名>-<日付>.json` ができている
   - [ ] 中身を確かめてから渡すよう案内が出る

## 3. 中身を確かめる
結果のファイルをメモ帳で開き、設定画面の表示と見比べます。

| 項目 | 確かめること |
|---|---|
| `host`、`collected_at` | PC 名が合っている。日時が `2026-11-04T17:10:00+09:00` の形（日本時間なら `+09:00`） |
| `os.caption`、`os.version` | `Windows 11 Pro` の形（先頭に Microsoft が付かない）。バージョンが数字と点の形 |
| `hw.maker`、`hw.model` | PC の表示と同じ |
| `hw.memory_gb`、`disk.c_free_gb` | 引用符のない整数。設定画面の値に近い |
| `net.ip_mode` | `DHCP` か `固定` |
| `net.gateway`、`net.dns` | ネットワークの設定画面の値と同じ。使っている接続の値になっている（VPN があるときは特に） |
| `net.wifi_ssid` | Wi-Fi のときは接続中の名前で、日本語の名前も崩れない。有線だけなら `null` で `unavailable`。Wi-Fi なのに `unavailable` なら、位置情報の設定が原因かもしれないので教えてください |
| `share.drive_count` | ネットワーク ドライブの数の整数。ないときは `0`。読めなければ `null` で `denied` か `unavailable` |
| `share.drive.<文字>` | ネットワーク ドライブが全部ある。接続先が `\\` で始まる |
| `printer.<番号>` | ふだん使うプリンターがある。PDF への保存のような仮想のものが入っていない。接続先が分かる形か（番号ではなく長い記号の列になっていないか） |
| `software.<番号>` | 主なソフトがある。更新プログラムが大量に混ざっていない |
| `security.last_update` | `yyyy-MM-dd` の形。Windows Update の履歴と大きくずれていない |
| `security.feature_update` | 大型更新の保留の設定と合っている |
| `security.antivirus` | 動いているウイルス対策と合っている |
| `security.bitlocker` | 管理者でないアカウントなら `null` で `denied` になるはず。別の結果なら、その内容を教えてください |
| `account.join_type` | `ドメイン`、`ワークグループ`、`クラウド参加`、`ドメインとクラウド参加` のどれかで、PC の状態と合っている。設定の「職場または学校にアクセスする」で確かめられます |
| `account.m365_signed_in` | サインインの状態と合っている。引用符のない `true` か `false`。読めなければ `null` で `unavailable` |

次も確かめます。

- [ ] パスワード、メールアドレス、ユーザーフォルダの一覧が入っていない
- [ ] `items` が配列（`[` で始まる）で、余計な `Count` や `value` の欄がない
- [ ] `status` が `ok` なのに値が空の項目がない

## 4. PC に変化がないこと
- [ ] 結果のファイルのほかに、新しいファイルができていない
- [ ] `Get-ExecutionPolicy -List` の表示が実行の前後で変わっていない

## 5. まとめるプログラムに通す
リポジトリのフォルダで、結果のファイルのパスを指定して実行します。Windows でも Mac でも動きます。出力の名前を `hikitsugi-survey-` で始めると、コミットされません。
```bash
node plugin/scripts/merge-survey.mjs hikitsugi-survey-merged.json test-company <結果.json>
```
- [ ] 「まとめました」と出て、終了コードが 0 になる
- [ ] 問題が出たら、表示された文を教えてください（値は表示されません）

次の起動の確認は、作業用のフォルダで行います。`hikitsugi-work/` ができます。
```bash
node plugin/scripts/hikitsugi.mjs init hikitsugi-survey-merged.json 田中 テスト会社
```
- [ ] 「準備ができました」と出る

終わったら、`hikitsugi-work/` と結果のファイルを消します。

## 6. 結果の伝え方
次を教えてください。**結果のファイルそのものや、接続先などの値は貼らないでください。**

- 手順のチェックが付かなかった項目と、そのときの表示
- `denied` と `unavailable` になった項目の名前
- 実行にかかった時間
