# Site-layer

サイト①とサイト②を重ねて表示するオーバーレイページと、両サイトのURL・重ね方を管理する管理画面を、Cloudflare Workers（Static Assets）+ KV で提供します。

## 構成

- `public/index.html` — 公開ページ。サイト①を背面に、サイト②を前面に重ねて表示します。位置・サイズ・不透明度・クリック対象は管理画面から制御できます。
- `public/admin.html` — 管理画面。サイト①・サイト②のURLと、サイト②の重ね方（位置/サイズ/不透明度/クリック対象）を設定します。
- `src/index.js` — Cloudflare Worker本体。`/api/config` の GET（設定取得）・POST（設定更新、要トークン認証）を処理し、Cloudflare KV に保存します。`/` と `/index.html` はサイト①のOGPタイトル・画像を取得して埋め込んだ上で返します。それ以外のパスは `public/` 配下の静的ファイルをそのまま返します（Workers Static Assets）。
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

1. `admin.html` を開き、上部の「管理者トークン」欄に手順3で設定した `ADMIN_TOKEN` を入力します。
2. サイト①・サイト②のURLを入力します。
3. サイト②をどの位置・サイズで重ねるか（%指定）、不透明度、クリック操作をどちらのサイトに渡すかを設定します。
4. 「保存」を押すと即座に `index.html` に反映されます。

## OGP（SNSでシェアしたときの見た目）

`/`・`/index.html` へのアクセス時、Workerがサイト①のページを取得して `og:title` / `og:image`（無ければ `twitter:title` / `twitter:image`）を読み取り、このサイト自身のタイトル・OGP画像として埋め込みます。管理画面でサイト①のURLを変更すると、そのタイミングのタイムスタンプを画像URLに付与（`?_v=...`）するので、LINEやX（Twitter）などがOGP画像を古いまま(キャッシュ)表示し続けることを防げます。サイト①側が `og:title` / `og:image` を持たない場合は、このサイトのデフォルトのタイトルのみが使われます。

## 注意事項

- サイト①・サイト②側が `X-Frame-Options` や `Content-Security-Policy: frame-ancestors` で iframe 埋め込みを禁止している場合、そのサイトは重ね表示できません（相手サイトの設定に依存します）。
- 管理画面 (`admin.html`) はURLを知っていれば誰でも開けます。保存操作自体は `ADMIN_TOKEN` がないと失敗しますが、公開したくない場合は Cloudflare Access などでページ自体へのアクセスも制限することを推奨します。

## トラブルシューティング

- ビルドログに `Executing user deploy command: npx wrangler deploy` と表示され `Could not detect a directory containing static files` で失敗する場合、プロジェクトが Pages ではなく Workers Builds として作成されています。その場合は `wrangler.toml` を Pages用（`pages_build_output_dir`）ではなく、Workers Static Assets用（`main` + `[assets]`）の形式にする必要があります（このリポジトリは対応済み）。
- KV バインディングや `ADMIN_TOKEN` を後から追加した場合、「Retry deployment」は使えません（`Cannot retry a build that was created with a seed_repo override` エラーになります）。設定変更後は、`main` ブランチに新しいコミットを push して新規デプロイ（Trigger: Push）を発生させてください。
