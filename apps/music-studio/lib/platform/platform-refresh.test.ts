import assert from "node:assert/strict";
import test from "node:test";

import { refreshPlatformSession, studioServiceToken } from "./platform-refresh.ts";

function jwt(payload: object): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(payload)}.signature`;
}

function fakeFetch(response: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  return { impl, calls };
}

const base = { baseUrl: "https://platform.test", serviceToken: "studio-token", refreshToken: "refresh-1" };

test("a renewal goes to the studio route with the studio's service token and rotates both tokens", async () => {
  const access = jwt({ exp: 2_000_000_000 });
  const { impl, calls } = fakeFetch(
    Response.json({ accessToken: access, refreshToken: "refresh-2", expiresIn: 480, user: { handle: "composer", email: "c@example.com" } })
  );

  const outcome = await refreshPlatformSession({ ...base, fetchImpl: impl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://platform.test/api/v1/auth/studio/refresh");
  assert.equal(new Headers(calls[0]!.init.headers).get("x-service-token"), "studio-token");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { refreshToken: "refresh-1" });
  assert.deepEqual(outcome, {
    kind: "refreshed",
    session: { accessToken: access, refreshToken: "refresh-2", expiresAt: 2_000_000_000, profile: { handle: "composer", email: "c@example.com" } }
  });
});

test("a refused refresh token signs the studio out; other failures keep the current session", async () => {
  assert.deepEqual(await refreshPlatformSession({ ...base, fetchImpl: fakeFetch(new Response(null, { status: 401 })).impl }), {
    kind: "signed-out"
  });
  for (const response of [new Response(null, { status: 500 }), Response.json({ accessToken: "x" }), new Error("offline")]) {
    const outcome = await refreshPlatformSession({ ...base, fetchImpl: fakeFetch(response).impl });
    assert.equal(outcome.kind, "unavailable");
  }
});

test("without the platform URL or the service token nothing is sent", async () => {
  for (const options of [{ ...base, baseUrl: null }, { ...base, serviceToken: null }]) {
    const { impl, calls } = fakeFetch(Response.json({}));
    const outcome = await refreshPlatformSession({ ...options, fetchImpl: impl });
    assert.equal(outcome.kind, "unavailable");
    assert.equal(calls.length, 0, "the refresh token must not leave the server unauthenticated");
  }
});

test("a refused studio token or studio sign-in turned off never signs the player out", async () => {
  // These are configuration problems on the studio or the platform, not the player's session.
  for (const response of [
    Response.json({ error: { code: "service_authentication_required" } }, { status: 401 }),
    Response.json({ error: { code: "studio_auth_unavailable" } }, { status: 503 })
  ]) {
    const outcome = await refreshPlatformSession({ ...base, fetchImpl: fakeFetch(response).impl });
    assert.equal(outcome.kind, "unavailable");
  }
});

test("the service token comes from SYNAPTIX_PLATFORM_SERVICE_TOKEN; blank means none", () => {
  assert.equal(studioServiceToken({ SYNAPTIX_PLATFORM_SERVICE_TOKEN: " t " }), "t");
  assert.equal(studioServiceToken({ SYNAPTIX_PLATFORM_SERVICE_TOKEN: " " }), null);
  assert.equal(studioServiceToken({}), null);
});
