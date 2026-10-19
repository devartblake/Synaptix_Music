import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The DAW layout's dock mixer (Studio UI v2, step 6); the default layout since step 9b.
async function openMixer(page: Page) {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "offline", message: "Platform unavailable", retryable: true }
    })
  );
  await page.goto("/studio/mixer-test");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  const dock = page.getByRole("region", { name: "Dock" });
  await dock.getByRole("tab", { name: /^Mixer/ }).click();
  return dock.getByRole("group", { name: "Mixer channels" });
}

test("mixer keyboard controls support undo, redo, and local reload", async ({ page }) => {
  const mixer = await openMixer(page);
  const volume = mixer.getByRole("slider", { name: "Drums volume", exact: true });
  const initial = Number(await volume.inputValue());
  await volume.focus();
  await volume.press("ArrowUp");
  await expect(volume).toBeEnabled();
  await expect(volume).toHaveValue(String(initial + 1));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(volume).toHaveValue(String(initial));
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(volume).toHaveValue(String(initial + 1));

  await mixer.getByRole("button", { name: "Mute Drums", exact: true }).click();
  await expect(mixer.getByRole("button", { name: "Mute Drums", exact: true })).toHaveAttribute("aria-pressed", "true");
  await mixer.getByRole("button", { name: "Solo Bass", exact: true }).click();
  await expect(mixer.getByRole("button", { name: "Solo Bass", exact: true })).toHaveAttribute("aria-pressed", "true");
  const pan = mixer.getByRole("region", { name: "Bass channel" }).getByRole("slider", { name: "Pan" });
  await pan.focus();
  await pan.press("ArrowRight");
  await page.keyboard.press("Tab");
  const finalPan = await pan.getAttribute("aria-valuenow");
  expect(finalPan).not.toBeNull();

  // The edits are saved with the project, and the dock reopens on the Mixer tab.
  await page.reload();
  await expect(mixer).toBeVisible();
  await expect(volume).toHaveValue(String(initial + 1));
  await expect(pan).toHaveAttribute("aria-valuenow", finalPan!);
  await expect(mixer.getByRole("button", { name: "Mute Drums", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(mixer.getByRole("button", { name: "Solo Bass", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("a pointer fader gesture creates one undo step", async ({ page }) => {
  const mixer = await openMixer(page);
  const volume = mixer.getByRole("slider", { name: "Drums volume", exact: true });
  const initial = await volume.inputValue();
  const bounds = await volume.boundingBox();
  if (!bounds) throw new Error("Volume fader is not visible");
  // The fader is vertical: drag down from the middle.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.75, { steps: 8 });
  await page.mouse.up();
  await expect(volume).toBeEnabled();
  await expect(volume).not.toHaveValue(initial);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(volume).toHaveValue(initial);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("mixer is accessible and stays reachable on phones", async ({ page }, testInfo) => {
  const mixer = await openMixer(page);
  await expect(mixer.getByRole("region", { name: "Master channel" }).getByRole("region", { name: "Master output meter" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("mixer.png"), fullPage: true });

  // On a phone the strips scroll sideways inside the dock; the page itself doesn't.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(mixer.getByRole("slider", { name: "Drums volume", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mixer-mobile.png"), fullPage: true });
});
