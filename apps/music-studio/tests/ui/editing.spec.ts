import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openStudio(page: Page) {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto("/studio/editing-test");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
}

test("compact arrangement selects clips, seeks, and preserves expandable controls", async ({
  page
}, info) => {
  await openStudio(page);
  const clip = page.getByRole("button", { name: "Select Bass Generated Loop", exact: true });
  await clip.click();
  await expect(clip).toHaveAttribute("aria-pressed", "true");
  await expect(clip.locator("svg rect")).toHaveCount(64);
  const position = page.getByLabel("Playback position");
  await page.getByRole("button", { name: "Seek to bar 3", exact: true }).click();
  await expect(position).toHaveAttribute("data-tick", "7680");
  await expect(page.locator("[data-playhead-tick='7680']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("arrangement.png") });
  await page.locator("summary").filter({ hasText: "Bass controls" }).click();
  const controls = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Bass controls" }) });
  await controls.getByRole("slider", { name: "Volume", exact: true }).press("ArrowRight");
  await expect(controls.getByRole("slider", { name: "Volume", exact: true })).toHaveValue("-7");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(controls.getByRole("slider", { name: "Volume", exact: true })).toHaveValue("-8");
  await clip.press("Enter");
  await expect(page.getByRole("region", { name: "Piano roll editor" })).toBeVisible();
});

test("playheads follow real transport seek, looping, pause, and stop", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("spinbutton", { name: "Tempo", exact: true }).fill("300");
  await expect(page.locator(".studio-title small")).toContainText("Revision saved");
  await page.getByRole("button", { name: "Loop: Off", exact: true }).click();
  await expect(page.getByRole("button", { name: "Loop: On", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Seek to bar 16", exact: true }).click();
  const position = page.getByLabel("Playback position");
  await expect(position).toHaveAttribute("data-tick", "57600");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(async () => Number(await position.getAttribute("data-tick")))
    .toBeLessThan(12000);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForTimeout(150); // Allow the audio transport's scheduled pause and subscription to settle.
  const paused = await position.getAttribute("data-tick");
  await page.waitForTimeout(150);
  await expect(position).toHaveAttribute("data-tick", paused!);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(position).toHaveAttribute("data-tick", "0");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.locator("[aria-current='step']").count()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("[aria-current='step']")).toHaveCount(0);
});

test("piano keyboard edits persist and support undo, resize, velocity, and deletion", async ({
  page
}, info) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Edit", exact: true }).nth(1).click();
  const note = page.locator('[data-note-id="clip-2-note-0-0"]');
  await note.press("Space");
  await expect(note).toHaveAttribute("aria-pressed", "true");
  await note.press("ArrowRight");
  await expect(note).toHaveAttribute("data-start", "240");
  await expect(page.getByRole("button", { name: "Quantize", exact: true })).toBeEnabled();
  await note.press("ArrowUp");
  await expect(note).toHaveAttribute("data-pitch", "46");
  await expect(page.getByRole("button", { name: "Quantize", exact: true })).toBeEnabled();
  await note.press("Shift+ArrowRight");
  await expect(note).toHaveAttribute("data-duration", "1120");
  await expect(page.getByRole("slider", { name: "Velocity", exact: true })).toBeEnabled();
  await page.getByRole("slider", { name: "Velocity", exact: true }).press("ArrowRight");
  await expect(note).toHaveAttribute("data-velocity", "109");
  await expect(page.getByRole("button", { name: "Quantize", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(note).toHaveAttribute("data-velocity", "108");
  await note.press("Control+a");
  await expect(page.getByRole("status", { name: "Note selection" })).toHaveText("64 selected");
  await note.press("Escape");
  await note.press("Space");
  await note.press("Delete");
  await expect(note).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(note).toHaveAttribute("data-pitch", "46");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("piano-roll.png") });
  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("button", { name: "Edit", exact: true }).nth(1).click();
  await expect(note).toHaveAttribute("data-start", "240");
  await expect(note).toHaveAttribute("data-duration", "1120");
});

test("drum keys navigate, toggle and accent steps; clearing affects only visible bars", async ({
  page
}, info) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  const kick = page.getByRole("button", { name: "Kick step 2", exact: true });
  await page.getByRole("button", { name: "Kick step 1", exact: true }).press("ArrowRight");
  await expect(kick).toBeFocused();
  await kick.press("Space");
  await expect(kick).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Clear visible steps" })).toBeEnabled();
  await kick.press("v");
  await expect(kick).toHaveAttribute("data-velocity", "accent");
  await kick.press("ArrowDown");
  await expect(page.getByRole("button", { name: "Snare step 2", exact: true })).toBeFocused();
  await page.getByRole("combobox", { name: "Start bar", exact: true }).selectOption({ value: "15" });
  await page.getByRole("combobox", { name: "Pattern", exact: true }).selectOption("4");
  await expect(
    page.getByRole("group", { name: "Drum steps", exact: true }).getByRole("button")
  ).toHaveCount(128);
  await page.getByRole("button", { name: "Clear visible steps" }).click();
  await expect(page.getByRole("button", { name: "Kick step 241", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
  await page.getByRole("combobox", { name: "Start bar", exact: true }).selectOption("0");
  await expect(kick).toHaveAttribute("data-velocity", "accent");
  await expect(page.getByRole("button", { name: "Kick step 1", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByRole("combobox", { name: "Pattern", exact: true }).selectOption("1");
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("drum-sequencer.png") });
  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(kick).toHaveAttribute("data-velocity", "accent");
});

test("pointer group edits form one undo step and keyboard insertion respects clip bounds", async ({ page }) => {
  await openStudio(page);
  await page.getByRole("button", { name: "Edit", exact: true }).nth(1).click();
  const first = page.locator('[data-note-id="clip-2-note-0-0"]');
  const second = page.locator('[data-note-id="clip-2-note-0-1"]');
  await first.click({ position: { x: 3, y: 5 } });
  await second.click({ modifiers: ["Shift"], position: { x: 3, y: 5 } });
  await expect(page.getByRole("status", { name: "Note selection" })).toHaveText("2 selected");
  await first.scrollIntoViewIfNeeded();
  const bounds = await first.boundingBox();
  if (!bounds) throw new Error("The note is missing");
  await page.mouse.move(bounds.x + 3, bounds.y + 5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 13, bounds.y + 5, { steps: 4 });
  await page.mouse.up();
  await expect(first).toHaveAttribute("data-start", "480");
  await expect(second).toHaveAttribute("data-start", "1440");
  await expect(page.getByRole("button", { name: "Quantize", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(first).toHaveAttribute("data-start", "0");
  await expect(second).toHaveAttribute("data-start", "960");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await first.press("Control+d");
  await expect(page.locator("[data-note-id]")).toHaveCount(66);
  await expect(page.getByRole("button", { name: "Quantize", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("[data-note-id]")).toHaveCount(64);
  await page.getByRole("spinbutton", { name: "New note pitch" }).fill("127");
  await page.getByRole("spinbutton", { name: "New note tick" }).fill("61439");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  const added = page.locator('[data-note-id][data-pitch="127"]');
  await expect(added).toHaveAttribute("data-duration", "1");
  await expect(page.getByRole("button", { name: "Add note", exact: true })).toBeEnabled();
  await added.press("ArrowUp");
  await added.press("ArrowRight");
  await expect(added).toHaveAttribute("data-start", "61439");
  await expect(added).toHaveAttribute("data-pitch", "127");
  await expect(page.getByRole("region", { name: "Piano roll editor" }).getByRole("alert")).toHaveCount(0);
});
