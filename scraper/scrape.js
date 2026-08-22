// Scrapes site1 (the backend site configured in this project's admin panel)
// using puppeteer-extra + the stealth plugin, since site1's own bot
// detection blocks a plain headless Chrome from loading the page at all.
//
// Usage:
//   SITE1_URL=https://example.com node scrape.js
//   node scrape.js --url https://example.com --selector ".article" --out out.json
//
// If SITE1_URL / --url is omitted, the target URL is read from this
// project's own /api/config endpoint (CONFIG_API_URL), i.e. whatever
// site1Url is currently set in the admin panel.

import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

function parseArgs(argv) {
  const args = { headless: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") args.url = argv[++i];
    else if (a === "--selector") args.selector = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--screenshot") args.screenshot = argv[++i];
    else if (a === "--no-headless") args.headless = false;
    else if (a === "--timeout") args.timeout = Number(argv[++i]);
  }
  return args;
}

async function resolveTargetUrl(cliUrl) {
  if (cliUrl) return cliUrl;
  if (process.env.SITE1_URL) return process.env.SITE1_URL;

  const configApiUrl = process.env.CONFIG_API_URL;
  if (!configApiUrl) {
    throw new Error(
      "No target URL given. Set SITE1_URL, pass --url, or set CONFIG_API_URL to read site1Url from the admin config API."
    );
  }
  const res = await fetch(configApiUrl);
  if (!res.ok) throw new Error(`Failed to fetch config from ${configApiUrl}: ${res.status}`);
  const config = await res.json();
  if (!config.site1Url) throw new Error(`${configApiUrl} has no site1Url set`);
  return config.site1Url;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetUrl = await resolveTargetUrl(args.url);
  const timeout = args.timeout || 30000;

  const browser = await puppeteer.launch({
    headless: args.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });

    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout });

    const result = {
      url: targetUrl,
      scrapedAt: new Date().toISOString(),
      title: await page.title(),
    };

    if (args.selector) {
      result.matches = await page.$$eval(args.selector, (els) =>
        els.map((el) => ({ text: el.textContent.trim(), html: el.innerHTML }))
      );
    } else {
      result.html = await page.content();
    }

    if (args.screenshot) {
      await fs.mkdir(path.dirname(args.screenshot) || ".", { recursive: true });
      await page.screenshot({ path: args.screenshot, fullPage: true });
      result.screenshot = args.screenshot;
    }

    const output = JSON.stringify(result, null, 2);
    if (args.out) {
      await fs.mkdir(path.dirname(args.out) || ".", { recursive: true });
      await fs.writeFile(args.out, output, "utf-8");
      console.log(`Saved: ${args.out}`);
    } else {
      console.log(output);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
