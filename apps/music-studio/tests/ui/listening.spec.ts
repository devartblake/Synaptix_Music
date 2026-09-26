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
  await page.getByRole("link", { name: "Open in Studio" }).click();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await expect(page.getByRole("region", { name: "Mini player" })).toHaveCount(0);
});
