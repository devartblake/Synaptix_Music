import { expect, test, type Page } from "@playwright/test";

import { LAYOUTS, openWorkspace, titled, type StudioLayout } from "./layouts";

/** A valid 0.1 s silent 16-bit mono WAV. */
function silentWav(): Buffer {
  const samples = 3200;
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(32000, 24); header.writeUInt32LE(64000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const JOB = "0123456789abcdef0123456789abcdef";

function job(status: string, extra: Record<string, unknown> = {}) {
  return { jobId: JOB, status, progress: 0, position: null, durationSeconds: 10, seed: 1, error: null, version: 1, ...extra };
}

const COMPLETED = job("completed", {
  progress: 1, version: 9, result: { model: "facebook/musicgen-small", audioSeconds: 10, generationSeconds: 12.4 }
});

function sse(...events: unknown[]): string {
  return events.map((event) => `event: status\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

interface Mocks {
  /** The live event stream's body, or null to make it fail (the panel then polls). */
  events: string | null;
  /** Status poll responses, in order; the last one repeats. */
  polls: unknown[];
}

async function openGenerate(page: Page, enabled: boolean, mocks: Mocks = { events: null, polls: [COMPLETED] }, layout: StudioLayout = "classic") {
  await page.route("**/api/platform/**", (route) => route.fulfill({ status: 503, json: { message: "Platform unavailable" } }));
  const posts: unknown[] = [];
  const deletes: string[] = [];
  let attempt = 0;
  await page.route("**/api/audio-prototype", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: enabled ? { enabled: true, reachable: true, model: "facebook/musicgen-small", loaded: false, jobs: true } : { enabled: false } });
    }
    posts.push(route.request().postDataJSON());
    attempt += 1;
    if (attempt === 1) return route.fulfill({ status: 502, json: { message: "The prototype audio service couldn't be reached. Start it with COMPOSE_PROFILES=local-ai." } });
    return route.fulfill({ status: 202, json: job("queued", { position: 2 }) });
  });
  await page.route(`**/api/audio-prototype/jobs/${JOB}/events`, (route) =>
    mocks.events === null
      ? route.fulfill({ status: 502, json: { message: "unreachable" } })
      : route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: mocks.events }));
  let poll = 0;
  await page.route(`**/api/audio-prototype/jobs/${JOB}`, (route) => {
    if (route.request().method() === "DELETE") {
      deletes.push(JOB);
      return route.fulfill({ json: job("cancelled", { version: 3 }) });
    }
    const body = mocks.polls[Math.min(poll, mocks.polls.length - 1)];
    poll += 1;
    return route.fulfill({ json: body });
  });
  await page.route(`**/api/audio-prototype/jobs/${JOB}/audio`, (route) => route.fulfill({
    status: 200,
    body: silentWav(),
    headers: {
      "content-type": "audio/wav",
      "x-synaptix-model": "facebook/musicgen-small",
      "x-synaptix-license": "CC-BY-NC-4.0",
      "x-synaptix-usage": "prototype-only",
      "x-synaptix-duration-seconds": "10.00",
      "x-synaptix-generation-seconds": "12.4",
      "x-synaptix-seed": "1"
    }
  }));
  await page.goto(`/studio/prototype-${Date.now()}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await openWorkspace(page, layout, "generation");
  return { posts, deletes };
}

// Generation runs in both layouts until step 9; the DAW layout opens it as the Generate drawer.
for (const layout of LAYOUTS) {
test(titled("prototype audio stays hidden unless the service is configured", layout), async ({ page }) => {
  await openGenerate(page, false, undefined, layout);
  await expect(page.getByRole("region", { name: "AI generation workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prototype audio" })).toHaveCount(0);
});

test(titled("prototype audio is labelled non-commercial, follows live progress, and plays the clip", layout), async ({ page }) => {
  const { posts } = await openGenerate(page, true, {
    events: sse(job("queued", { position: 2 }), job("generating", { progress: 0.4, version: 4 }), COMPLETED),
    polls: [COMPLETED]
  }, layout);
  const panel = page.getByRole("region", { name: "Prototype audio" });
  await expect(panel.getByText("Non-commercial · prototype only")).toBeVisible();
  await expect(panel.getByLabel("Prompt")).toHaveValue(/video game music, \d+ BPM, D minor/);

  await panel.getByRole("button", { name: "Generate prototype audio" }).click();
  await expect(panel.getByRole("alert")).toHaveText(/couldn't be reached/);

  await panel.getByRole("button", { name: "Generate prototype audio" }).click();
  await expect(panel.getByLabel("Prototype audio clip")).toBeVisible();
  await expect(panel.getByRole("link", { name: "Download WAV" })).toHaveAttribute("download", "prototype-audio-seed-1.wav");
  await expect(panel.getByText(/10\.00 s from facebook\/musicgen-small in 12\.4 s/)).toBeVisible();
  await expect(panel.getByRole("progressbar")).toHaveCount(0);
  expect(posts.at(-1)).toMatchObject({ durationSeconds: 10, seed: 1 });
});

test(titled("without live updates the panel polls, shows progress, and can cancel a queued clip", layout), async ({ page }) => {
  const { deletes } = await openGenerate(page, true, {
    events: null,
    polls: [job("queued", { position: 2, version: 2 })]
  }, layout);
  const panel = page.getByRole("region", { name: "Prototype audio" });
  await panel.getByRole("button", { name: "Generate prototype audio" }).click(); // service unreachable
  await panel.getByRole("button", { name: "Generate prototype audio" }).click();
  await expect(panel.getByRole("status").filter({ hasText: "Queued: 2 clips ahead." })).toBeVisible();
  await expect(panel.getByRole("progressbar", { name: "Prototype audio progress" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Generating…" })).toBeDisabled();
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByText("Cancelled.")).toBeVisible();
  expect(deletes).toEqual([JOB]);
  await expect(panel.getByRole("button", { name: "Generate prototype audio" })).toBeEnabled();
});

test(titled("polling reports generation progress until the clip is ready", layout), async ({ page }) => {
  await openGenerate(page, true, {
    events: null,
    polls: [job("generating", { progress: 0.4, version: 4 }), job("generating", { progress: 0.4, version: 4 }), COMPLETED]
  }, layout);
  const panel = page.getByRole("region", { name: "Prototype audio" });
  await panel.getByRole("button", { name: "Generate prototype audio" }).click();
  await panel.getByRole("button", { name: "Generate prototype audio" }).click();
  await expect(panel.getByText("Generating: 40%.")).toBeVisible();
  await expect(panel.getByRole("progressbar", { name: "Prototype audio progress" })).toHaveAttribute("value", "0.4");
  await expect(panel.getByLabel("Prototype audio clip")).toBeVisible({ timeout: 10_000 });
});
}
