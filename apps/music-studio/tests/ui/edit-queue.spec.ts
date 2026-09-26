import { expect, test } from "@playwright/test";

// Regression: an edit made while the previous one was still being saved used to be dropped
// silently (the history refuses overlapping operations). Edits now queue and all apply.
test("edits made in quick succession all apply, and undo reverses them in order", async ({ page }) => {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto(`/studio/edit-queue-${Date.now()}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("button", { name: "Mixer", exact: true }).click();
  const mixer = page.getByRole("region", { name: "Mixer", exact: true });
  const drums = mixer.getByRole("button", { name: "Mute Drums bus", exact: true });
  const music = mixer.getByRole("button", { name: "Mute Music bus", exact: true });
  await expect(drums).toHaveAttribute("aria-pressed", "false");

  // Both clicks land in the same task, before the first edit has finished saving.
  await page.evaluate(() => {
    const button = (name: string) =>
      document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
    button("Mute Drums bus").click();
    button("Mute Music bus").click();
  });
  await expect(drums).toHaveAttribute("aria-pressed", "true");
  await expect(music).toHaveAttribute("aria-pressed", "true");

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  await expect(music).toHaveAttribute("aria-pressed", "false");
  await expect(drums).toHaveAttribute("aria-pressed", "true");
  await undo.click();
  await expect(drums).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(drums).toHaveAttribute("aria-pressed", "true");
  await expect(music).toHaveAttribute("aria-pressed", "false");
});
