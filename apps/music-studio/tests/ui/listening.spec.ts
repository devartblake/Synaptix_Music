import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the library plays a project, keeps playing across pages, and hands audio to the studio", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { code: "offline", message: "Platform unavailable", retryable: true } })
  );
  const projectId = `listening-${test.info().project.name}`;
  // Seed a saved project: the studio stores the starter arrangement after an edit.
  await page.goto(`/studio/${projectId}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  const tempo = page.getByRole("spinbutton", { name: "Tempo" });
  await tempo.fill("110");
  await tempo.press("Enter");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");

  await page.goto(`/library/${projectId}`);
  await page.getByRole("button", { name: "Play mix" }).click();
  const mini = page.getByRole("region", { name: "Mini player" });
  await expect(mini.getByRole("button", { name: "Pause", exact: true })).toBeVisible({ timeout: 20_000 });

  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);

  // Client-side navigation keeps the same playback session.
  await page.getByRole("link", { name: "Back to Library" }).click();
  await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  await expect(mini.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  await mini.getByRole("button", { name: /^Open Now Playing/ }).click();
  const sheet = page.getByRole("dialog", { name: "Now playing" });
  await expect(sheet.getByRole("slider", { name: "Playback position" })).not.toHaveValue("0", { timeout: 10_000 });
  await sheet.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(mini.getByRole("button", { name: "Play", exact: true })).toBeAttached();
  await sheet.getByRole("button", { name: "Close Now Playing" }).click();

  // Opening the studio releases the player; the studio has its own transport.
  await mini.getByRole("button", { name: "Play", exact: true }).click();
  await page.goto(`/library/${projectId}`);
  await page.getByRole("link", { name: "Edit in Studio" }).click();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await expect(page.getByRole("region", { name: "Mini player" })).toHaveCount(0);
});

test("Open in Studio continues editing from the listening position", async ({ page }) => {
  test.setTimeout(120_000);
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { code: "offline", message: "Platform unavailable", retryable: true } })
  );
  const projectId = `handoff-${test.info().project.name}`;
  await page.goto(`/studio/${projectId}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  const tempo = page.getByRole("spinbutton", { name: "Tempo" });
  await tempo.fill("118");
  await tempo.press("Enter");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");

  await page.goto(`/library/${projectId}`);
  await page.getByRole("button", { name: "Play mix" }).click();
  const mini = page.getByRole("region", { name: "Mini player" });
  await mini.getByRole("button", { name: /^Open Now Playing/ }).click();
  const sheet = page.getByRole("dialog", { name: "Now playing" });
  const slider = sheet.getByRole("slider", { name: "Playback position" });
  await expect.poll(async () => Number(await slider.inputValue()), { timeout: 20_000 }).toBeGreaterThan(2);
  await sheet.getByRole("button", { name: "Pause", exact: true }).click();
  const seconds = Number(await slider.inputValue());
  await expect(sheet.getByRole("link", { name: "Open in Studio" })).toHaveAttribute("href", /\?t=\d+\.\d$/);

  await sheet.getByRole("link", { name: "Open in Studio" }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/${projectId}$`));
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  // At 118 BPM a beat is 60/118 s (960 ticks); the studio starts on the beat at or before it.
  const position = page.locator("[aria-label='Playback position'][data-tick]");
  await expect.poll(async () => Number(await position.getAttribute("data-tick")), { timeout: 10_000 }).toBeGreaterThan(0);
  const tick = Number(await position.getAttribute("data-tick"));
  expect(tick % 960).toBe(0);
  expect(tick).toBe(Math.floor(Number(seconds.toFixed(1)) / (60 / 118)) * 960);
});
