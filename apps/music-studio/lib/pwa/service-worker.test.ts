import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const ORIGIN = "https://music.example";
const SOURCE = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

type Listener = (event: Record<string, unknown>) => void;

/** A tiny Cache Storage stand-in keyed by URL string. */
class FakeCache {
  readonly entries = new Map<string, Response>();
  async match(key: string | { url: string }) {
    const url = typeof key === "string" ? key : key.url;
    return this.entries.get(url)?.clone();
  }
  async put(key: string | { url: string }, response: Response) {
    this.entries.set(typeof key === "string" ? key : key.url, response);
  }
  async keys() { return [...this.entries.keys()].map((url) => ({ url })); }
  async delete(key: { url: string }) { return this.entries.delete(key.url); }
}

function basic(body: string, init: ResponseInit = {}): Response {
  const response = new Response(body, { status: 200, ...init });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

function worker(network: Record<string, string> = {}) {
  const stores = new Map<string, FakeCache>();
  const listeners = new Map<string, Listener>();
  const requested: string[] = [];
  let online = true;
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new FakeCache());
      return stores.get(name)!;
    },
    async keys() { return [...stores.keys()]; },
    async delete(name: string) { return stores.delete(name); }
  };
  const fetch = async (input: string | { url: string }) => {
    const url = typeof input === "string" ? input : input.url;
    requested.push(url);
    if (!online) throw new TypeError("Failed to fetch");
    const path = new URL(url).pathname;
    return path in network ? basic(network[path]!) : new Response("missing", { status: 404 });
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener)
  };
  const context = vm.createContext({ self, caches, fetch, URL, Response, Set, Promise, console });
  vm.runInContext(SOURCE, context);

  async function dispatch(type: string, data: Record<string, unknown> = {}) {
    let pending: Promise<unknown> = Promise.resolve();
    let responded: Promise<Response> | undefined;
    listeners.get(type)!({
      ...data,
      waitUntil: (promise: Promise<unknown>) => { pending = promise; },
      respondWith: (promise: Promise<Response>) => { responded = promise; }
    });
    await pending;
    return responded;
  }

  return {
    stores, requested, context,
    setOnline(value: boolean) { online = value; },
    install: () => dispatch("install"),
    activate: () => dispatch("activate"),
    message: (data: unknown) => dispatch("message", { data }),
    fetchEvent: (url: string, init: { method?: string; mode?: string } = {}) =>
      dispatch("fetch", { request: { url, method: init.method ?? "GET", mode: init.mode ?? "cors" } }),
    settle: () => new Promise((resolve) => setTimeout(resolve, 10))
  };
}

const shell = (title: string) =>
  `<html><head><link rel="stylesheet" href="/_next/static/css/app.css"></head><body>${title}<script src="/_next/static/chunks/app.js"></script></body></html>`;

test("routing leaves APIs, other origins, and non-GET requests alone", () => {
  const { context } = worker();
  const route = (url: string, method = "GET", mode = "cors") =>
    vm.runInContext(`routeFor(${JSON.stringify({ url, method, mode })}, ${JSON.stringify(ORIGIN)})`, context);
  assert.equal(route(`${ORIGIN}/library`, "GET", "navigate"), "page");
  assert.equal(route(`${ORIGIN}/_next/static/chunks/app.js`), "static");
  assert.equal(route(`${ORIGIN}/api/platform/render-jobs`), null);
  assert.equal(route(`${ORIGIN}/api/platform/render-jobs`, "GET", "navigate"), null);
  assert.equal(route(`${ORIGIN}/library`, "POST", "navigate"), null);
  assert.equal(route("https://cdn.example/_next/static/x.js"), null);
  assert.equal(route(`${ORIGIN}/library?x=1`), null, "non-navigation page fetches (RSC) go to the network");
});

test("install saves the home page, Library and offline page with their assets", async () => {
  const sw = worker({
    "/": shell("home"), "/library": shell("library"), "/offline.html": "offline",
    "/_next/static/css/app.css": "css", "/_next/static/chunks/app.js": "js"
  });
  await sw.install();
  assert.deepEqual([...sw.stores.get("synaptix-pages-v1")!.entries.keys()].sort(),
    [`${ORIGIN}/`, `${ORIGIN}/library`, `${ORIGIN}/offline.html`]);
  assert.deepEqual([...sw.stores.get("synaptix-static-v1")!.entries.keys()].sort(),
    [`${ORIGIN}/_next/static/chunks/app.js`, `${ORIGIN}/_next/static/css/app.css`]);
});

test("pages are network-first, saved for offline, and fall back to the offline page", async () => {
  const sw = worker({ "/offline.html": "offline", "/library/song-1": shell("song"), "/about": "about" });
  await sw.install();

  const online = await sw.fetchEvent(`${ORIGIN}/library/song-1?rename=1`, { mode: "navigate" });
  assert.match(await online!.text(), /song/);
  await sw.fetchEvent(`${ORIGIN}/about`, { mode: "navigate" });
  await sw.settle();

  sw.setOnline(false);
  const saved = await sw.fetchEvent(`${ORIGIN}/library/song-1`, { mode: "navigate" });
  assert.match(await saved!.text(), /song/, "the saved copy is found without the query string");
  const fallback = await sw.fetchEvent(`${ORIGIN}/library/never-opened`, { mode: "navigate" });
  assert.equal(await fallback!.text(), "offline");
  const notSaved = await sw.fetchEvent(`${ORIGIN}/about`, { mode: "navigate" });
  assert.equal(await notSaved!.text(), "offline", "pages outside the app shell are not stored");
});

test("hashed static files are served from cache once seen", async () => {
  const sw = worker({ "/_next/static/chunks/page.js": "page-js" });
  assert.equal(await (await sw.fetchEvent(`${ORIGIN}/_next/static/chunks/page.js`))!.text(), "page-js");
  sw.setOnline(false);
  const before = sw.requested.length;
  assert.equal(await (await sw.fetchEvent(`${ORIGIN}/_next/static/chunks/page.js`))!.text(), "page-js");
  assert.equal(sw.requested.length, before, "no network request for a cached asset");
});

test("activation removes older Synaptix caches only", async () => {
  const sw = worker();
  for (const name of ["synaptix-pages-v0", "synaptix-pages-v1", "synaptix-static-v1", "other-app"]) sw.stores.set(name, new FakeCache());
  await sw.activate();
  assert.deepEqual([...sw.stores.keys()].sort(), ["other-app", "synaptix-pages-v1", "synaptix-static-v1"]);
});

test("warming caches only same-origin static assets", async () => {
  const sw = worker({ "/_next/static/chunks/a.js": "a" });
  await sw.message({ type: "warm-static", urls: [`${ORIGIN}/_next/static/chunks/a.js`, "https://evil.example/_next/static/x.js", `${ORIGIN}/api/secret`, 42] });
  assert.deepEqual([...sw.stores.get("synaptix-static-v1")!.entries.keys()], [`${ORIGIN}/_next/static/chunks/a.js`]);
});
