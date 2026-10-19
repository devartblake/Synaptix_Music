import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The DAW layout's panels (Studio UI v2; the default since step 9b): the Browser and inspector
// resize, hide and reset from Settings; the dock resizes; bad or blocked preferences fall back.

async function openStudio(page: Page) {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto("/studio/layout-test");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await expect(page.locator(".studio-v2")).toBeVisible();
}

async function settings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  return page.getByRole("dialog", { name: "Settings" });
}

test("side panels resize, collapse, persist, and reset without editing the project", async ({
  page
}, testInfo) => {
  await openStudio(page);
  const browser = page.getByRole("separator", { name: "Browser panel size" });
  const initial = testInfo.project.name === "desktop" ? 208 : 184;
  await expect(browser).toHaveAttribute("aria-valuenow", String(initial));
  await browser.focus();
  await browser.press("ArrowRight");
  await expect(browser).toHaveAttribute("aria-valuenow", String(initial + 16));
  const edge = await browser.boundingBox();
  if (!edge) throw new Error("Browser resize handle is missing");
  const dragY = Math.max(edge.y + 20, 150);
  await page.mouse.move(edge.x + edge.width / 2, dragY);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 32, dragY, { steps: 5 });
  await page.mouse.up();
  await expect(browser).toHaveAttribute("aria-valuenow", String(initial + 48));
  await page.reload();
  await expect(browser).toHaveAttribute("aria-valuenow", String(initial + 48));
  expect(await page.locator(".studio-browser").evaluate((element) => element.getBoundingClientRect().width)).toBe(initial + 48);

  let dialog = await settings(page);
  if (testInfo.project.name === "desktop") {
    await dialog.getByRole("button", { name: "Close" }).click();
    const inspector = page.getByRole("separator", { name: "Inspector panel size" });
    await inspector.focus();
    await inspector.press("ArrowLeft");
    await expect(inspector).toHaveAttribute("aria-valuenow", "288");
    const inspectorEdge = await inspector.boundingBox();
    if (!inspectorEdge) throw new Error("Inspector resize handle is missing");
    const inspectorY = Math.max(inspectorEdge.y + 20, 150);
    await page.mouse.move(inspectorEdge.x + inspectorEdge.width / 2, inspectorY);
    await page.mouse.down();
    await page.mouse.move(inspectorEdge.x + inspectorEdge.width / 2 - 32, inspectorY, { steps: 5 });
    await page.mouse.up();
    await expect(inspector).toHaveAttribute("aria-valuenow", "320");
    dialog = await settings(page);
    await dialog.getByRole("switch", { name: "Inspector panel" }).click();
    await expect(page.locator(".studio-inspector")).toBeHidden();
  }
  await dialog.getByRole("switch", { name: "Browser panel" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.locator(".studio-browser")).toBeHidden();
  await page.reload();
  await expect(page.locator(".studio-browser")).toBeHidden();

  // Reset brings back the panels at their default sizes; it is not a project edit.
  dialog = await settings(page);
  await dialog.getByRole("button", { name: "Reset layout" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(browser).toHaveAttribute("aria-valuenow", String(initial));
  if (testInfo.project.name === "desktop")
    await expect(page.getByRole("separator", { name: "Inspector panel size" })).toHaveAttribute("aria-valuenow", "272");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("dock height supports keyboard and pointer resizing and adapts to a smaller viewport", async ({
  page
}) => {
  await openStudio(page);
  const handle = page.getByRole("separator", { name: "Dock height", exact: true });
  await handle.focus();
  await handle.press("ArrowUp");
  await expect(handle).toHaveAttribute("aria-valuenow", "336");
  const edge = await handle.boundingBox();
  if (!edge) throw new Error("Dock resize handle is missing");
  await page.mouse.move(edge.x + 100, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + 100, edge.y + edge.height / 2 - 48, { steps: 5 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "384");
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "180");
  await handle.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "640");
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", "640");

  // A short phone screen caps the dock; the stored height comes back on a bigger screen.
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(handle).toHaveAttribute("aria-valuenow", "340");
  await expect(page.locator(".studio-browser")).toBeHidden();
  await expect(page.locator(".studio-inspector")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(handle).toHaveAttribute("aria-valuenow", "640");
});

test("dock tabs, the Settings dialog and resize controls expose accessible keyboard behavior", async ({
  page
}, testInfo) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Edit", exact: true }).nth(1).click();
  const dock = page.getByRole("region", { name: "Dock" });
  const editor = dock.getByRole("tab", { name: /^Editor/ });
  await expect(editor).toHaveAttribute("aria-selected", "true");
  await expect(dock.getByRole("tabpanel")).toBeVisible();
  await editor.press("ArrowRight");
  await expect(dock.getByRole("tab", { name: /^Devices/ })).toBeFocused();
  await expect(dock.getByRole("tab", { name: /^Devices/ })).toHaveAttribute("aria-selected", "true");

  const dialog = await settings(page);
  await expect(dialog).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("shared-controls-layout.png") });
});

test("corrupt or unavailable layout preferences fall back to bounded usable controls", async ({
  page
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "synaptix-music:studio-layout:v1",
      JSON.stringify({ navigationWidth: 10000, inspectorWidth: -20, dockHeight: "invalid" })
    );
  });
  await openStudio(page);
  await expect(page.getByRole("separator", { name: "Browser panel size" })).toHaveAttribute("aria-valuenow", "320");
  await expect(page.getByRole("separator", { name: "Dock height" })).toHaveAttribute("aria-valuenow", "320");
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      }
    });
  });
  await page.reload();
  await expect(page.locator(".studio-v2")).toBeVisible();
  const dockHandle = page.getByRole("separator", { name: "Dock height" });
  await dockHandle.press("ArrowUp");
  await expect(dockHandle).toHaveAttribute("aria-valuenow", "336");
});
