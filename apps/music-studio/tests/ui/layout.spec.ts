import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openStudio(page: Page) {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto("/studio/layout-test");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
}

test("side panels resize, collapse, persist, and reset without editing the project", async ({
  page
}, testInfo) => {
  await openStudio(page);
  const navigation = page.getByRole("separator", { name: "Navigation panel size" });
  const initial = testInfo.project.name === "desktop" ? 208 : 184;
  await expect(navigation).toHaveAttribute("aria-valuenow", String(initial));
  await navigation.focus();
  await navigation.press("ArrowRight");
  await expect(navigation).toHaveAttribute("aria-valuenow", String(initial + 16));
  const edge = await navigation.boundingBox();
  if (!edge) throw new Error("Navigation resize handle is missing");
  // Focusing the full-height separator may scroll its top under the sticky transport.
  const dragY = Math.max(edge.y + 20, 150);
  await page.mouse.move(edge.x + edge.width / 2, dragY);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + 32, dragY, { steps: 5 });
  await page.mouse.up();
  await expect(navigation).toHaveAttribute("aria-valuenow", String(initial + 48));
  await page.reload();
  await expect(navigation).toHaveAttribute("aria-valuenow", String(initial + 48));
  expect(
    await page
      .locator(".studio-sidebar")
      .evaluate((element) => element.getBoundingClientRect().width)
  ).toBe(initial + 48);

  if (testInfo.project.name === "desktop") {
    const inspector = page.getByRole("separator", { name: "Inspector panel size" });
    await inspector.focus();
    await inspector.press("ArrowLeft");
    await expect(inspector).toHaveAttribute("aria-valuenow", "288");
    const inspectorEdge = await inspector.boundingBox();
    if (!inspectorEdge) throw new Error("Inspector resize handle is missing");
    const inspectorY = Math.max(inspectorEdge.y + 20, 150);
    await page.mouse.move(inspectorEdge.x + inspectorEdge.width / 2, inspectorY);
    await page.mouse.down();
    await page.mouse.move(inspectorEdge.x + inspectorEdge.width / 2 - 32, inspectorY, {
      steps: 5
    });
    await page.mouse.up();
    await expect(inspector).toHaveAttribute("aria-valuenow", "320");
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    await page.getByRole("button", { name: "Inspector panel", exact: true }).click();
    await expect(page.locator(".studio-inspector")).toBeHidden();
    await page.getByRole("button", { name: "Navigation panel", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    await page.getByRole("button", { name: "Navigation panel", exact: true }).click();
  }
  await expect(page.locator(".studio-sidebar")).toBeHidden();
  await page.reload();
  await expect(page.locator(".studio-sidebar")).toBeHidden();
  expect(
    await page.locator(".studio-workspace").evaluate((element) => element.getBoundingClientRect().x)
  ).toBe(0);
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await page.getByRole("button", { name: "Reset layout", exact: true }).click();
  await expect(navigation).toHaveAttribute("aria-valuenow", String(initial));
  if (testInfo.project.name === "desktop")
    await expect(page.getByRole("separator", { name: "Inspector panel size" })).toHaveAttribute(
      "aria-valuenow",
      "272"
    );
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("mixer size supports keyboard and pointer resizing and adapts to a smaller viewport", async ({
  page
}) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  const handle = page.getByRole("separator", { name: "Mixer height", exact: true });
  await handle.focus();
  await handle.press("ArrowUp");
  await expect(handle).toHaveAttribute("aria-valuenow", "336");
  const edge = await handle.boundingBox();
  if (!edge) throw new Error("Mixer resize handle is missing");
  await page.mouse.move(edge.x + 100, edge.y + 4);
  await page.mouse.down();
  await page.mouse.move(edge.x + 100, edge.y - 44, { steps: 5 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "384");
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "180");
  await handle.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "640");
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", "640");
  await page.setViewportSize({ width: 390, height: 600 });
  await expect(handle).toHaveAttribute("aria-valuenow", "380");
  await expect(page.locator(".studio-sidebar")).toBeHidden();
  await expect(page.locator(".studio-inspector")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(handle).toHaveAttribute("aria-valuenow", "640");
});

test("shared tabs, layout disclosure, and resize controls expose accessible keyboard behavior", async ({
  page
}, testInfo) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Edit", exact: true }).nth(1).click();
  await expect(page.getByRole("tab", { name: "MIDI editor" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByRole("tabpanel", { name: "MIDI editor" })).toBeVisible();
  await page.getByRole("tab", { name: "MIDI editor" }).press("Home");
  await expect(page.getByRole("tab", { name: "Arrangement", exact: true })).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Arrangement", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Layout", exact: true }).click();
  await expect(page.getByRole("button", { name: "Navigation panel", exact: true })).toBeFocused();
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Layout", exact: true })).toBeFocused();
  await expect(page.getByRole("group", { name: "Layout controls" })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("shared-controls-layout.png") });
});

test("corrupt or unavailable layout preferences fall back to bounded usable controls", async ({
  page
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "synaptix-music:studio-layout:v1",
      JSON.stringify({ navigationWidth: 10000, inspectorWidth: -20, mixerHeight: "invalid" })
    );
  });
  await openStudio(page);
  await expect(page.getByRole("separator", { name: "Navigation panel size" })).toHaveAttribute(
    "aria-valuenow",
    "320"
  );
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await expect(page.getByRole("separator", { name: "Mixer height" })).toHaveAttribute(
    "aria-valuenow",
    "320"
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      }
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  const mixerHandle = page.getByRole("separator", { name: "Mixer height" });
  await mixerHandle.press("ArrowUp");
  await expect(mixerHandle).toHaveAttribute("aria-valuenow", "336");
});
