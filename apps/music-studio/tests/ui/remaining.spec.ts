import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adaptiveFixture } from "../fixtures/adaptive";
import { resolve } from "node:path";

async function offline(page: Page) {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
}

test("projects can be created, searched, discovered in the cloud and deleted locally", async ({
  page
}) => {
  await offline(page);
  await page.goto("/");
  const tools = page.getByRole("dialog", { name: "Find or create a project" });
  await page.getByRole("button", { name: "Find or create project" }).click();
  await expect(tools).toBeVisible();
  await page.getByLabel("New project name").fill("Quiet piano");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Quiet piano", exact: true })).toHaveText(
    "Quiet piano"
  );
  await page.getByRole("link", { name: "Back to projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Quiet piano" })).toBeVisible();
  await expect(page.getByText("1 local project")).toBeVisible();
  await page.getByRole("button", { name: "Find or create project" }).click();
  await page.getByLabel("Search projects").fill("missing");
  await expect(page.getByText("No matching local projects.")).toBeVisible();
  await page.getByLabel("Search projects").fill("piano");
  await expect(
    tools.getByRole("list", { name: "Matching local projects" }).getByRole("link", { name: /Quiet piano/ })
  ).toBeVisible();
  await page.getByRole("button", { name: "Browse cloud projects" }).click();
  await expect(page.getByText("Cloud projects are unavailable. Try again.")).toBeVisible();
  await page.route("**/api/platform/projects", (route) =>
    route.fulfill({
      json: [
        { projectId: "cloud-piano", name: "Cloud piano", archived: false },
        { projectId: "archived", name: "Old piano", archived: true }
      ]
    })
  );
  await page.getByRole("button", { name: "Browse cloud projects" }).click();
  await expect(page.getByRole("link", { name: "Cloud piano · Cloud" })).toHaveAttribute(
    "href",
    "/studio/cloud-piano"
  );
  await expect(page.getByRole("link", { name: "Old piano · Cloud" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(tools).toBeHidden();
  await page.getByRole("button", { name: "Delete local project Quiet piano" }).click();
  await page.getByRole("button", { name: "Keep project" }).click();
  await expect(page.getByRole("heading", { name: "Quiet piano" })).toBeVisible();
  await page.getByRole("button", { name: "Delete local project Quiet piano" }).click();
  await page.getByRole("button", { name: "Confirm local deletion" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your first session starts here." })
  ).toBeVisible();
});

test("devices support keyboard history and the editing viewport has an accessible boundary", async ({
  page
}) => {
  await offline(page);
  await page.goto("/studio/device-test");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("devices");
  const bass = page.getByRole("group", { name: "Bass", exact: true });
  const attack = bass.getByRole("slider", { name: "Attack", exact: true });
  const value = Number(await attack.inputValue());
  await attack.press("ArrowRight");
  await expect(attack).toHaveValue(String(value + 0.001));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(attack).toHaveValue(String(value));
  await bass.getByRole("button", { name: "Bass device enabled" }).press("Space");
  await expect(bass.getByRole("button", { name: "Bass device enabled" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations
  ).toEqual([]);
  await page.setViewportSize({ width: 319, height: 700 });
  await expect(page.getByRole("heading", { name: "Make room to edit" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Attack", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 480 });
  await expect(page.getByRole("region", { name: "Devices and effects" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("adaptive authoring validates timing, persists its graph, verifies evidence, previews audio and publishes versions", async ({
  page
}) => {
  const fixture = adaptiveFixture();
  let published: any = null;
  await page.route("**/api/platform/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/platform/projects/${fixture.project.projectId}`)
      return route.fulfill({ json: { project: fixture.project } });
    if (url.pathname.endsWith("/render-jobs"))
      return route.fulfill({ json: { jobs: fixture.jobs } });
    if (url.pathname.endsWith("download-url")) {
      const id = url.pathname.split("/").at(-2);
      return route.fulfill({
        json: { artifactId: id, downloadUrl: `http://127.0.0.1:3210/preview-fixture.wav` }
      });
    }
    if (url.pathname.endsWith("/versions"))
      return route.fulfill({
        json: published
          ? [
              {
                version: 1,
                revisionId: published.revisionId,
                projectChecksumSha256: published.projectChecksumSha256,
                createdAt: fixture.project.metadata.createdAt,
                retentionStatus: "pending",
                expiresAt: null
              }
            ]
          : []
      });
    if (url.pathname.endsWith("/versions/1"))
      return route.fulfill({
        json: {
          packageId: published.packageId,
          projectId: published.projectId,
          version: 1,
          revisionId: published.revisionId,
          projectChecksumSha256: published.projectChecksumSha256,
          manifest: published.manifest,
          createdAt: fixture.project.metadata.createdAt,
          retentionStatus: "pending",
          expiresAt: null,
          artifacts: published.artifacts.map(
            ({ storageKey: _storageKey, ...descriptor }: { storageKey: string }) => descriptor
          )
        }
      });
    if (url.pathname.endsWith("/adaptive-packages") && route.request().method() === "POST") {
      published = route.request().postDataJSON();
      return route.fulfill({
        json: {
          outcome: "Accepted",
          packageId: published.packageId,
          version: 1,
          errorMessage: null
        }
      });
    }
    return route.fulfill({ status: 503, json: { message: "Unavailable" } });
  });
  await page.route("**/preview-fixture.wav", (route) =>
    route.fulfill({ contentType: "audio/wav", body: fixture.audio })
  );
  await page.goto(`/studio/${fixture.project.projectId}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("adaptive");
  await page.getByRole("button", { name: "Add state", exact: true }).nth(0).click();
  await page.getByRole("button", { name: "Add state", exact: true }).nth(1).click();
  const first = page.getByRole("group", { name: "State 1", exact: true });
  await first.getByLabel("Name", { exact: true }).fill("Exploration");
  await first.getByLabel("State ID", { exact: true }).fill("exploration");
  await first.getByRole("slider", { name: /Intensity/ }).press("End");
  await expect(first.getByRole("slider", { name: /Intensity/ })).toHaveValue("1");
  await page
    .getByRole("group", { name: "State 2", exact: true })
    .getByLabel("State ID", { exact: true })
    .fill("combat");
  await first.getByLabel("Loop end seconds").fill("5");
  await expect(page.getByRole("alert").filter({ hasText: "loop and entry" })).toBeVisible();
  await first.getByLabel("Loop end seconds").fill("2");
  await page.getByRole("button", { name: "Add transition", exact: true }).click();
  const transition = page.getByRole("group", { name: "Transition 1", exact: true });
  await transition
    .getByRole("combobox", { name: "Trigger", exact: true })
    .selectOption("immediate");
  await page.getByRole("button", { name: "Add cue", exact: true }).click();
  await page.getByRole("group", { name: "Cue 1", exact: true }).getByLabel("Cue ID").fill("impact");
  await page
    .getByRole("group", { name: "Cue 1", exact: true })
    .getByLabel("Cue seconds")
    .fill("0.5");
  await expect(page.getByRole("img", { name: "exploration to combat, immediate" })).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; } .studio-topbar { position: static !important; }" });
  await expect(
    page.getByRole("region", { name: "Transitions and cues", exact: true })
  ).toHaveScreenshot("adaptive-graph.png", {
    animations: "disabled",
    stylePath: resolve("tests/ui/visual.css"),
    maxDiffPixelRatio: 0.002
  });
  await page.reload();
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("adaptive");
  await expect(first.getByLabel("Name", { exact: true })).toHaveValue("Exploration");
  await expect(transition.getByRole("combobox", { name: "Trigger", exact: true })).toHaveValue(
    "immediate"
  );
  await expect(page.getByRole("button", { name: "Publish immutable version" })).toBeDisabled();
  for (const item of fixture.fixtures) {
    await page
      .getByLabel("Certification report", { exact: true })
      .setInputFiles({
        name: "report.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(item.report))
      });
    await page
      .getByLabel("Artifact manifest", { exact: true })
      .setInputFiles({
        name: "manifest.json",
        mimeType: "application/json",
        buffer: item.artifactBytes
      });
    await page.getByRole("button", { name: "Verify evidence" }).click();
    await expect(
      page.getByText(`Verified evidence for ${item.job.jobId}.`, { exact: true })
    ).toBeVisible();
  }
  await page
    .getByLabel("Platform artifact locations", { exact: true })
    .setInputFiles({
      name: "locations.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture.locations))
    });
  await expect(page.getByRole("button", { name: "Publish immutable version" })).toBeEnabled();
  await page.getByRole("button", { name: "Load preview audio" }).click();
  await expect(page.getByRole("button", { name: "Play preview" })).toBeEnabled();
  await page.getByRole("button", { name: "Play preview" }).click();
  await expect(page.getByLabel("Preview position")).toContainText("exploration:");
  await page.getByRole("combobox", { name: "Target state", exact: true }).selectOption("combat");
  await page.getByRole("button", { name: "Send set-state event" }).click();
  await expect(page.getByRole("log", { name: "Runtime events" })).toContainText(
    "exploration → combat"
  );
  await page.getByRole("button", { name: "Stop preview" }).click();
  await page.getByRole("button", { name: "Publish immutable version" }).click();
  await expect(page.getByText("Published immutable version 1.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Inspect version 1" }).click();
  await expect(page.getByText("Immutable snapshot", { exact: true })).toBeVisible();
  expect(published.manifest.cuePoints[0].positionSeconds).toBe(0.5);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
