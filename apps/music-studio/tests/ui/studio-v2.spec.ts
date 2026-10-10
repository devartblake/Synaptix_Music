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
  await expect(dock.getByRole("group", { name: "Mixer channels" })).toBeVisible();
  await expect(dock.getByRole("button", { name: "Close mixer" })).toHaveCount(0);
  await page.keyboard.press("Alt+3");
  await expect(dock.getByRole("tabpanel")).toHaveCount(0);
  await page.keyboard.press("Alt+2");
  // Devices shows the edited clip's track as a device chain (step 5).
  await expect(dock.getByRole("region", { name: "Lead Melody devices" }).getByRole("slider", { name: "Attack" })).toBeVisible();

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
  await page.getByRole("region", { name: "Arrangement timeline" }).getByRole("button", { name: "Add Warm Pad track" }).click();
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

test("the docked piano roll names chords, shades the scale and keeps rarer edits in a menu", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  await page.getByRole("button", { name: "Layout", exact: true }).press("Escape");
  // The FM Electric Piano starter plays C major then D minor chords.
  await page.getByRole("complementary", { name: "Browser" }).getByRole("button", { name: "FM Electric Piano", exact: true }).click();
  await page.getByRole("button", { name: "Add FM Electric Piano track" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).last().click();
  const roll = page.getByRole("region", { name: "Dock" }).getByRole("region", { name: "Piano roll editor" });

  // One toolbar row: no insert-note fields (drawing on the grid replaces them); rarer edits in Edit.
  await expect(roll.getByLabel("New note pitch")).toHaveCount(0);
  await roll.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(roll.getByRole("button", { name: "Duplicate" })).toBeVisible();
  await page.keyboard.press("Escape");

  // The Chord Panel names what plays; selecting a chord's notes names it too.
  const chords = roll.getByRole("list", { name: "Chords" });
  await expect(chords.getByRole("listitem").first()).toHaveText("C");
  await expect(chords.getByRole("listitem").nth(1)).toHaveText("Dm");
  await roll.getByRole("button", { name: /^C4, tick 0,/ }).click();
  await roll.getByRole("button", { name: /^E4, tick 0,/ }).click({ modifiers: ["Shift"] });
  await roll.getByRole("button", { name: /^G4, tick 0,/ }).click({ modifiers: ["Shift"] });
  await expect(roll.getByRole("status", { name: "Note selection" })).toHaveText("3 selected · C");

  // Scale: Auto reads C major from the notes. Choosing a key saves it in the project (it travels
  // with the project and undoes like any edit).
  const scale = roll.getByLabel("Scale");
  await expect(scale.locator("option:checked")).toHaveText("Auto (C major)");
  await scale.selectOption({ label: "D dorian" });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(scale.locator("option:checked")).toHaveText("Auto (C major)");
  await scale.selectOption({ label: "A minor" });
  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("button", { name: "Edit", exact: true }).last().click();
  await expect(page.getByRole("region", { name: "Dock" }).getByLabel("Scale").locator("option:checked")).toHaveText("A minor");

  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
  ).toEqual([]);
});

test("piano roll tools: draw with one click, ghost another track, humanize and label notes", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  await page.getByRole("button", { name: "Layout", exact: true }).press("Escape");
  await page.getByRole("button", { name: "Edit", exact: true }).nth(3).click();
  const roll = page.getByRole("region", { name: "Dock" }).getByRole("region", { name: "Piano roll editor" });
  const grid = roll.getByRole("group", { name: "MIDI notes" });
  const notes = grid.locator("[data-note-id]");
  const before = await notes.count();

  // Draw: one click on an empty spot (the top row is above the melody) adds a note; undo removes it.
  await roll.getByRole("button", { name: "Draw", exact: true }).click();
  const box = (await grid.boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + 4);
  await expect(notes).toHaveCount(before + 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(notes).toHaveCount(before);
  // B switches back to Select.
  await grid.focus();
  await page.keyboard.press("b");
  await expect(roll.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");

  // Ghost notes: the Bass track's notes show faintly, and go again with None.
  await roll.getByLabel("Ghost").selectOption({ label: "Bass" });
  expect(await grid.locator("[data-ghost-pitch]").count()).toBeGreaterThan(0);
  await roll.getByLabel("Ghost").selectOption({ label: "None" });
  await expect(grid.locator("[data-ghost-pitch]")).toHaveCount(0);

  // Humanize moves some selected notes a little; one undo puts every note back.
  const starts = () => notes.evaluateAll((all) => all.map((note) => `${note.getAttribute("data-start")}:${note.getAttribute("data-velocity")}`));
  const original = await starts();
  await grid.focus();
  await page.keyboard.press("Control+a");
  await roll.getByRole("button", { name: "Humanize" }).click();
  await expect.poll(starts).not.toEqual(original);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(starts).toEqual(original);

  // Labels write each note's name on it.
  await roll.getByRole("button", { name: "Labels" }).click();
  await expect(notes.first()).toContainText(/^[A-G]#?\d$/);
});

test("selected notes are renamed and cleared as undoable edits, and their labels survive a reload", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  await page.getByRole("button", { name: "Layout", exact: true }).press("Escape");
  await page.getByRole("button", { name: "Edit", exact: true }).nth(3).click();
  const roll = page.getByRole("region", { name: "Dock" }).getByRole("region", { name: "Piano roll editor" });
  const notes = roll.getByRole("group", { name: "MIDI notes" }).locator("[data-note-id]");
  const first = notes.first();
  const second = notes.nth(1);
  const firstId = await first.getAttribute("data-note-id");
  const pitchName = /^[A-G]#?\d$/;

  // Name the first two notes from the Rename menu; the labels show on the notes.
  await first.click();
  await second.click({ modifiers: ["Shift"] });
  await roll.getByRole("button", { name: "Rename", exact: true }).click();
  await roll.getByLabel("Note label").fill("Hook");
  await roll.getByLabel("Note label").press("Enter");
  await expect(roll.getByRole("button", { name: "Labels" })).toHaveAttribute("aria-pressed", "true");
  await expect(first).toHaveText("Hook");
  await expect(second).toHaveText("Hook");
  await expect(notes.nth(2)).toHaveText(pitchName);
  await expect(first).toHaveAttribute("aria-label", /^Hook, /);

  // Renaming one of them is its own undo step.
  await second.click();
  await roll.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(roll.getByLabel("Note label")).toHaveValue("Hook");
  await roll.getByLabel("Note label").fill("Answer");
  await roll.getByRole("button", { name: "Apply" }).click();
  await expect(second).toHaveText("Answer");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(second).toHaveText("Hook");

  // Clearing a label shows the pitch name again, and undoes in one step too.
  await roll.getByRole("button", { name: "Rename", exact: true }).click();
  await roll.getByRole("button", { name: "Clear label" }).click();
  await expect(second).toHaveText(pitchName);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(second).toHaveText("Hook");

  // Labels are project data: they survive a reload.
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("button", { name: "Edit", exact: true }).nth(3).click();
  await roll.getByRole("button", { name: "Labels" }).click();
  await expect(roll.locator(`[data-note-id="${firstId}"]`)).toHaveText("Hook");

  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
  ).toEqual([]);
});

test("the device chain shows one track's devices as knobs that edit, undo and reset", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  await page.getByRole("button", { name: "Layout", exact: true }).press("Escape");
  const dock = page.getByRole("region", { name: "Dock" });

  // The chain follows the clip being edited.
  await page.getByRole("button", { name: "Edit", exact: true }).nth(3).click();
  await page.keyboard.press("Alt+2");
  await expect(dock.getByLabel("Track")).toHaveValue("track-4");
  await dock.getByLabel("Track").selectOption({ label: "Bass" });
  const chain = dock.getByRole("region", { name: "Bass devices" });

  // Arrow keys move a knob; letting go commits one undo step.
  const attack = chain.getByRole("slider", { name: "Attack" });
  const before = await attack.getAttribute("aria-valuenow");
  await attack.focus();
  await page.keyboard.press("ArrowUp");
  await expect(attack).not.toHaveAttribute("aria-valuenow", before!);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(attack).toHaveAttribute("aria-valuenow", before!);

  // Double-click returns a knob to the instrument's own default.
  const cutoff = chain.getByRole("slider", { name: "Cutoff" });
  const factory = await cutoff.getAttribute("aria-valuenow");
  await cutoff.focus();
  await page.keyboard.press("PageUp");
  await expect(cutoff).not.toHaveAttribute("aria-valuenow", factory!);
  await cutoff.dblclick();
  await expect(cutoff).toHaveAttribute("aria-valuenow", factory!);

  // The instrument's switch and the folded Modulation device.
  await chain.getByRole("button", { name: "Bass device enabled" }).click();
  await expect(chain.getByRole("button", { name: "Bass device enabled" })).toHaveAttribute("aria-pressed", "false");
  const modulation = chain.getByRole("button", { name: /^Modulation/ });
  await expect(modulation).toHaveAttribute("aria-expanded", "false");
  await modulation.click();
  await expect(chain.getByRole("slider", { name: "LFO rate" })).toBeVisible();

  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
  ).toEqual([]);
});

test("the dock mixer shows a strip per channel whose fader, knobs and switches edit and undo", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  await page.getByRole("button", { name: "Layout", exact: true }).press("Escape");
  const dock = page.getByRole("region", { name: "Dock" });
  await page.keyboard.press("Alt+3");
  const strip = dock.getByRole("region", { name: "Bass channel" });
  const undo = page.getByRole("button", { name: "Undo", exact: true });

  // The vertical fader moves with the arrow keys; letting go is one undo step.
  const fader = strip.getByRole("slider", { name: "Bass volume" });
  const level = await fader.inputValue();
  await fader.focus();
  await page.keyboard.press("ArrowUp");
  await expect(fader).not.toHaveValue(level);
  await undo.click();
  await expect(fader).toHaveValue(level);

  // Each strip meters peak and RMS.
  await expect(strip.getByRole("meter", { name: "Bass level" })).toHaveAttribute("aria-valuetext", /^Peak .*, RMS /);

  // Pan is a knob; double-click centres it.
  const pan = strip.getByRole("slider", { name: "Pan" });
  await pan.focus();
  await page.keyboard.press("PageDown");
  await expect(pan).not.toHaveAttribute("aria-valuetext", "C");
  await pan.dblclick();
  await expect(pan).toHaveAttribute("aria-valuetext", "C");

  // Mute, solo and the output route are the same edits the classic mixer makes.
  await strip.getByRole("button", { name: "Mute Bass" }).click();
  await expect(strip.getByRole("button", { name: "Mute Bass" })).toHaveAttribute("aria-pressed", "true");
  await strip.getByRole("button", { name: "Solo Bass" }).click();
  await expect(strip.getByRole("button", { name: "Solo Bass" })).toHaveAttribute("aria-pressed", "true");
  await strip.getByLabel("Bass output").selectOption("master");
  await expect(strip.getByLabel("Bass output")).toHaveValue("master");
  await undo.click();
  await expect(strip.getByLabel("Bass output")).not.toHaveValue("master");

  // The master strip mutes the whole mix; buses have their own strips.
  await dock.getByRole("region", { name: "Master channel" }).getByRole("button", { name: "Mute Master" }).click();
  await expect(dock.getByRole("button", { name: "Mute Master" })).toHaveAttribute("aria-pressed", "true");
  await expect(dock.getByRole("region", { name: "Reverb return channel" }).getByRole("slider", { name: "Reverb return volume" })).toBeVisible();

  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
  ).toEqual([]);

  // An insert slot opens that track's device chain.
  await strip.getByRole("list", { name: "Bass insert slots" }).getByRole("button").first().click();
  await expect(dock.getByRole("tab", { name: /^Devices/ })).toHaveAttribute("aria-selected", "true");
  await expect(dock.getByRole("region", { name: "Bass devices" })).toBeVisible();
});

test("the browser searches instruments by family, adds with Enter and swaps with Shift+Enter or a drag", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet", "The inspector is hidden on tablet layouts.");
  await openStudio(page);
  await switchToV2(page);
  await page.getByRole("button", { name: "Layout", exact: true }).press("Escape");
  const browser = page.getByRole("complementary", { name: "Browser" });
  const inspector = page.getByRole("complementary", { name: "Project inspector" });
  const trackCount = inspector.locator(".property-row").filter({ hasText: "Tracks" }).locator("dd");

  // Every catalog instrument is listed, grouped by family; search narrows by name, description or family.
  await expect(browser.getByRole("region", { name: "Drums" })).toBeVisible();
  const all = await browser.locator(".browser-family li").count();
  expect(all).toBeGreaterThanOrEqual(30);
  await browser.getByRole("searchbox", { name: "Search instruments" }).fill("organ");
  await expect(browser.getByRole("button", { name: "Organ", exact: true })).toBeVisible();
  await expect(browser.getByRole("button", { name: "Drum Synth", exact: true })).toHaveCount(0);
  await expect(browser.getByText("Sustained square organ with a quick release.")).toHaveCount(0);
  await browser.getByRole("button", { name: "Organ", exact: true }).click();
  await expect(browser.getByText("Sustained square organ with a quick release.")).toBeVisible();

  // Enter on an instrument adds a track (the keyboard equivalent of dragging it onto the timeline).
  const before = Number(await trackCount.textContent());
  await browser.getByRole("button", { name: "Organ", exact: true }).press("Enter");
  await expect(trackCount).toHaveText(String(before + 1));
  await expect(page.getByRole("button", { name: "Mute Organ" })).toBeVisible();

  // Selecting a clip shows it in the inspector and makes its track the swap target.
  await page.getByRole("button", { name: "Select Bass Generated Loop" }).click();
  const selection = inspector.getByRole("region", { name: "Selection" });
  await expect(selection.getByText("Bass Generated Loop")).toBeVisible();
  await expect(selection.locator(".property-row").filter({ hasText: "Track" }).locator("dd")).toHaveText("Bass");
  const instrument = selection.locator(".property-row").filter({ hasText: "Instrument" }).locator("dd");
  const original = await instrument.textContent();

  // Shift+Enter swaps the selected clip's track to the instrument, as one undo step.
  await browser.getByRole("searchbox", { name: "Search instruments" }).fill("pluck");
  const pluck = browser.locator(".browser-item").first();
  const pluckName = (await pluck.textContent())!.trim();
  await pluck.press("Shift+Enter");
  await expect(instrument).toHaveText(pluckName);
  await expect(trackCount).toHaveText(String(before + 1));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(instrument).toHaveText(original!);

  // Dragging onto a track swaps it; dropping elsewhere on the timeline adds a track.
  await pluck.dragTo(page.locator("[data-track-id]").filter({ hasText: "Bass" }).first());
  await expect(instrument).toHaveText(pluckName);
  await browser.getByRole("searchbox", { name: "Search instruments" }).fill("organ");
  await browser.getByRole("button", { name: "Organ", exact: true }).dragTo(page.getByText(/^Select a clip · Enter/));
  await expect(trackCount).toHaveText(String(before + 2));

  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
  ).toEqual([]);
});

test("the browser adds starter phrases and opens the project's clips", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  await page.getByRole("button", { name: "Layout", exact: true }).press("Escape");
  const browser = page.getByRole("complementary", { name: "Browser" });
  const dock = page.getByRole("region", { name: "Dock" });

  // Project lists the clips; choosing one opens it in the dock's editor.
  await browser.getByRole("tab", { name: "Project" }).click();
  await browser.getByRole("region", { name: "Harmony clips" }).getByRole("button").first().click();
  await expect(dock.getByRole("tab", { name: /^Editor/ })).toHaveAttribute("aria-selected", "true");
  await expect(dock.getByText(/^Harmony · /)).toBeVisible();

  // Patterns adds the chosen instrument's starter phrase to that track as a new clip, then edits it.
  await browser.getByRole("tab", { name: "Patterns" }).click();
  await browser.getByRole("button", { name: "Add to Harmony" }).click();
  await expect(page.getByRole("button", { name: /^Select Warm Pad Starter/ })).toBeVisible();
  await expect(dock.getByText(/^Harmony · Warm Pad Starter/)).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Select Warm Pad Starter/ })).toHaveCount(0);
});

test("the inspector's SynaptixPlay card says whether the music is live in games", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet", "The inspector is hidden on tablet layouts.");
  const card = page.getByRole("complementary", { name: "Project inspector" }).getByRole("region", { name: "SynaptixPlay" });

  // Never published: it says so and opens Adaptive states, where publishing happens.
  await openStudio(page);
  await switchToV2(page);
  await page.getByRole("button", { name: "Layout", exact: true }).press("Escape");
  await expect(card.getByRole("status")).toHaveText("Not in SynaptixPlay yet");
  await card.getByRole("button", { name: "Open Adaptive states" }).click();
  await expect(page.getByRole("heading", { name: "Author adaptive states" })).toBeVisible();
  await page.getByRole("button", { name: "Arrange", exact: true }).click();

  // A package with an active version from an earlier revision: live, with a nudge to publish again.
  const packageId = "10000000-0000-4000-8000-0000000000aa";
  await page.evaluate((id) => localStorage.setItem("synaptix-music:adaptive:v1:visual-baseline", JSON.stringify({ packageId: id })), packageId);
  let available = true;
  await page.route(`**/api/platform/adaptive-packages/${packageId}/versions`, (route) => available
    ? route.fulfill({ json: [
      { version: 1, revisionId: "earlier", projectChecksumSha256: "a".repeat(64), createdAt: "2026-10-01T12:00:00.000Z", retentionStatus: "superseded", expiresAt: null },
      { version: 2, revisionId: "earlier", projectChecksumSha256: "b".repeat(64), createdAt: "2026-10-05T12:00:00.000Z", retentionStatus: "active", expiresAt: null }
    ] })
    : route.fulfill({ status: 503, json: { message: "Platform unavailable" } }));
  await page.getByRole("button", { name: "Adaptive states", exact: true }).click();
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await expect(card.getByRole("status")).toHaveText("Live in SynaptixPlay · version 2");
  await expect(card).toContainText("Games play version 2, published");
  await expect(card).toContainText("The project has changed since.");

  // When the platform can't answer, it says so and can check again.
  available = false;
  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await expect(card.getByRole("status")).toHaveText("Status unavailable");
  available = true;
  await card.getByRole("button", { name: "Check again" }).click();
  await expect(card.getByRole("status")).toHaveText("Live in SynaptixPlay · version 2");
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations
  ).toEqual([]);
});

test("the DAW layout matches its visual baseline", async ({ page }) => {
  await openStudio(page);
  await switchToV2(page);
  await page.getByRole("button", { name: "Layout", exact: true }).press("Escape");
  await page.getByRole("button", { name: "Edit", exact: true }).nth(3).click();
  await page.locator(".studio-hint").evaluate((element) => { element.textContent = ""; });
  // The account control appears after the platform check and changes the status bar's height.
  await expect(page.locator(".studio-status-account")).toContainText("Sign in to SynaptixPlay");
  await expect(page).toHaveScreenshot("v2-arrange-editor.png", {
    animations: "disabled",
    caret: "hide",
    stylePath: resolve("tests/ui/visual.css"),
    maxDiffPixelRatio: 0.002
  });
});
