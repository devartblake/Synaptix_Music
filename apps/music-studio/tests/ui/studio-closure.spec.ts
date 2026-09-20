import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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
  const selectors = [".studio-topbar", ".studio-sidebar", ".studio-workspace", ".studio-inspector"];
  const layout = await page.locator(selectors.join(",")).evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      className: element.className,
      visible: rect.width > 0 && rect.height > 0,
      x: Math.round(rect.x),
      width: Math.round(rect.width),
      right: Math.round(rect.right)
    };
  }));

  const expected = testInfo.project.name === "desktop"
    ? [
        { className: "studio-topbar", visible: true, x: 0, width: 1440, right: 1440 },
        { className: "studio-sidebar", visible: true, x: 0, width: 208, right: 208 },
        { className: "studio-workspace", visible: true, x: 208, width: 960, right: 1168 },
        { className: "studio-inspector", visible: true, x: 1168, width: 272, right: 1440 }
      ]
    : [
        { className: "studio-topbar", visible: true, x: 0, width: 1024, right: 1024 },
        { className: "studio-sidebar", visible: true, x: 0, width: 184, right: 184 },
        { className: "studio-workspace", visible: true, x: 184, width: 840, right: 1024 },
        { className: "studio-inspector", visible: false, x: 0, width: 0, right: 0 }
      ];
  expect(layout).toEqual(expected);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("generation workspace exposes a screen-reader-safe status and labeled controls", async ({ page }) => {
  await prepareStudio(page);
  await page.getByRole("button", { name: /Generate/ }).click();
  await expect(page.getByRole("heading", { name: "Create a project variation" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("durable polling");
  await expect(page.getByLabel("Creative brief")).toBeVisible();
  await expect(page.getByLabel("Energy")).toBeVisible();
  await expect(page.getByRole("region", { name: "Generated variation preview" })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});
