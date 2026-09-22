import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
  await expect(page.getByText("Revision saved and queued", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Back to projects" }).click();
  const project = page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: "Synaptix Generated Arrangement" }) });
  await expect(project).toBeVisible();
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
