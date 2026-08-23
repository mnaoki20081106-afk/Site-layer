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

## デプロイ方法（Google Cloud Run・東京リージョン、iPad/ブラウザのみでOK）

サイト①が日本国内向けの場合、米国リージョンのホスティングだと通信が遅くなるだけでなく、「海外IPからのアクセス」自体をボット対策が怪しむ可能性があります。そのため、東京リージョン（`asia-northeast1`）を選べる **Google Cloud Run** を使います。Dockerfileを含めているので、コンテナビルド・デプロイ・環境変数設定まで、すべてブラウザのWebコンソールだけで完結します。

1. [console.cloud.google.com](https://console.cloud.google.com) にアクセスし、Googleアカウントでログイン。プロジェクトを未作成なら新規作成
2. 検索バーで **Cloud Run** を開き、**サービスを作成**（Create Service）
3. **「リポジトリから継続的にデプロイする」**（Continuously deploy from a repository）を選択 → **CLOUD BUILDの設定** → GitHubと連携し、このリポジトリ（`Site-layer`）を選択
4. ビルド設定
   - ブランチ: `main`（PRマージ後のブランチ）
   - ビルドタイプ: **Dockerfile**
   - **ビルドコンテキストディレクトリ / ソースの場所**: `/render-service`（このサブフォルダだけをビルド対象にする）
5. サービスの設定
   - **リージョン**: `asia-northeast1（東京）`
   - **認証**: 「未認証の呼び出しを許可」を選択（アクセス制御は`RENDER_TOKEN`で自前チェックするため）
   - **コンテナ、ネットワーキング、セキュリティ** を開き、
     - **メモリ**: 最低 1 GiB（できれば2 GiB。Chromiumがそれなりにメモリを使います）
     - **最小インスタンス数**: 0のままだと初回アクセス時にブラウザ起動の待ちが発生します（数秒）。常時1つ起動させたい場合は1に設定（ただし課金が発生し続けます）
   - **変数とシークレット**（Variables & Secrets）タブで環境変数を追加
     - `RENDER_TOKEN` = 好きな長いランダム文字列（Worker側にも同じ値を設定するのでメモしてください）
6. **作成**（Create）を押してデプロイ。完了後、サービス詳細画面の上部に表示されるURL（例: `https://render-service-xxxxx-an.a.run.app`）を控える
7. 動作確認（ブラウザでそのURル + `/healthz` を開く）: `https://render-service-xxxxx-an.a.run.app/healthz` → `{"ok":true}` が返ればOK

## Worker側の設定

発行された公開URLとトークンを、Cloudflare Worker側の環境変数として設定します（Cloudflareダッシュボード → 対象Worker → **Settings** → **Variables and Secrets**）。

- `RENDER_SERVICE_URL` = `https://render-service-xxxxx-an.a.run.app/render`（Variable、末尾 `/render` まで含める）
- `RENDER_SERVICE_TOKEN` = 手順5で設定したのと同じ値（Secret）

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
