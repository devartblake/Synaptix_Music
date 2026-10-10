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

test("tracks take their instrument family's colour and show a level and the clock", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  // Colours follow what each track plays as, resolved like the audio engine does (device, then
  // track name): the demo's Drums are drums, "Bass" plays as a bass, Harmony as a poly synth.
  const colour = (name: string) => page.locator("[data-variant='daw'] [style*='--track-color']")
    .filter({ has: page.getByText(name, { exact: true }) }).first()
    .evaluate((row) => getComputedStyle(row).getPropertyValue("--track-color").trim());
  expect(await colour("Drums")).toBe("#ff7a59");
  expect(await colour("Bass")).toBe("#6379ff");
  expect(await colour("Harmony")).toBe("#8994ff");
  const level = page.getByRole("meter", { name: "Drums level" });
  await expect(level).toHaveAttribute("aria-valuenow", "-60");
  await expect(page.getByLabel("Playback time")).toContainText("0:00.0");
  await expect(page.getByLabel("Playback position")).toContainText("1:1:000");
});

test("an empty project asks for a first instrument and adds it in one step", async ({ page }) => {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.addInitScript(() => localStorage.setItem("synaptix-music:studio-layout:v1", JSON.stringify({ shell: "v2" })));
  await page.goto("/");
  await page.getByRole("button", { name: "Find or create project" }).click();
  await page.getByLabel("New project name").fill("Empty start");
  await page.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await expect(page.getByText("Start with an instrument")).toBeVisible();
  await page.getByRole("button", { name: "Add Warm Pad track" }).click();
  await expect(page.getByRole("button", { name: "Mute Warm Pad" })).toBeVisible();
  await expect(page.getByText("Start with an instrument")).toHaveCount(0);
});

test("section markers are added, renamed and removed as undoable edits", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  const markers = page.getByRole("list", { name: "Section markers" });
  await page.getByRole("button", { name: "+ Marker" }).click();
  // A new marker opens for naming straight away, at the playhead's bar.
  await page.getByRole("textbox", { name: "Rename Section 1" }).fill("Drop");
  await page.keyboard.press("Enter");
  await expect(markers.getByRole("button", { name: "Drop, bar 1" })).toBeVisible();

  // Undo takes back the rename, then the marker itself: each is one step.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(markers.getByRole("button", { name: "Section 1, bar 1" })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(markers.getByRole("listitem")).toHaveCount(0);

  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await markers.getByRole("button", { name: "Section 1, bar 1" }).press("F2");
  await page.getByRole("textbox", { name: "Rename Section 1" }).fill("Intro");
  await page.keyboard.press("Enter");
  await markers.getByRole("button", { name: "Intro, bar 1" }).press("Delete");
  await expect(markers.getByRole("listitem")).toHaveCount(0);
});

test("the loop is set by dragging the brace or pressing L on a clip, and undoes in one step", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  // The demo keeps a 16-bar loop range with looping off: the brace shows it, dimmed.
  await expect(page.getByRole("img", { name: "Loop: bars 1 to 16 (off)" })).toBeVisible();
  const lane = page.locator("[title='Drag across bars to set the loop']");
  const box = (await lane.boundingBox())!;
  const barX = (bar: number) => box.x + ((bar - 0.5) / 16) * box.width;
  await page.mouse.move(barX(6), box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(barX(3), box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole("img", { name: "Loop: bars 3 to 6" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Loop", exact: true })).toHaveAttribute("aria-pressed", "true");

  // One undo restores both the old range and looping off.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("img", { name: "Loop: bars 1 to 16 (off)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Loop", exact: true })).toHaveAttribute("aria-pressed", "false");

  // L loops the bars the selected clip covers (the demo's clips run all 16 bars) and turns looping on.
  await page.getByRole("button", { name: "Select Bass Generated Loop" }).click();
  await page.keyboard.press("l");
  await expect(page.getByRole("img", { name: "Loop: bars 1 to 16" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Loop", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear loop" }).click();
  await expect(page.getByRole("img", { name: /^Loop: bars/ })).toHaveCount(0);
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
