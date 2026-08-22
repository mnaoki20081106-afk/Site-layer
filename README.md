# Site-layer

サイト①とサイト②を重ねて表示するオーバーレイページと、両サイトのURL・重ね方を管理する管理画面を、Cloudflare Pages + Functions + KV で提供します。

## 構成

- `public/index.html` — 公開ページ。サイト①を背面に、サイト②を前面に重ねて表示します。位置・サイズ・不透明度・クリック対象は管理画面から制御できます。
- `public/admin.html` — 管理画面。サイト①・サイト②のURLと、サイト②の重ね方（位置/サイズ/不透明度/クリック対象）を設定します。
- `functions/api/config.js` — Cloudflare Pages Functions。設定の取得（GET）・更新（POST、要トークン認証）を行い、Cloudflare KV に保存します。
- `wrangler.toml` — Cloudflare Pages プロジェクトの設定（KV バインディング）。

## デプロイ手順（Cloudflare）

1. **KVネームスペースを作成**

   ```sh
   npx wrangler kv namespace create CONFIG_KV
   npx wrangler kv namespace create CONFIG_KV --preview
   ```

   出力された `id` / `preview_id` を `wrangler.toml` の該当箇所に貼り付けます。

2. **管理者トークンを設定**

   `ADMIN_TOKEN` という名前で、管理画面のPOST認証に使うシークレットを設定します（好きな長いランダム文字列）。

   ```sh
   npx wrangler pages secret put ADMIN_TOKEN --project-name site-layer
   ```

3. **デプロイ**

   ```sh
   npx wrangler pages deploy public --project-name site-layer
   ```

   （初回は Cloudflare にプロジェクトを新規作成するか聞かれます）

4. デプロイ後に発行されるURLで、以下にアクセスできます。

   - `https://<project>.pages.dev/index.html` — オーバーレイ表示ページ（公開用）
   - `https://<project>.pages.dev/admin.html` — 管理画面（URLを知っている人のみがアクセスする想定。必要であれば Cloudflare Access 等でさらにアクセス制限してください）

## 使い方

1. `admin.html` を開き、上部の「管理者トークン」欄に手順2で設定した `ADMIN_TOKEN` を入力します。
2. サイト①・サイト②のURLを入力します。
3. サイト②をどの位置・サイズで重ねるか（%指定）、不透明度、クリック操作をどちらのサイトに渡すかを設定します。
4. 「保存」を押すと即座に `index.html` に反映されます。

## 注意事項

- サイト①・サイト②側が `X-Frame-Options` や `Content-Security-Policy: frame-ancestors` で iframe 埋め込みを禁止している場合、そのサイトは重ね表示できません（相手サイトの設定に依存します）。
- 管理画面 (`admin.html`) はURLを知っていれば誰でも開けます。保存操作自体は `ADMIN_TOKEN` がないと失敗しますが、公開したくない場合は Cloudflare Access などでページ自体へのアクセスも制限することを推奨します。
