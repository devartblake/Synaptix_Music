import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { GRANT_HEADER, LOCKED, audioGrant } from "./grant.ts";

// Publication rules v1, decision L4: AI audio is locked server-side. The studio's server forwards a
// platform-signed grant, so an account the platform hasn't unlocked can't reach the audio service
// by calling the studio's routes directly.

const signedIn = { headers: new Headers({ authorization: "Bearer player" }), cookies: { get: () => undefined } };
const signedOut = { headers: new Headers(), cookies: { get: () => undefined } };
const realFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];

function platformAnswers(response: () => Response) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return response();
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.SYNAPTIX_PLATFORM_API_URL = "https://platform.test/";
  delete process.env.SYNAPTIX_AUDIO_LOCK;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("an entitled caller gets the platform's grant, asked for with their own session", async () => {
  platformAnswers(() => Response.json({ token: "v1.grant", expiresAt: "2026-10-19T00:05:00Z" }));
  assert.deepEqual(await audioGrant(signedIn), { headers: { [GRANT_HEADER]: "v1.grant" } });
  assert.equal(calls[0]!.url, "https://platform.test/api/v1/music/ai-audio/grants");
  assert.equal((calls[0]!.init!.headers as Record<string, string>).authorization, "Bearer player");
});

test("signed-out callers and accounts the platform refuses are locked out", async () => {
  platformAnswers(() => Response.json({ code: "AiAudioNotEntitled" }, { status: 403 }));
  assert.deepEqual(await audioGrant(signedIn), { status: 403, body: LOCKED });
  calls = [];
  assert.deepEqual(await audioGrant(signedOut), { status: 403, body: LOCKED });
  assert.equal(calls.length, 0, "a signed-out caller shouldn't even ask the platform");
});

test("a platform that can't answer keeps audio locked rather than opening it", async () => {
  platformAnswers(() => new Response("oops", { status: 500 }));
  assert.equal((await audioGrant(signedIn) as { status: number }).status, 502);
  platformAnswers(() => Response.json({}));
  assert.equal((await audioGrant(signedIn) as { status: number }).status, 502);
  delete process.env.SYNAPTIX_PLATFORM_API_URL;
  assert.equal((await audioGrant(signedIn) as { status: number }).status, 403);
});

test("SYNAPTIX_AUDIO_LOCK=off sends no grant, for local demos", async () => {
  process.env.SYNAPTIX_AUDIO_LOCK = "off";
  platformAnswers(() => new Response(null, { status: 500 }));
  assert.deepEqual(await audioGrant(signedOut), { headers: {} });
  assert.equal(calls.length, 0);
});
