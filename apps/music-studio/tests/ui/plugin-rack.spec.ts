import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("a Reference Drive insert loads, edits with undo/redo, bypasses, and survives reload", async ({ page }) => {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { code: "offline", message: "Platform unavailable", retryable: true } })
  );
  await page.goto(`/studio/plugin-rack-${test.info().project.name}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");

  // Track controls live in a collapsed disclosure on the arrangement timeline.
  await page.getByText("Bass controls", { exact: true }).click();
  const rack = page.getByRole("region", { name: "Bass inserts" });
  await rack.getByRole("button", { name: "Add Reference Drive" }).click();
  await expect(rack.getByText("Active")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".studio-title small")).toContainText("saved locally");

  const drive = rack.getByRole("slider", { name: "Bass Reference Drive Drive" });
  await drive.focus();
  await page.keyboard.press("ArrowRight");
  const edited = await drive.inputValue();
  expect(Number(edited)).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(drive).toHaveValue("1");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(drive).toHaveValue(edited);

  const bypass = page.getByRole("button", { name: "Bypass Reference Drive on Bass" });
  await bypass.click();
  await expect(rack.getByText("Bypassed")).toBeVisible();
  await bypass.click();
  await expect(rack.getByText("Active")).toBeVisible({ timeout: 15_000 });

  const audit = await new AxeBuilder({ page }).include("[aria-label='Bass inserts']")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations).toEqual([]);

  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByText("Bass controls", { exact: true }).click();
  const reloaded = page.getByRole("region", { name: "Bass inserts" });
  await expect(reloaded.getByRole("slider", { name: "Bass Reference Drive Drive" })).toHaveValue(edited);
  await reloaded.getByRole("button", { name: "Remove Reference Drive from Bass" }).click();
  await expect(reloaded.getByText("Reference Drive", { exact: true })).toHaveCount(0);
});
