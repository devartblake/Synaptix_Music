import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openMixer(page: Page) {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "offline", message: "Platform unavailable", retryable: true }
    })
  );
  await page.goto("/studio/mixer-test");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  return page.getByRole("region", { name: "Mixer", exact: true });
}

test("mixer keyboard controls support undo, redo, and local reload", async ({ page }) => {
  const mixer = await openMixer(page);
  const volume = mixer.getByRole("slider", { name: "Drums volume", exact: true });
  const initial = Number(await volume.inputValue());
  await volume.focus();
  await volume.press("ArrowRight");
  await expect(volume).toBeEnabled();
  await expect(volume).toHaveValue(String(initial + 1));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(volume).toHaveValue(String(initial));
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(volume).toHaveValue(String(initial + 1));

  await mixer.getByRole("button", { name: "Mute Drums", exact: true }).click();
  await expect(mixer.getByRole("button", { name: "Mute Drums", exact: true })).toBeEnabled();
  await expect(mixer.getByRole("button", { name: "Mute Drums", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await mixer.getByRole("button", { name: "Solo Bass", exact: true }).click();
  await expect(mixer.getByRole("button", { name: "Solo Bass", exact: true })).toBeEnabled();
  const pan = mixer.getByRole("slider", { name: "Bass pan", exact: true });
  await pan.focus();
  await pan.press("ArrowRight");
  await expect(pan).toBeEnabled();
  const finalPan = await pan.inputValue();

  await page.reload();
  await expect(mixer).toBeVisible();
  await expect(volume).toHaveValue(String(initial + 1));
  await expect(pan).toHaveValue(finalPan);
  await expect(mixer.getByRole("button", { name: "Mute Drums", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(mixer.getByRole("button", { name: "Solo Bass", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await mixer.getByRole("button", { name: "Close mixer" }).click();
  await expect(page.getByRole("button", { name: "Mixer", exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole("button", { name: "Mixer", exact: true })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
});

test("a pointer fader gesture creates one undo step", async ({ page }) => {
  const mixer = await openMixer(page);
  const volume = mixer.getByRole("slider", { name: "Drums volume", exact: true });
  const initial = await volume.inputValue();
  const bounds = await volume.boundingBox();
  if (!bounds) throw new Error("Volume fader is not visible");
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(volume).toBeEnabled();
  await expect(volume).not.toHaveValue(initial);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(volume).toHaveValue(initial);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("mixer is accessible and workspace navigation remains available on phones", async ({
  page
}, testInfo) => {
  const mixer = await openMixer(page);
  await expect(mixer.getByRole("region", { name: "Master output meter" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("mixer.png"), fullPage: true });
  await mixer.getByRole("button", { name: "Close mixer" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("generation");
  await expect(page.getByRole("heading", { name: "Create a project variation" })).toBeVisible();
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("arrangement");
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  await expect(mixer).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mixer-mobile.png"), fullPage: true });
});
