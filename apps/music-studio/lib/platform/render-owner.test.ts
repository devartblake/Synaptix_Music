import assert from "node:assert/strict";
import test from "node:test";

import { createRenderOwnerResolver } from "./render-owner.ts";

function resolver(respond: (authorization: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  let clock = 0;
  const resolve = createRenderOwnerResolver({
    platformBaseUrl: () => "https://platform.example",
    now: () => clock,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push(String(url));
      return respond(new Headers(init.headers).get("authorization")!);
    }) as typeof fetch
  });
  return { resolve, calls, advance: (ms: number) => { clock += ms; } };
}

test("the owner is the platform's answer for the token, cached briefly", async () => {
  const { resolve, calls, advance } = resolver((authorization) =>
    Response.json({ id: authorization === "Bearer a" ? "player-a" : "player-b" }));
  assert.deepEqual(await resolve("Bearer a", "c"), { status: "ok", owner: "player-a" });
  assert.deepEqual(await resolve("Bearer b", "c"), { status: "ok", owner: "player-b" });
  await resolve("Bearer a", "c");
  assert.deepEqual(calls, ["https://platform.example/api/v1/users/me", "https://platform.example/api/v1/users/me"]);
  advance(61_000);
  await resolve("Bearer a", "c");
  assert.equal(calls.length, 3);
});

test("rejected tokens are unauthenticated; platform trouble is unavailable and never cached", async () => {
  assert.deepEqual(await resolver(() => new Response(null, { status: 401 })).resolve("Bearer x", "c"), { status: "unauthenticated" });
  assert.equal((await resolver(() => new Response(null, { status: 500 })).resolve("Bearer x", "c")).status, "unavailable");
  assert.equal((await resolver(() => Response.json({ handle: "no id" })).resolve("Bearer x", "c")).status, "unavailable");
  assert.equal((await resolver(() => { throw new Error("offline"); }).resolve("Bearer x", "c")).status, "unavailable");

  let fail = true;
  const flaky = resolver(() => fail ? new Response(null, { status: 503 }) : Response.json({ id: "player-a" }));
  await flaky.resolve("Bearer a", "c");
  fail = false;
  assert.deepEqual(await flaky.resolve("Bearer a", "c"), { status: "ok", owner: "player-a" });
});
