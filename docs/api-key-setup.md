# API キーの置き場所と確認手順

live アダプターを実装する前に、上から順に行います。キーの作成と貼り付けは本人が行い、チャットには貼りません。

## 1. キーを作る前の確認
```bash
node scripts/check-secrets.mjs   # 「問題なし」と出ること
git check-ignore -v .env         # .gitignore の行が表示されること
```

## 2. Console 側の設定
1. Console の個人組織で API キーを作ります。名前は `hikitsugi-eval` など、用途が分かるものにします
2. 使用額の上限を設定します（目安は配布クレジットの $500 以内）
3. キーはこの時点では画面にしか出ません。次の手順で保存します

## 3. キーを保存する
```bash
cp .env.example .env
chmod 600 .env
open -e .env   # エディタで ANTHROPIC_API_KEY= の後ろに貼り付けて保存
```
**コマンドの引数に直接キーを書かないでください**（シェルの履歴に残ります）。

## 4. 保存後の確認
```bash
git status --short               # .env が表示されないこと
git check-ignore -v .env         # 無視されていること
node scripts/check-secrets.mjs   # 「問題なし」と出ること
node --env-file=.env -e "console.log(process.env.ANTHROPIC_API_KEY?.length > 0 ? '読み込み成功' : '読み込み失敗')"
```
最後のコマンドは、値を表示せずに読み込めたかだけを確かめます。

## 5. 使い方
Node.js の標準機能で読み込むので、`dotenv` などのライブラリは使いません。
```bash
node --env-file=.env eval/run.mjs --set okojo --target verifier --adapter live
```

## 気をつけること
- **Max プランの枠とクレジットは別物です。** シェルに `ANTHROPIC_API_KEY` を設定すると、Claude Code が API の課金に切り替わることがあります。`export` せず、評価の実行時だけ `--env-file` で渡します
- **画面録画に映さないでください。** デモの撮影中に `.env` を開かないようにします
- **漏れたかもしれないときは、** すぐ Console でキーを無効にして作り直します。git の履歴から消すだけでは足りません
