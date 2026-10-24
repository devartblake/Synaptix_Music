import { expect, test } from "@playwright/test";

import { adaptiveFixture } from "../fixtures/adaptive";
import { openWorkspace } from "./layouts";

// Publication rules v1, phase 1: the studio checks the licence rule before uploading, so a person
// sees why music made with a non-commercial model can't be published (the platform enforces it too).
test("music generated with a non-commercial model can't be published, and the studio says why", async ({ page }) => {
  const fixture = adaptiveFixture();
  fixture.project.generationMetadata = {
    generatorId: "synaptix-audio-prototype",
    generatorVersion: "0.1.0",
    seed: 1,
    createdAt: fixture.project.metadata.createdAt,
    provenance: { model: "musicgen-small", licence: "CC-BY-NC-4.0", commercialUse: "not-allowed" }
  };
  await page.route("**/api/platform/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/platform/projects/${fixture.project.projectId}`)
      return route.fulfill({ json: { project: fixture.project } });
    if (url.pathname.endsWith("/render-jobs")) return route.fulfill({ json: { jobs: fixture.jobs } });
    if (url.pathname.endsWith("/versions")) return route.fulfill({ json: [] });
    return route.fulfill({ status: 503, json: { message: "Unavailable" } });
  });
  await page.goto(`/studio/${fixture.project.projectId}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await openWorkspace(page, "adaptive");
  await page.getByRole("button", { name: "Add state", exact: true }).first().click();

  const gate = page.getByRole("complementary", { name: "Publication certification gate" });
  await expect(gate.getByRole("alert")).toContainText("musicgen-small");
  await expect(gate.getByRole("alert")).toContainText("CC-BY-NC-4.0");
  await expect(gate.getByRole("alert")).toContainText("doesn't allow commercial use");
  await expect(gate.getByRole("button", { name: "Publish immutable version" })).toBeDisabled();
});

// Decisions 5 and 6: licensed AI-assisted music gets store disclosure text written from its
// provenance record, ready to paste into Steam's Content Survey.
test("licensed AI-assisted music shows store disclosure text built from its provenance", async ({ page }) => {
  const fixture = adaptiveFixture();
  fixture.project.generationMetadata = {
    generatorId: "synaptix-claude-composer",
    generatorVersion: "1.0.0",
    seed: 1,
    createdAt: fixture.project.metadata.createdAt,
    provenance: { model: "claude-x", licence: "Anthropic-Commercial-Terms", commercialUse: "allowed" }
  };
  await page.route("**/api/platform/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/platform/projects/${fixture.project.projectId}`)
      return route.fulfill({ json: { project: fixture.project } });
    if (url.pathname.endsWith("/render-jobs")) return route.fulfill({ json: { jobs: fixture.jobs } });
    if (url.pathname.endsWith("/versions")) return route.fulfill({ json: [] });
    return route.fulfill({ status: 503, json: { message: "Unavailable" } });
  });
  await page.goto(`/studio/${fixture.project.projectId}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await openWorkspace(page, "adaptive");
  await page.getByRole("button", { name: "Add state", exact: true }).first().click();

  const gate = page.getByRole("complementary", { name: "Publication certification gate" });
  await gate.getByText("Store disclosure").click();
  await expect(gate.getByText("Pre-generated")).toBeVisible();
  await expect(gate.getByLabel("Long form (Steam Content Survey)")).toHaveValue(/Anthropic's Claude/);
  // Screening isn't claimed until the melody check records a result in the package.
  await expect(gate.getByLabel("Long form (Steam Content Survey)")).not.toHaveValue(/screened/);
  await expect(gate.getByLabel("One line (other stores)")).toHaveValue(/Music pre-generated with AI/);
});
