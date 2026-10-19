import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { openWorkspace } from "./layouts";

async function prepareStudio(page: Page): Promise<void> {
  await page.route("**/api/platform/generation/jobs**", async (route) => {
    if (route.request().method() === "GET" && !/jobs\/.+/.test(route.request().url())) {
      await route.fulfill({ json: { jobs: [] } });
      return;
    }
    await route.fulfill({ status: 503, json: { code: "test_unavailable", message: "Test service unavailable", correlationId: "ui-test", retryable: true } });
  });
  await page.goto("/studio/visual-regression-project");
  await expect(page.getByRole("heading", { name: "Synaptix Generated Arrangement" })).toBeVisible();
}

test("studio shell preserves its desktop and tablet layout contract", async ({ page }, testInfo) => {
  await prepareStudio(page);
  // The DAW layout (the default since Studio UI v2 step 9b): transport bar, Browser, centre, inspector.
  const selectors = [".studio-transportbar", ".studio-browser", ".studio-v2-centre", ".studio-inspector"];
  // The layout hook narrows the tablet Browser after hydration, so measure once the layout settles.
  const measure = () => page.locator(selectors.join(",")).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      className: element.classList[0],
      visible: rect.width > 0 && rect.height > 0,
      x: Math.round(rect.x),
      width: Math.round(rect.width),
      right: Math.round(rect.right)
    };
  }));

  const expected = testInfo.project.name === "desktop"
    ? [
        { className: "studio-transportbar", visible: true, x: 0, width: 1440, right: 1440 },
        { className: "studio-browser", visible: true, x: 0, width: 208, right: 208 },
        { className: "studio-v2-centre", visible: true, x: 208, width: 960, right: 1168 },
        { className: "studio-inspector", visible: true, x: 1168, width: 272, right: 1440 }
      ]
    : [
        // Tablets open the inspector over the timeline from the transport bar instead.
        { className: "studio-transportbar", visible: true, x: 0, width: 1024, right: 1024 },
        { className: "studio-browser", visible: true, x: 0, width: 184, right: 184 },
        { className: "studio-v2-centre", visible: true, x: 184, width: 840, right: 1024 },
        { className: "studio-inspector", visible: false, x: 0, width: 0, right: 0 }
      ];
  await expect.poll(measure).toEqual(expected);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("generation workspace exposes a screen-reader-safe status and labeled controls", async ({ page }) => {
  await prepareStudio(page);
  await openWorkspace(page, "generation");
  await expect(page.getByRole("heading", { name: "Create a project variation" })).toBeVisible();
  // Generate is a drawer beside the timeline, which stays on screen.
  await expect(page.getByRole("complementary", { name: "Generate" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Project workspace" }).locator("[data-track-id]").first()).toBeVisible();
  const preview = page.getByRole("region", { name: "Generated variation preview" });
  await expect(preview.getByRole("status")).toContainText("durable polling");
  await expect(page.getByLabel("Creative brief")).toBeVisible();
  await expect(page.getByLabel("Energy")).toBeVisible();
  await expect(preview).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
