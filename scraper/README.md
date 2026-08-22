# scraper

サイト①（自組織運営）のボット検知を、Puppeteer Stealthで回避しながらスクレイピングするための、独立したNode.jsスクリプトです。Cloudflare Worker本体（`src/index.js`）とは別プロセスで動作します（Workers Edgeランタイム上ではフルのHeadless Chromeを動かせないため）。

## セットアップ

```
cd scraper
npm install
cp .env.example .env
```

`.env` に `SITE1_URL`（対象URLを直接指定）または `CONFIG_API_URL`（このプロジェクトの `/api/config` を指定し、管理画面で設定中の `site1Url` を自動で使う）のどちらかを設定してください。

## 実行

```
node scrape.js                              # .env の設定を使用
node scrape.js --url https://example.com    # URLを直接指定
node scrape.js --selector ".article"        # 指定セレクタの要素だけ抽出
node scrape.js --out result.json            # 結果をファイルに保存
node scrape.js --screenshot shot.png        # スクリーンショットも保存
node scrape.js --no-headless                # ブラウザを表示して実行（デバッグ用）
```

## 注意

- あくまで自組織が運営するサイト①向けの想定です。第三者が運営するサイトに対してボット検知回避目的で使用しないでください（利用規約違反・不正アクセスに該当する可能性があります）。
- サイト①側の負荷にならないよう、定期実行する場合はリクエスト間隔を空ける・並列数を絞るなど配慮してください。
