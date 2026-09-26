import assert from "node:assert/strict";
import test from "node:test";

import {
  isTokenCurrent,
  PLATFORM_PROFILE_COOKIE,
  PLATFORM_SESSION_COOKIE,
  platformAuthorization,
  sessionCookieOptions,
  sessionProfile,
  tokenExpiresAt
} from "./platform-session.ts";

function jwt(payload: object): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(payload)}.signature`;
}

function request(headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    cookies: { get: (name: string) => (name in cookies ? { value: cookies[name]! } : undefined) }
  };
}

const now = Math.floor(Date.now() / 1000);

test("token expiry is read from the exp claim; damaged tokens have none", () => {
  assert.equal(tokenExpiresAt(jwt({ exp: 1234 })), 1234);
  assert.equal(tokenExpiresAt("not-a-jwt"), null);
  assert.equal(tokenExpiresAt("a.%%%.c"), null);
  assert.equal(isTokenCurrent(jwt({ exp: now + 600 })), true);
  assert.equal(isTokenCurrent(jwt({ exp: now + 5 })), false, "about to expire counts as expired");
  assert.equal(isTokenCurrent(jwt({})), false);
});

test("the session cookie becomes a bearer header; an explicit header wins", () => {
  const token = jwt({ exp: now + 600 });
  assert.equal(platformAuthorization(request({}, { [PLATFORM_SESSION_COOKIE]: token })), `Bearer ${token}`);
  assert.equal(
    platformAuthorization(request({ authorization: "Bearer service" }, { [PLATFORM_SESSION_COOKIE]: token })),
    "Bearer service"
  );
});

test("expired or missing sessions send no credentials, and other cookies never count", () => {
  assert.equal(platformAuthorization(request({}, { [PLATFORM_SESSION_COOKIE]: jwt({ exp: now - 1 }) })), null);
  assert.equal(platformAuthorization(request({ cookie: "other=1" }, { other: "1" })), null);
});

test("profiles are read defensively", () => {
  const profile = { handle: "composer", email: "c@example.com" };
  assert.deepEqual(sessionProfile(request({}, { [PLATFORM_PROFILE_COOKIE]: JSON.stringify(profile) })), profile);
  assert.equal(sessionProfile(request({}, { [PLATFORM_PROFILE_COOKIE]: "{broken" })), null);
  assert.equal(sessionProfile(request({}, { [PLATFORM_PROFILE_COOKIE]: "{}" })), null);
});

test("session cookies are HttpOnly and Secure behind HTTPS", () => {
  const secure = sessionCookieOptions(request({ "x-forwarded-proto": "https", host: "studio.example.com" }), 480);
  assert.equal(secure.httpOnly, true);
  assert.equal(secure.secure, true);
  assert.equal(secure.sameSite, "lax");
  assert.equal(secure.maxAge, 480);
  assert.equal(sessionCookieOptions(request({ "x-forwarded-proto": "http", host: "localhost:3000" }), 480).secure, false);
});
