// Cloudflare Worker (Static Assets + API) entrypoint.
//
// / and /index.html proxy site1Url as this page's own top-level document
// (with site2 injected as an overlay iframe) - see serveOverlayPage below.
// /admin.html is served from public/ with the ADMIN_TOKEN injected.
// Requests to /api/config are handled here. Everything else falls through
// to the public/ static assets.

const CONFIG_KEY = "site-config";
const DEFAULT_OVERLAY = {
  top: 0, left: 0, width: 100, height: 100, opacity: 1, pointerEvents: "auto",
  // When refSelector is set, site2 tracks that element inside site1's DOM
  // pixel-for-pixel instead of using the top/left/width/height % rect above.
  refSelector: "",
  nativeHeight: 48,
};
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
    refSelector: typeof o.refSelector === "string" ? o.refSelector.trim().slice(0, 300) : "",
    nativeHeight: clampNumber(o.nativeHeight, 1, 4000, DEFAULT_OVERLAY.nativeHeight),
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

  const raw = await env.CONFIG_KV.get(CONFIG_KEY);
  const previous = raw ? JSON.parse(raw) : DEFAULT_CONFIG;
  const site1UpdatedAt = previous.site1Url === site1Url ? previous.site1UpdatedAt || Date.now() : Date.now();
  const site2UpdatedAt = previous.site2Url === site2Url ? previous.site2UpdatedAt || Date.now() : Date.now();

  const config = { site1Url, site2Url, overlay: sanitizeOverlay(overlay), site1UpdatedAt, site2UpdatedAt };
  await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(config));
  return json(config);
}

// Dynamic pages (admin.html, index.html) must never be cached at Cloudflare's
// edge or in the browser: they're rewritten per-request from live KV config
// and remote OGP data, so a cached copy would keep showing stale content.
function noStore(response) {
  const copy = new Response(response.body, response);
  copy.headers.set("Cache-Control", "no-store");
  return copy;
}

async function serveAdminPage(request, env) {
  const assetResponse = await env.ASSETS.fetch(request);
  if (!env.ADMIN_TOKEN || !assetResponse.ok) return noStore(assetResponse);

  const html = await assetResponse.text();
  const injected = html.replace(
    "<head>",
    `<head>\n<script>window.__ADMIN_TOKEN__ = ${JSON.stringify(env.ADMIN_TOKEN)};</script>`
  );
  return noStore(new Response(injected, assetResponse));
}

// Embeds a value into an inline <script> as JSON, escaping "<" so the
// browser can never see it as closing the surrounding <script> tag.
function scriptSafeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtmlAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Builds the <head> fragment (base tag + OGP tags sourced from site2) and
// <body> fragment (site2 overlay iframe + positioning script) injected into
// site1's own proxied page. Injecting fresh OGP tags - rather than only
// rewriting site1's existing ones - guarantees they're present even when
// site1's page declares none of its own, and wins over any of site1's own
// og:*/<title> tags appearing later in <head> (browsers/crawlers use the
// first one).
function buildInjection(config, site1FinalUrl, ogpTitle, ogpImage) {
  const overlay = config.overlay || DEFAULT_OVERLAY;
  const ogpTags = [
    `<base href="${escapeHtmlAttr(site1FinalUrl)}">`,
    ogpTitle ? `<title>${escapeHtmlAttr(ogpTitle)}</title>` : "",
    ogpTitle ? `<meta property="og:title" content="${escapeHtmlAttr(ogpTitle)}">` : "",
    ogpTitle ? `<meta name="twitter:title" content="${escapeHtmlAttr(ogpTitle)}">` : "",
    ogpImage ? `<meta property="og:image" content="${escapeHtmlAttr(ogpImage)}">` : "",
    ogpImage ? `<meta name="twitter:image" content="${escapeHtmlAttr(ogpImage)}">` : "",
  ].join("\n");
  const headFragment = ogpTags;
  const bodyFragment = `
<div id="ov-site2-wrap" style="position:fixed;overflow:hidden;z-index:2147483000;"></div>
<script>
(function () {
  var wrap = document.getElementById("ov-site2-wrap");
  var o = ${scriptSafeJson(overlay)};
  var site2Url = ${scriptSafeJson(config.site2Url)};

  var iframe = document.createElement("iframe");
  iframe.id = "ov-site2-iframe";
  iframe.src = site2Url;
  iframe.title = "site2";
  iframe.scrolling = "no";
  iframe.style.border = "none";
  iframe.style.display = "block";

  if (o.refSelector) {
    // Pixel-perfect tracking mode: site2 is scaled/positioned to exactly
    // cover a specific element inside site1's own page, and follows it on
    // resize/scroll (same technique as a manually hand-placed overlay).
    var refEl = document.querySelector(o.refSelector);
    if (!refEl) {
      console.warn("[site-layer] refSelector matched no element:", o.refSelector);
      return;
    }
    refEl.style.position = "relative";
    refEl.style.zIndex = "1500";

    wrap.style.pointerEvents = "auto";
    iframe.style.position = "absolute";
    iframe.style.top = "0";
    iframe.style.left = "0";
    iframe.style.transformOrigin = "top left";
    wrap.appendChild(iframe);

    function sync() {
      var rect = refEl.getBoundingClientRect();
      wrap.style.top = rect.top + "px";
      wrap.style.left = rect.left + "px";
      wrap.style.width = rect.width + "px";
      wrap.style.height = rect.height + "px";

      var scale = rect.height / o.nativeHeight;
      iframe.style.width = (rect.width / scale) + "px";
      iframe.style.height = o.nativeHeight + "px";
      iframe.style.transform = "scale(" + scale + ")";
    }

    new ResizeObserver(sync).observe(refEl);
    window.addEventListener("load", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, { passive: true, capture: true });
    sync();
  } else {
    // Percentage-of-viewport mode.
    wrap.style.top = o.top + "%";
    wrap.style.left = o.left + "%";
    wrap.style.width = o.width + "%";
    wrap.style.height = o.height + "%";
    wrap.style.opacity = String(o.opacity);
    wrap.style.pointerEvents = o.pointerEvents === "none" ? "none" : "auto";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    wrap.appendChild(iframe);
  }
})();
</script>`;
  return { headFragment, bodyFragment };
}

// Headers that make our server-side fetch look like the visitor's real
// browser instead of Cloudflare's generic Workers fetch client. Sites
// (especially ones behind bot-management like Akamai) can serve different -
// sometimes broken - responses, cookies, or redirects to a request that
// doesn't look like a real browser, which can surface later as odd
// behavior once the browser itself navigates onward.
function browserLikeHeaders(request) {
  const headers = new Headers();
  const forward = ["user-agent", "accept-language", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"];
  for (const name of forward) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8");
  return headers;
}

// Fetches url and pulls its OGP title/image via HTMLRewriter, without ever
// forwarding that page's body to the client.
async function extractOgp(url, requestHeaders) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal, headers: requestHeaders });
    clearTimeout(timeout);
    if (!res.ok) return null;

    let title = null;
    let image = null;
    const rewriter = new HTMLRewriter()
      .on('meta[property="og:title"]', {
        element(el) {
          title = el.getAttribute("content") || title;
        },
      })
      .on('meta[name="twitter:title"]', {
        element(el) {
          if (!title) title = el.getAttribute("content");
        },
      })
      .on('meta[property="og:image"]', {
        element(el) {
          image = el.getAttribute("content") || image;
        },
      })
      .on('meta[name="twitter:image"]', {
        element(el) {
          if (!image) image = el.getAttribute("content");
        },
      });

    await rewriter.transform(res).arrayBuffer();

    if (image) {
      try {
        image = new URL(image, url).toString();
      } catch {
        image = null;
      }
    }

    return title || image ? { title, image } : null;
  } catch {
    return null;
  }
}

// Proxies site1Url as this page's own top-level document (instead of an
// iframe) so that links inside it - including app deep links / universal
// links (e.g. opening the YouTube app) - navigate the real top-level
// browsing context and actually work. site2 is then injected as a small
// overlay iframe on top, positioned per the admin-configured rect.
async function serveOverlayPage(request, env) {
  const raw = await env.CONFIG_KV.get(CONFIG_KEY);
  const config = raw ? JSON.parse(raw) : DEFAULT_CONFIG;

  if (!config.site1Url || !config.site2Url) {
    return noStore(await env.ASSETS.fetch(request));
  }

  const headers = browserLikeHeaders(request);

  let site1Res;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    site1Res = await fetch(config.site1Url, { signal: controller.signal, redirect: "follow", headers });
    clearTimeout(timeout);
  } catch {
    site1Res = null;
  }

  if (!site1Res || !site1Res.ok) {
    return noStore(await env.ASSETS.fetch(request));
  }

  const contentType = site1Res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return noStore(new Response(site1Res.body, { status: site1Res.status, headers: { "content-type": contentType } }));
  }

  // OGP title/image come from site2 (the front/overlay site), not site1.
  const ogp2 = await extractOgp(config.site2Url, headers);
  const imageBust = String(config.site2UpdatedAt || Date.now());
  let ogpImage = ogp2 && ogp2.image;
  if (ogpImage) {
    try {
      const abs = new URL(ogpImage);
      abs.searchParams.set("_v", imageBust);
      ogpImage = abs.toString();
    } catch {}
  }
  const ogpTitle = ogp2 && ogp2.title;

  const { headFragment, bodyFragment } = buildInjection(config, site1Res.url, ogpTitle, ogpImage);

  const rewritten = new HTMLRewriter()
    .on("head", {
      element(el) {
        el.prepend(headFragment, { html: true });
      },
    })
    .on("body", {
      element(el) {
        el.append(bodyFragment, { html: true });
      },
    })
    .on("title", {
      element(el) {
        if (ogpTitle) el.setInnerContent(ogpTitle);
      },
    })
    .on('meta[property="og:title"], meta[name="twitter:title"]', {
      element(el) {
        if (ogpTitle) el.setAttribute("content", ogpTitle);
      },
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute("content", request.url);
      },
    })
    .on('meta[property="og:image"], meta[name="twitter:image"]', {
      element(el) {
        if (ogpImage) el.setAttribute("content", ogpImage);
      },
    })
    .transform(site1Res);

  return noStore(
    new Response(rewritten.body, {
      status: rewritten.status,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      if (request.method === "GET") return handleGet(env);
      if (request.method === "POST") return handlePost(request, env);
      return json({ error: "method_not_allowed" }, { status: 405 });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return serveOverlayPage(request, env);
    }

    if (url.pathname === "/admin.html") {
      return serveAdminPage(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
