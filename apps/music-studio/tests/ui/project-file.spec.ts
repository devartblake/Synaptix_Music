import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("a project exports to a file and imports back as a separate copy", async ({ page }, testInfo) => {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto("/");
  const openTools = () => page.getByRole("button", { name: "Find or create project" }).click();

  await openTools();
  await page.getByLabel("New project name").fill("Round trip");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  const originalUrl = page.url();
  await page.getByRole("spinbutton", { name: "Tempo" }).fill("97");
  await page.getByRole("spinbutton", { name: "Tempo" }).press("Tab");
  await expect(page.getByText("Revision saved and queued", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Back to projects" }).click();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Round trip as a file" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("round-trip.synaptix.json");
  const path = testInfo.outputPath("round-trip.synaptix.json");
  await file.saveAs(path);

  // A tampered copy is refused with an explanation.
  const tamperedPath = testInfo.outputPath("tampered.synaptix.json");
  const contents = JSON.parse(await readFile(path, "utf8"));
  contents.project.metadata.name = "Tampered";
  await writeFile(tamperedPath, JSON.stringify(contents));
  await openTools();
  await page.getByLabel(/Project file/).setInputFiles(tamperedPath);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("changed or damaged");

  // The genuine file opens as a new project with the same music.
  await page.getByLabel(/Project file/).setInputFiles(path);
  await expect(page).toHaveURL(/\/studio\//);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  expect(page.url()).not.toBe(originalUrl);
  await expect(page.getByRole("heading", { name: "Round trip" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("97");

  await page.getByRole("link", { name: "Back to projects" }).click();
  await expect(page.getByText("2 local projects")).toBeVisible();
});
