import assert from "node:assert/strict";
import test from "node:test";

import { HttpWatermarker, watermarkerFor, watermarkerFromEnv, type AudioWatermarker } from "./watermark-client.ts";

test("audio is sent to the platform's watermark endpoint with the worker's service token", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const watermarker = new HttpWatermarker({
    baseUrl: "http://platform:5000/",
    serviceToken: "worker-token",
    fetch: (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(new Uint8Array([9, 9]), { headers: { "content-type": "audio/wav" } });
    }) as typeof fetch
  });
  const marked = await watermarker.markWav(Buffer.from([1, 2, 3]));
  assert.deepEqual([...marked], [9, 9]);
  assert.equal(seen!.url, "http://platform:5000/internal/music/watermark");
  assert.equal((seen!.init.headers as Record<string, string>)["X-Service-Token"], "worker-token");
});

test("a refusal from the platform is an error, not unmarked audio", async () => {
  const watermarker = new HttpWatermarker({
    baseUrl: "http://platform:5000",
    serviceToken: "worker-token",
    fetch: (async () => new Response("not configured", { status: 503 })) as typeof fetch
  });
  await assert.rejects(watermarker.markWav(Buffer.from([1])), /Watermarking failed with 503: not configured/);
});

test("rendering for the platform watermarks unless RENDER_WATERMARK=off", () => {
  const platform = { SYNAPTIX_PLATFORM_API_URL: "http://platform:5000", RENDER_WORKER_SERVICE_TOKEN: "t" };
  assert.ok(watermarkerFromEnv(platform) instanceof HttpWatermarker);
  assert.equal(watermarkerFromEnv({ ...platform, RENDER_WATERMARK: "off" }), null);
  // Local renders without the platform have nothing to send to.
  assert.equal(watermarkerFromEnv({}), null);
});

test("only music with AI involvement is marked; hand-composed music isn't", () => {
  const watermarker: AudioWatermarker = { markWav: async (wav) => wav };
  const generated = { generationMetadata: { generatorId: "synaptix-claude-composer" } };
  assert.equal(watermarkerFor(generated, watermarker), watermarker);
  // Edited music keeps its generation metadata, so it is marked too.
  assert.equal(watermarkerFor({}, watermarker), null);
});
