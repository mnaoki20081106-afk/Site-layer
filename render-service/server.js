// HTTP service that loads a URL through Puppeteer + stealth plugin and
// returns the resulting HTML. The Cloudflare Worker in this project calls
// this instead of fetching site1 directly, since Cloudflare Workers can't
// run a real browser and site1's bot detection blocks a plain fetch().
//
// GET /render?url=<site1Url>
//   Authorization: Bearer <RENDER_TOKEN>
//   -> { ok, status, finalUrl, contentType, html }

import express from "express";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const PORT = process.env.PORT || 3000;
const RENDER_TOKEN = process.env.RENDER_TOKEN || "";
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS) || 20000;

const app = express();

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    browserPromise.catch(() => {
      browserPromise = null;
    });
  }
  return browserPromise;
}

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.get("/render", async (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!RENDER_TOKEN || token !== RENDER_TOKEN) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const targetUrl = req.query.url;
  if (typeof targetUrl !== "string" || !/^https?:\/\//.test(targetUrl)) {
    return res.status(400).json({ ok: false, error: "invalid_url" });
  }

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });

    const response = await page.goto(targetUrl, {
      waitUntil: "networkidle2",
      timeout: NAV_TIMEOUT_MS,
    });

    const html = await page.content();
    res.json({
      ok: true,
      status: response ? response.status() : 200,
      finalUrl: page.url(),
      contentType: (response && response.headers()["content-type"]) || "text/html; charset=utf-8",
      html,
    });
  } catch (err) {
    // A crashed/disconnected browser should be relaunched on the next request.
    if (browserPromise) {
      try {
        const browser = await browserPromise;
        if (!browser.isConnected()) browserPromise = null;
      } catch {
        browserPromise = null;
      }
    }
    res.status(502).json({ ok: false, error: "render_failed", message: err.message });
  } finally {
    if (page) await page.close().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`render-service listening on :${PORT}`);
});
