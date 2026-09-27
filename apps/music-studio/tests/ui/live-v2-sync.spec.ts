import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

// Live smoke test for Project Schema v2 cutover step D: a running studio with
// NEXT_PUBLIC_SYNAPTIX_PLATFORM_PROJECT_SCHEMA_VERSION=2 and a real SynaptixPlay backend.
// Skipped unless LIVE_STUDIO_URL, LIVE_PLATFORM_EMAIL and LIVE_PLATFORM_PASSWORD are set, e.g.
//   LIVE_STUDIO_URL=http://localhost:3000 LIVE_PLATFORM_EMAIL=... LIVE_PLATFORM_PASSWORD=... \
//     npx playwright test tests/ui/live-v2-sync.spec.ts --project=desktop
const studio = process.env.LIVE_STUDIO_URL;
const email = process.env.LIVE_PLATFORM_EMAIL;
const password = process.env.LIVE_PLATFORM_PASSWORD;

test.skip(!studio || !email || !password, "Live platform credentials are not configured.");
test.use({ baseURL: studio });

test("plug-in projects sync to the platform as v2 and renders refuse live plug-ins", async ({ page }) => {
  test.setTimeout(120_000);
  const signIn = await page.request.post("/api/auth/session", { data: { email, password } });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();

  const projectId = randomUUID();
  await page.goto(`/studio/${projectId}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");

  await page.getByText("Bass controls", { exact: true }).click();
  const rack = page.getByRole("region", { name: "Bass inserts" });
  await rack.getByRole("button", { name: "Add Reference Drive" }).click();
  await expect(rack.getByText("Active")).toBeVisible({ timeout: 15_000 });

  // The platform stores the plug-in project as v2, with the plug-in device intact.
  await expect.poll(async () => {
    const response = await page.request.get(`/api/platform/projects/${projectId}`);
    if (!response.ok()) return `HTTP ${response.status()}`;
    const { project } = await response.json() as {
      project: { schemaVersion: number; tracks: { devices: { plugin?: { pluginId: string } }[] }[] };
    };
    const hasDrive = project.tracks.some((track) =>
      track.devices.some((device) => device.plugin?.pluginId === "synaptix.reference-drive"));
    return `v${project.schemaVersion} drive=${hasDrive}`;
  }, { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }).toBe("v2 drive=true");

  // Rendering is refused up front while the plug-in is live and unfrozen.
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("render");
  await page.getByRole("button", { name: "Render current revision", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "can't play live plug-ins" })).toBeVisible();

  await page.request.delete("/api/auth/session");
});

test("a plain project syncs as v2 and renders to completion from the stored v2 revision", async ({ page }) => {
  test.setTimeout(180_000);
  const signIn = await page.request.post("/api/auth/session", { data: { email, password } });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();

  const projectId = randomUUID();
  await page.goto(`/studio/${projectId}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  // Any edit creates a revision to upload.
  await page.getByRole("spinbutton", { name: "Tempo" }).fill("128");
  await page.getByRole("spinbutton", { name: "Tempo" }).press("Tab");

  await expect.poll(async () => {
    const response = await page.request.get(`/api/platform/projects/${projectId}`);
    if (!response.ok()) return `HTTP ${response.status()}`;
    const { project } = await response.json() as { project: { schemaVersion: number; tempoMap: { bpm: number }[] } };
    return `v${project.schemaVersion} ${project.tempoMap[0]?.bpm} BPM`;
  }, { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }).toBe("v2 128 BPM");

  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("render");
  await page.getByRole("button", { name: "Render current revision", exact: true }).click();
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible({ timeout: 120_000 });

  await page.request.delete("/api/auth/session");
});

test("freezing the Reference Drive renders it on the worker and tracks whether the freeze is current", async ({ page }) => {
  test.setTimeout(300_000);
  const signIn = await page.request.post("/api/auth/session", { data: { email, password } });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();

  await page.goto(`/studio/${randomUUID()}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByText("Bass controls", { exact: true }).click();
  const rack = page.getByRole("region", { name: "Bass inserts" });
  await rack.getByRole("button", { name: "Add Reference Drive" }).click();
  await expect(rack.getByText("Active")).toBeVisible({ timeout: 15_000 });

  await rack.getByRole("button", { name: "Freeze Reference Drive on Bass" }).click();
  await expect(rack.getByRole("status").filter({ hasText: "Frozen · current" })).toBeVisible({ timeout: 240_000 });
  await expect(rack.getByRole("button", { name: "Freeze Reference Drive on Bass" })).toHaveText("Refreeze");

  // Changing the plug-in makes the freeze out of date.
  const drive = rack.getByRole("slider", { name: "Bass Reference Drive Drive" });
  await drive.focus();
  await page.keyboard.press("ArrowRight");
  await expect(rack.getByRole("status").filter({ hasText: "Frozen · out of date" })).toBeVisible({ timeout: 15_000 });

  await page.request.delete("/api/auth/session");
});
