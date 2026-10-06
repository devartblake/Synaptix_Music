/*
 * Synaptix Music offline shell (service worker).
 *
 * Your projects, cover art and downloaded mixes already live in IndexedDB. This worker makes
 * the app itself open without a network:
 *   - page navigations: network first, saved copy when offline, else /offline.html;
 *   - /_next/static/* (content-hashed, immutable): cache first;
 *   - /api/* and anything cross-origin or non-GET: never cached or touched.
 * Plain JavaScript with no imports, so it can also be evaluated by unit tests.
 */

const PAGE_CACHE = "synaptix-pages-v1";
const STATIC_CACHE = "synaptix-static-v1";
const KNOWN_CACHES = [PAGE_CACHE, STATIC_CACHE];
const OFFLINE_URL = "/offline.html";
/** Opened once on install so the Library works offline even before it is visited. */
const PRECACHE_PAGES = ["/", "/library", OFFLINE_URL];
const MAX_STATIC_ENTRIES = 400;
const MAX_PAGE_ENTRIES = 60;
const CACHEABLE_PAGE_PREFIXES = ["/library", "/studio/"];

/** Which strategy handles a request, or null to leave it to the network untouched. */
function routeFor(request, origin) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.origin !== origin) return null;
  if (url.pathname.startsWith("/api/")) return null;
  if (url.pathname.startsWith("/_next/static/")) return "static";
  if (request.mode === "navigate") return "page";
  if (url.pathname === OFFLINE_URL || url.pathname === "/manifest.webmanifest" || url.pathname === "/icon.svg") return "static";
  return null;
}

/** Saved pages are keyed without the query string so `?rename=1` etc. still find them. */
function pageKey(url) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

function isCacheablePage(url) {
  const { pathname } = new URL(url);
  return pathname === "/" || CACHEABLE_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isStorable(response) {
  return Boolean(response) && response.ok && response.type === "basic" && !response.redirected;
}

/** Same-origin hashed asset URLs referenced by an HTML page. */
function staticAssetsIn(html, origin) {
  const urls = new Set();
  const pattern = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) urls.add(`${origin}${match[1]}`);
  return [...urls];
}

async function trim(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - maxEntries))) await cache.delete(key);
}

async function cacheStatic(urls) {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(urls.map(async (url) => {
    if (await cache.match(url)) return;
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (isStorable(response)) await cache.put(url, response);
    } catch {
      // Best effort: a missing asset is fetched again on next use.
    }
  }));
}

async function savePage(url, response) {
  const cache = await caches.open(PAGE_CACHE);
  await cache.put(pageKey(url), response.clone());
  const html = await response.clone().text();
  await cacheStatic(staticAssetsIn(html, new URL(url).origin));
  await trim(PAGE_CACHE, MAX_PAGE_ENTRIES);
}

async function handlePage(request) {
  try {
    const response = await fetch(request);
    if (isStorable(response) && isCacheablePage(request.url)) {
      // Keep the page and the scripts/styles it needs; never block the response on it.
      savePage(request.url, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cache = await caches.open(PAGE_CACHE);
    const saved = await cache.match(pageKey(request.url));
    if (saved) return saved;
    const offline = await cache.match(pageKey(new URL(OFFLINE_URL, request.url).href));
    if (offline) return offline;
    throw error;
  }
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isStorable(response)) {
      await cache.put(request.url, response.clone());
      trim(STATIC_CACHE, MAX_STATIC_ENTRIES).catch(() => {});
    }
    return response;
  } catch (error) {
    // e.g. /offline.html is kept with the saved pages.
    const pageCopy = await (await caches.open(PAGE_CACHE)).match(pageKey(request.url));
    if (pageCopy) return pageCopy;
    throw error;
  }
}

async function precache() {
  const origin = self.location.origin;
  await Promise.all(PRECACHE_PAGES.map(async (path) => {
    const url = `${origin}${path}`;
    try {
      const response = await fetch(url, { cache: "reload", credentials: "same-origin" });
      if (isStorable(response)) await savePage(url, response);
    } catch {
      // Installing offline: pages are saved on the next online visit instead.
    }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("synaptix-") && !KNOWN_CACHES.includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const route = routeFor(event.request, self.location.origin);
  if (route === "page") event.respondWith(handlePage(event.request));
  else if (route === "static") event.respondWith(handleStatic(event.request));
});

/* Assets the page loaded before this worker controlled it (sent by the registration code). */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "warm-static" && Array.isArray(event.data.urls)) {
    const origin = self.location.origin;
    const urls = event.data.urls.filter((url) => typeof url === "string" && url.startsWith(`${origin}/_next/static/`));
    event.waitUntil(cacheStatic(urls));
  }
});
