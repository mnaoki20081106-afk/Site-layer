// Cloudflare Worker (Static Assets + API) entrypoint.
//
// Static files under public/ (index.html, admin.html) are served automatically
// by the Workers Assets binding. Requests to /api/config are handled here.

const CONFIG_KEY = "site-config";
const DEFAULT_OVERLAY = { top: 0, left: 0, width: 100, height: 100, opacity: 1, pointerEvents: "auto" };
const DEFAULT_CONFIG = { site1Url: "", site2Url: "", overlay: DEFAULT_OVERLAY };

function json(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init && init.headers) },
  });
}

function isValidUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeOverlay(overlay) {
  const o = overlay && typeof overlay === "object" ? overlay : {};
  return {
    top: clampNumber(o.top, 0, 100, DEFAULT_OVERLAY.top),
    left: clampNumber(o.left, 0, 100, DEFAULT_OVERLAY.left),
    width: clampNumber(o.width, 1, 100, DEFAULT_OVERLAY.width),
    height: clampNumber(o.height, 1, 100, DEFAULT_OVERLAY.height),
    opacity: clampNumber(o.opacity, 0, 1, DEFAULT_OVERLAY.opacity),
    pointerEvents: o.pointerEvents === "none" ? "none" : "auto",
  };
}

async function handleGet(env) {
  const raw = await env.CONFIG_KV.get(CONFIG_KEY);
  const config = raw ? JSON.parse(raw) : DEFAULT_CONFIG;
  return json(config);
}

async function handlePost(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const { site1Url, site2Url, overlay } = body || {};
  if (!isValidUrl(site1Url) || !isValidUrl(site2Url)) {
    return json({ error: "invalid_url" }, { status: 400 });
  }

  const config = { site1Url, site2Url, overlay: sanitizeOverlay(overlay) };
  await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(config));
  return json(config);
}

async function serveAdminPage(request, env) {
  const assetResponse = await env.ASSETS.fetch(request);
  if (!env.ADMIN_TOKEN || !assetResponse.ok) return assetResponse;

  const html = await assetResponse.text();
  const injected = html.replace(
    "<head>",
    `<head>\n<script>window.__ADMIN_TOKEN__ = ${JSON.stringify(env.ADMIN_TOKEN)};</script>`
  );
  return new Response(injected, assetResponse);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      if (request.method === "GET") return handleGet(env);
      if (request.method === "POST") return handlePost(request, env);
      return json({ error: "method_not_allowed" }, { status: 405 });
    }

    if (url.pathname === "/admin.html") {
      return serveAdminPage(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
