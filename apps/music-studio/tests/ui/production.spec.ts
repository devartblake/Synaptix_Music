import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createEmptyProject } from "@synaptix/project-model";
import type { RenderJob, RenderManifest } from "@synaptix/render-contracts";

test("bus controls and sends persist; track and bus meters read live audio", async ({
  page
}, info) => {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto("/studio/production-mixer");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  const mixer = page.getByRole("region", { name: "Mixer", exact: true });
  const music = mixer.getByRole("slider", { name: "Music bus volume", exact: true });
  await music.press("ArrowLeft");
  await expect(music).toBeEnabled();
  await expect(music).toHaveValue("-1");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(music).toHaveValue("0");
  await mixer.getByRole("combobox", { name: "Bass output", exact: true }).selectOption("drums");
  await expect(mixer.getByRole("combobox", { name: "Bass output", exact: true })).toBeEnabled();
  const send = mixer.getByRole("slider", { name: "Bass reverb send", exact: true });
  await send.press("ArrowRight");
  await expect(send).toBeEnabled();
  await expect(send).toHaveValue("0.17");
  const master = mixer.getByRole("slider", { name: "Master volume", exact: true });
  await master.press("ArrowLeft");
  await expect(master).toBeEnabled();
  await page.reload();
  await expect(master).toHaveValue("-1");
  await expect(mixer.getByRole("combobox", { name: "Bass output", exact: true })).toHaveValue(
    "drums"
  );
  await expect(send).toHaveValue("0.17");
  await page.getByRole("button", { name: "Loop: Off", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () =>
      Number(
        await mixer
          .getByRole("meter", { name: "Drums peak", exact: true })
          .getAttribute("aria-valuenow")
      )
    )
    .toBeGreaterThan(-60);
  await expect
    .poll(async () =>
      Number(
        await mixer
          .getByRole("meter", { name: "Drums bus peak", exact: true })
          .getAttribute("aria-valuenow")
      )
    )
    .toBeGreaterThan(-60);
  await mixer.getByRole("button", { name: "Mute Drums bus", exact: true }).click();
  await expect(mixer.getByRole("meter", { name: "Drums bus peak", exact: true })).toHaveAttribute(
    "aria-valuenow",
    "-60"
  );
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("production-mixer.png") });
  await mixer.getByRole("button", { name: "Render / export", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Render & export" })).toBeVisible();
});

function projectFixture() {
  const project = createEmptyProject("export-test", {
    revisionId: "export-revision",
    now: "2026-09-22T00:00:00.000Z"
  });
  project.tracks = [
    {
      id: "bass",
      name: "Bass",
      kind: "instrument",
      muted: false,
      solo: false,
      volumeDb: -8,
      pan: 0,
      devices: [],
      clips: []
    }
  ];
  return project;
}
function jobFixture(manifest: RenderManifest, key: string): RenderJob {
  return {
    contractVersion: "1.0.0",
    jobId: "10000000-0000-4000-8000-000000000001",
    idempotencyKey: key,
    manifest,
    status: "queued",
    attempt: 0,
    maxAttempts: 5,
    submittedAt: manifest.requestedAt,
    updatedAt: manifest.requestedAt,
    leaseOwnerId: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    result: null,
    lastError: null
  };
}
async function openExport(page: Page) {
  await page.goto("/studio/export-test");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("render");
  await expect(page.getByRole("heading", { name: "Render & export" })).toBeVisible();
}

test("export retries with one idempotency key, recovers history, and downloads completed artifacts", async ({
  page
}, info) => {
  const project = projectFixture();
  let job: RenderJob | null = null;
  const keys: string[] = [];
  await page.route("**/api/platform/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/projects/")) return route.fulfill({ json: { project } });
    if (path.endsWith("/download-url"))
      return route.fulfill({
        json: {
          artifactId: "10000000-0000-4000-8000-000000000003",
          downloadUrl: "https://example.com/master.wav?signature=test"
        }
      });
    if (route.request().method() === "POST") {
      keys.push(route.request().headers()["idempotency-key"]!);
      if (keys.length === 1)
        return route.fulfill({ status: 503, json: { message: "Temporary queue outage" } });
      job = jobFixture(route.request().postDataJSON().manifest, keys[0]!);
      return route.fulfill({ json: job });
    }
    return route.fulfill({ json: { jobs: job ? [job] : [] } });
  });
  await openExport(page);
  await page.getByRole("button", { name: "Render current revision", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Temporary queue outage" })).toBeVisible();
  await page.reload();
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("render");
  await page.getByRole("button", { name: "Retry submission", exact: true }).click();
  await expect(page.getByText("queued", { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  const queued = job as unknown as RenderJob;
  job = {
    ...queued,
    status: "completed",
    attempt: 1,
    updatedAt: new Date().toISOString(),
    result: {
      contractVersion: "1.0.0",
      renderId: queued.manifest.renderId,
      status: "completed",
      warnings: [],
      errorCode: null,
      errorMessage: null,
      completedAt: new Date().toISOString(),
      artifacts: [
        {
          artifactId: "10000000-0000-4000-8000-000000000003",
          renderId: queued.manifest.renderId,
          trackId: null,
          fileName: "master.wav",
          mediaType: "audio/wav",
          byteLength: 48000,
          checksumSha256: "b".repeat(64),
          durationSeconds: 8
        }
      ]
    }
  };
  await page.getByRole("button", { name: "Refresh jobs" }).click();
  await page.getByRole("button", { name: "Get download link" }).click();
  await expect(page.getByRole("link", { name: "Download master.wav" })).toHaveAttribute(
    "href",
    "https://example.com/master.wav?signature=test"
  );
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("export.png") });
  await page.reload();
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("render");
  await expect(page.getByText("completed", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("export blocks an unsynced revision and shows cancel and failure states", async ({ page }) => {
  const project = projectFixture();
  let cloud = project;
  let job: RenderJob | null = null;
  let submissions = 0;
  await page.route("**/api/platform/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/projects/")) return route.fulfill({ json: { project: cloud } });
    if (path.endsWith("/cancel")) {
      job = { ...job!, status: "cancelled", updatedAt: new Date().toISOString() };
      return route.fulfill({ json: job });
    }
    if (route.request().method() === "POST") {
      submissions++;
      job = jobFixture(
        route.request().postDataJSON().manifest,
        route.request().headers()["idempotency-key"]!
      );
      return route.fulfill({ json: job });
    }
    return route.fulfill({ json: { jobs: job ? [job] : [] } });
  });
  await openExport(page);
  cloud = { ...project, revisionId: "different-revision" };
  await page.getByRole("button", { name: "Render current revision" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Save and sync" })).toBeVisible();
  expect(submissions).toBe(0);
  cloud = project;
  await page.getByRole("button", { name: "Render current revision" }).click();
  await page.getByRole("button", { name: "Cancel render" }).click();
  await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
  job = {
    ...(job as unknown as RenderJob),
    status: "dead_letter",
    lastError: "Project loader unavailable",
    updatedAt: new Date().toISOString()
  };
  await page.getByRole("button", { name: "Refresh jobs" }).click();
  await expect(page.getByText("Project loader unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Get download link" })).toHaveCount(0);
});
