# Site-layer

サイト①とサイト②を重ねて表示するオーバーレイページと、両サイトのURL・重ね方を管理する管理画面を、Cloudflare Workers（Static Assets）+ KV で提供します。

## 構成

- `public/index.html` — 公開ページ。サイト①を背面に、サイト②を前面に重ねて表示します。位置・サイズ・不透明度・クリック対象は管理画面から制御できます。
- `public/admin.html` — 管理画面。サイト①・サイト②のURLと、サイト②の重ね方（位置/サイズ/不透明度/クリック対象）を設定します。
- `src/index.js` — Cloudflare Worker本体。`/api/config` の GET（設定取得）・POST（設定更新、要トークン認証）を処理し、Cloudflare KV に保存します。それ以外のパスは `public/` 配下の静的ファイルをそのまま返します（Workers Static Assets）。
- `wrangler.toml` — Worker名、エントリポイント（`src/index.js`）、静的アセットのディレクトリ（`public`）、KVバインディングを設定。

## デプロイ手順（Cloudflareダッシュボード、ブラウザのみでOK）

このプロジェクトは Cloudflare の「Workers Builds」（GitHub連携で自動デプロイされるWorkers）を前提にしています。すでにダッシュボードでリポジトリを接続済みなら、mainブランチへのpush（このPRのマージなど）で自動的に再デプロイされます。

1. **KVネームスペースを作成**

   ダッシュボード「Workers & Pages」→ 上部タブ「KV」→「Create a namespace」→ 名前を `CONFIG_KV` として作成し、表示された namespace ID を控えます。

   `wrangler.toml` の `id = "REPLACE_WITH_KV_NAMESPACE_ID"` をそのIDに書き換えてコミットしてください（`preview_id` も同じIDで構いません）。

2. **KVをWorkerにバインド**

   対象のWorkerプロジェクトを開く →「Settings」→「Bindings」→「Add binding」→ KV namespace を選択
   - Variable name: `CONFIG_KV`
   - KV namespace: 手順1で作成したもの

3. **管理者トークンを設定**

   同じく「Settings」→「Variables and Secrets」→「Add」
   - Variable name: `ADMIN_TOKEN`
   - Value: 好きな長いランダム文字列（後で管理画面のログインに使うので必ずメモ）
   - Type: Secret（暗号化）

4. **再デプロイ**

   バインディングやシークレットの追加後は、mainブランチに新しいコミットをpushして新規デプロイを発生させてください（Cloudflareの「Retry deployment」は最初の接続時ビルドには使えないため）。

5. デプロイ後に発行されるURL（例: `https://site-layer.<subdomain>.workers.dev`、または独自ドメイン設定時はそのドメイン）で、以下にアクセスできます。

   - `/index.html` — オーバーレイ表示ページ（公開用）
   - `/admin.html` — 管理画面（URLを知っている人のみがアクセスする想定。必要であれば Cloudflare Access 等でさらにアクセス制限してください）

## 使い方

1. `admin.html` を開きます。`ADMIN_TOKEN` を環境変数として設定済みの場合、Workerがページ表示時に自動でトークンを埋め込むため、トークン入力欄は表示されず入力不要です（未設定の場合は入力欄が表示され、手入力したトークンはそのブラウザに記憶されます）。
2. サイト①・サイト②のURLを入力します。
3. サイト②をどの位置・サイズで重ねるか（%指定）、不透明度、クリック操作をどちらのサイトに渡すかを設定します。
4. 「保存」を押すと即座に `index.html` に反映されます。

## 注意事項

- サイト①・サイト②側が `X-Frame-Options` や `Content-Security-Policy: frame-ancestors` で iframe 埋め込みを禁止している場合、そのサイトは重ね表示できません（相手サイトの設定に依存します）。
- 管理画面 (`admin.html`) はURLを知っていれば誰でも開けます。`ADMIN_TOKEN` をページに自動埋め込みする設定にすると、`admin.html` のソースを見れば誰でもトークンを読み取れる状態になり、実質「URLを知っている人なら誰でも設定変更できる」状態になります。自分専用・URLを他人に教えない前提での利用を想定した割り切りです。第三者に公開したくない場合は、Cloudflare Access などでページ自体へのアクセスも制限することを推奨します。

## トラブルシューティング

- ビルドログに `Executing user deploy command: npx wrangler deploy` と表示され `Could not detect a directory containing static files` で失敗する場合、プロジェクトが Pages ではなく Workers Builds として作成されています。その場合は `wrangler.toml` を Pages用（`pages_build_output_dir`）ではなく、Workers Static Assets用（`main` + `[assets]`）の形式にする必要があります（このリポジトリは対応済み）。
- KV バインディングや `ADMIN_TOKEN` を後から追加した場合、「Retry deployment」は使えません（`Cannot retry a build that was created with a seed_repo override` エラーになります）。設定変更後は、`main` ブランチに新しいコミットを push して新規デプロイ（Trigger: Push）を発生させてください。
