import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";

function wav(seconds = 2, rate = 8000): Buffer {
  const samples = seconds * rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buffer;
}

/** A small solid-color PNG (wider than tall, so the cover must be cropped). */
function png(width = 160, height = 96): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from([230, 90, 140]))]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

test("projects can be renamed and given cover art, and downloaded renders play offline", async ({ page, context }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const projectId = `media-${test.info().project.name}`;
  const audio = wav();
  const checksum = createHash("sha256").update(audio).digest("hex");
  const renderId = "11111111-1111-4111-8111-111111111111";
  const artifactId = "22222222-2222-4222-8222-222222222222";
  const jobId = "33333333-3333-4333-8333-333333333333";
  const now = "2026-09-26T12:00:00.000Z";
  let contentRequests = 0;

  await page.route("**/api/platform/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/platform/render-jobs") {
      return route.fulfill({ json: { jobs: [{
        contractVersion: "1.0.0", jobId, idempotencyKey: "k", status: "completed", attempt: 1, maxAttempts: 3,
        submittedAt: now, updatedAt: now, leaseOwnerId: null, leaseExpiresAt: null, nextAttemptAt: null, lastError: null,
        manifest: { contractVersion: "1.0.0", renderId, projectId, revisionId: "r1", projectChecksumSha256: "a".repeat(64),
          engineVersion: "1.0.0", seed: 0, scope: { kind: "master" }, range: { startTick: 0, endTick: 3840 },
          output: { format: "wav", sampleRate: 44100, bitDepth: 16, normalizePeakDbfs: null, includeTailSeconds: 0 }, requestedAt: now },
        result: { contractVersion: "1.0.0", renderId, status: "completed", warnings: [], errorCode: null, errorMessage: null, completedAt: now,
          artifacts: [{ artifactId, renderId, trackId: null, fileName: "offline-mix.wav", mediaType: "audio/wav",
            byteLength: audio.length, checksumSha256: checksum, durationSeconds: 2 }] }
      }] } });
    }
    if (url.pathname.endsWith("/content")) {
      contentRequests += 1;
      return route.fulfill({ status: 200, body: audio, headers: { "content-type": "audio/wav" } });
    }
    return route.fulfill({ status: 503, json: { code: "offline", message: "Platform unavailable" } });
  });

  // Seed and rename in the studio.
  await page.goto(`/studio/${projectId}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project", { timeout: 60000 });
  await page.getByRole("button", { name: /^Rename project/ }).click();
  const nameInput = page.getByLabel("Project name");
  await nameInput.fill("Night Drive");
  await nameInput.press("Enter");
  await expect(page.getByRole("heading", { name: "Night Drive" })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Synaptix Generated Arrangement/ })).toBeVisible();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Night Drive" })).toBeVisible();
  await page.waitForTimeout(1200);

  // Library shows the new name; rename again via the Library shortcut.
  await page.goto(`/library/${projectId}`);
  await expect(page.getByRole("heading", { name: "Night Drive", level: 1 })).toBeVisible({ timeout: 20000 });
  await page.getByRole("link", { name: "Rename" }).click();
  const reopened = page.getByLabel("Project name");
  await expect(reopened).toBeFocused({ timeout: 60000 });
  await reopened.fill("Night Drive (Extended)");
  await reopened.press("Enter");
  await expect(page.getByRole("heading", { name: "Night Drive (Extended)" })).toBeVisible();
  await page.waitForTimeout(1200);

  // Cover art.
  await page.goto(`/library/${projectId}`);
  await page.locator('input[type="file"]').setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png() });
  await expect(page.getByText("Cover updated.")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("img", { name: "Night Drive (Extended) artwork" })).toHaveJSProperty("tagName", "IMG");
  const size = await page.getByRole("img", { name: "Night Drive (Extended) artwork" }).evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([96, 96]);
  await expect(page.getByRole("button", { name: "Remove cover" })).toBeVisible();

  // Download the render, then go offline and play it.
  await page.getByRole("button", { name: "Download for offline" }).click();
  await expect(page.getByText(/Downloaded · \d+ KB/)).toBeVisible({ timeout: 20000 });

  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "Downloaded" })).toBeVisible({ timeout: 20000 });
  await context.setOffline(true);
  await page.getByRole("button", { name: /Play Night Drive \(Extended\) \(downloaded\)/ }).click();
  const mini = page.getByRole("region", { name: "Mini player" });
  await expect(mini.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1200);
  await mini.getByRole("button", { name: /^Open Now Playing/ }).click();
  await expect(page.getByRole("dialog", { name: "Now playing" }).getByRole("slider", { name: "Playback position" }))
    .not.toHaveValue("0", { timeout: 10000 });
  expect(contentRequests).toBe(1);
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
