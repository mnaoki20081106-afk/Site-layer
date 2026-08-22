# render-service

Cloudflare Workerはエッジ環境で動くため、実際のブラウザ（Chromium）を起動できません。そのため、サイト①へのアクセスをPuppeteer Stealthで行うには、**別のホストで常駐するHTTPサービス**が必要です。これがこの `render-service` です。

Workerは、サイト①を直接 `fetch()` する代わりに、この `render-service` の `/render?url=<サイト①のURL>` を呼び出し、Puppeteer Stealthで取得済みのHTMLを受け取ります。

## API

```
GET /render?url=<エンコード済みURL>
Authorization: Bearer <RENDER_TOKEN>
```

レスポンス:
```json
{ "ok": true, "status": 200, "finalUrl": "https://...", "contentType": "text/html; charset=utf-8", "html": "..." }
```

## デプロイ方法（Railway・iPad/ブラウザのみでOK）

Dockerfileを含めているので、Dockerデプロイに対応するホスティングであればどこでも使えます。ここではRailwayを例にします。

1. [railway.app](https://railway.app) にアクセスし、GitHubアカウントでログイン
2. **New Project** → **Deploy from GitHub repo** → このリポジトリ（`Site-layer`）を選択
3. 作成されたサービスの **Settings** を開き、以下を設定
   - **Root Directory**: `render-service`
   - （Dockerfileが自動検出されればBuilderの指定は不要）
4. **Variables** タブで環境変数を追加
   - `RENDER_TOKEN` = 好きな長いランダム文字列（Worker側にも同じ値を設定します。メモしてください）
5. デプロイ完了後、**Settings** → **Networking** → **Generate Domain** で公開URLを発行（例: `https://xxxx.up.railway.app`）
6. 動作確認（ブラウザで開く）: `https://xxxx.up.railway.app/healthz` → `{"ok":true}` が返ればOK

## Worker側の設定

発行された公開URLとトークンを、Cloudflare Worker側の環境変数として設定します（Cloudflareダッシュボード → 対象Worker → **Settings** → **Variables and Secrets**）。

- `RENDER_SERVICE_URL` = `https://xxxx.up.railway.app/render`（Variable、末尾 `/render` まで含める）
- `RENDER_SERVICE_TOKEN` = 手順4で設定したのと同じ値（Secret）

設定後、`main` に新しいコミットをpushして再デプロイしてください（Cloudflare Workersの仕様上、既存デプロイには反映されないため）。

この2つが未設定の場合、Workerは従来通りサイト①を直接 `fetch()` します（後方互換のフォールバック）。

## ローカルでの動作確認

```
cd render-service
npm install
RENDER_TOKEN=test node server.js
```

別ターミナルで:
```
curl -H "Authorization: Bearer test" "http://localhost:3000/render?url=https://example.com"
```

## 注意

- あくまで自組織が運営するサイト①向けです。第三者サイトに対してボット検知回避目的で使用しないでください。
- `RENDER_TOKEN` は第三者に知られると誰でもこのサービスを踏み台にできてしまうため、他の秘密情報と同様に管理してください。
- ブラウザを起動する分、直接 `fetch()` するより応答が遅くなります（数秒程度）。オーバーレイページのCache-Control: no-storeと合わせて、アクセスのたびにレンダリングが発生する点に留意してください。
