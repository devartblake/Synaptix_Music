import assert from "node:assert/strict";
import test from "node:test";

import { productRegistrationId, refreshPlatformSession } from "./platform-refresh.ts";

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

test("a renewal sends the refresh token with the studio's service token and rotates both tokens", async () => {
  const access = jwt({ exp: 2_000_000_000 });
  const { impl, calls } = fakeFetch(
    Response.json({ accessToken: access, refreshToken: "refresh-2", expiresIn: 480, user: { handle: "composer", email: "c@example.com" } })
  );

  const outcome = await refreshPlatformSession({ ...base, fetchImpl: impl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://platform.test/api/v1/auth/refresh");
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

test("the studio signs in as the General product unless configured otherwise", () => {
  // The platform refuses sign-in without a recognized product registration.
  assert.equal(productRegistrationId({}), "synaptix-play-general");
  assert.equal(productRegistrationId({ SYNAPTIX_PLATFORM_PRODUCT_REGISTRATION_ID: " studio-reg " }), "studio-reg");
});
