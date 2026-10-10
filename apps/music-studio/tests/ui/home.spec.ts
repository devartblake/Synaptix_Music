import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { computeProjectChecksum } from "@synaptix/command-system";
import { arrangementFingerprint, createEmptyProject, type MusicProject } from "@synaptix/project-model";

/** A project file as the home page's import expects it (lib/editor/project-file.ts). */
async function projectFile(project: MusicProject): Promise<string> {
  const checksumSha256 = await computeProjectChecksum(project);
  return JSON.stringify({ format: "synaptix-music-project", version: 1, exportedAt: "2026-10-10T00:00:00.000Z", checksumSha256, project });
}

test("home opens the demo and resumes an edited local project", async ({ page }) => {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your first session starts here." })
  ).toBeVisible();
  await page.getByRole("link", { name: "Open demo studio", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/local-demo$/);
  await expect(page.getByRole("heading", { name: "Synaptix Generated Arrangement" })).toBeVisible();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("spinbutton", { name: "Tempo" }).fill("124");
  // The demo is a browser-only project: saved locally, never queued for cloud upload.
  await expect(page.getByText("demo projects stay in this browser", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Back to projects" }).click();
  const project = page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "Synaptix Generated Arrangement" }) });
  await expect(project).toBeVisible();
  // It doesn't sync, so its card has no cloud badge.
  await expect(project.locator("[data-tone]")).toHaveCount(0);
  await project.click();
  await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("124");
});

test("home is accessible and fits desktop, tablet, and phone widths", async ({
  page
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your first session starts here." })
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "Open demo studio", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home-mobile.png"), fullPage: true });
});

test("home explains unavailable storage and keeps the studio reachable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new Error("Storage blocked");
      }
    });
  });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Your saved projects couldn’t be read");
  await page.getByRole("button", { name: "Retry loading projects" }).click();
  await expect(page.getByRole("status")).toContainText("Your saved projects couldn’t be read");
  await expect(page.getByRole("link", { name: "Open demo studio", exact: true })).toHaveAttribute(
    "href",
    "/studio/local-demo"
  );
});

test("project cards show whether the music was generated, generated then edited, or composed by hand", async ({ page }, testInfo) => {
  await page.route("**/api/platform/**", (route) => route.fulfill({ status: 503, json: { message: "Platform unavailable" } }));

  const project = (name: string) => {
    const value = createEmptyProject(`origin-${name}`, { revisionId: "r1", now: "2026-10-10T00:00:00.000Z" });
    value.metadata.name = name;
    value.tracks = [{ id: "lead", name: "Lead", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, devices: [],
      clips: [{ id: "riff", kind: "midi", name: "Riff", loop: false, range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: 3840 },
        notes: [{ id: "n1", pitch: 64, velocity: 90, startTick: 0, durationTicks: 480 }] }] }];
    return value;
  };
  const generated = project("Generated tune");
  generated.generationMetadata = { generatorId: "synaptix-procedural-composer", generatorVersion: "0.1.0", seed: 1, createdAt: "2026-10-10T00:00:00.000Z" };
  generated.generationMetadata.arrangementFingerprint = arrangementFingerprint(generated);
  const edited = structuredClone(generated);
  edited.projectId = "origin-edited";
  edited.metadata.name = "Edited tune";
  (edited.tracks[0]!.clips[0] as { notes: { velocity: number }[] }).notes[0]!.velocity = 60;

  await page.goto("/");
  for (const value of [project("Hand tune"), generated, edited]) {
    const path = testInfo.outputPath(`${value.projectId}.synaptix.json`);
    await writeFile(path, await projectFile(value));
    await page.getByRole("button", { name: "Find or create project" }).click();
    await page.getByLabel(/Project file/).setInputFiles(path);
    // Importing opens the copy in the studio; opening it must not change its music.
    await expect(page).toHaveURL(/\/studio\//);
    await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
    await page.getByRole("link", { name: "Back to projects" }).click();
  }

  const card = (name: string) => page.locator("a").filter({ has: page.getByRole("heading", { name }) });
  const expected = [
    ["Hand tune", "Hand-composed", "♫", "hand"],
    ["Generated tune", "Generated", "✦", "generated"],
    ["Edited tune", "Edited", "✦+", "edited"]
  ] as const;
  for (const [name, label, icon, origin] of expected) {
    await expect(card(name)).toHaveAttribute("data-origin", origin);
    await expect(card(name)).toContainText(label);
    await expect(card(name)).toContainText(icon);
  }
  // Imported copies get platform IDs, so they sync: each card has a blue cloud beside its origin.
  for (const [name] of expected) {
    const badge = card(name).locator("[data-tone='synced']");
    await expect(badge).toHaveText("Cloud");
    expect(await badge.locator("svg").evaluate((element) => getComputedStyle(element).color)).toBe("rgb(99, 121, 255)");
  }
  // Each origin has its own colour: generated purple, edited teal, hand-composed blue.
  const edge = (name: string) => card(name).evaluate((element) => getComputedStyle(element).borderTopColor);
  const colours = await Promise.all(expected.map(([name]) => edge(name)));
  expect(new Set(colours).size).toBe(3);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
  ).toEqual([]);
});

test("the floating tab bar is for phones on the home page; desktop uses the header navigation", async ({ page }) => {
  await page.route("**/api/platform/**", (route) => route.fulfill({ status: 503, json: { message: "Platform unavailable" } }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Library" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Listening" })).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "Listening" })).toBeVisible();
  // The library keeps it on every screen: its header has no other way to the studio or search.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/library");
  await expect(page.getByRole("navigation", { name: "Listening" })).toBeVisible();
});
