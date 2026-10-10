import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

// Studio UI v2 (docs/plans/ui/studio-ui-v2.md), step 2: the DAW shell behind the Layout menu's
// preview switch. The editors inside are v1's; these tests cover the shell around them.

async function openStudio(page: Page) {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto("/studio/visual-baseline");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}

async function switchToV2(page: Page) {
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await page.getByRole("button", { name: "DAW layout (preview)" }).click();
  await expect(page.locator(".studio-v2")).toBeVisible();
}

test("the DAW layout keeps the timeline in view while the dock edits, mixes and shapes sounds", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  const dock = page.getByRole("region", { name: "Dock" });
  const tab = (name: string) => dock.getByRole("tab", { name: new RegExp(`^${name}`) });

  // Editing a clip opens it in the dock; the arrangement stays on screen (v1 swaps it out).
  await expect(dock.getByText("Select a clip in the arrangement")).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).nth(3).click();
  await expect(tab("Editor")).toHaveAttribute("aria-selected", "true");
  await expect(dock.getByRole("region", { name: "Piano roll editor" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Project workspace" }).getByText("Drums Generated Loop")).toBeVisible();

  // Alt+3 shows the mixer in place; pressing it again collapses the dock, and Alt+2 reopens it on Devices.
  await page.keyboard.press("Alt+3");
  await expect(tab("Mixer")).toHaveAttribute("aria-selected", "true");
  await expect(dock.getByRole("heading", { name: "Mixer" })).toBeVisible();
  await expect(dock.getByRole("button", { name: "Close mixer" })).toHaveCount(0);
  await page.keyboard.press("Alt+3");
  await expect(dock.getByRole("tabpanel")).toHaveCount(0);
  await page.keyboard.press("Alt+2");
  await expect(dock.getByRole("group", { name: "Bass", exact: true }).getByRole("slider", { name: "Attack", exact: true })).toBeVisible();

  // Arrow keys move between dock tabs.
  await tab("Devices").press("ArrowRight");
  await expect(tab("Mixer")).toBeFocused();
  await expect(tab("Mixer")).toHaveAttribute("aria-selected", "true");

  // Alt+S switches views; the transport bar's switch shows which is active.
  await page.keyboard.press("Alt+s");
  await expect(page.getByRole("heading", { name: "Author adaptive states" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Adaptive states", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await expect(page.getByText("Drums Generated Loop")).toBeVisible();

  // The status bar names the control under focus.
  await page.getByRole("button", { name: "Export", exact: true }).focus();
  await expect(page.locator(".studio-hint")).toHaveText("Export");

  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the layout choice and dock state survive a reload, and the classic layout is one click back", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  await page.keyboard.press("Alt+3");
  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await expect(page.locator(".studio-v2")).toBeVisible();
  await expect(page.getByRole("region", { name: "Dock" }).getByRole("tab", { name: /^Mixer/ })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await expect(page.getByRole("button", { name: "DAW layout (preview)" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "DAW layout (preview)" }).click();
  await expect(page.locator(".studio-topbar")).toBeVisible();
  await expect(page.locator(".studio-v2")).toHaveCount(0);
});

test("the DAW layout matches its visual baseline", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  await page.getByRole("button", { name: "Layout", exact: true }).press("Escape");
  await page.getByRole("button", { name: "Edit", exact: true }).nth(3).click();
  await page.locator(".studio-hint").evaluate((element) => { element.textContent = ""; });
  await expect(page).toHaveScreenshot("v2-arrange-editor.png", {
    animations: "disabled",
    caret: "hide",
    stylePath: resolve("tests/ui/visual.css"),
    maxDiffPixelRatio: 0.002
  });
});
