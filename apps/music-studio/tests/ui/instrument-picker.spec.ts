import { expect, test } from "@playwright/test";

test("the sidebar shows six instruments and the full list opens in a modal", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "tablet", "The navigation sidebar is hidden on tablet layouts.");
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto(`/studio/picker-${Date.now()}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");

  const sidebar = page.getByRole("group", { name: "Choose an instrument" });
  await expect(sidebar.getByRole("radio")).toHaveCount(6);
  await expect(sidebar.getByRole("radio", { name: "Organ" })).toHaveCount(0);

  await page.getByRole("button", { name: "All instruments (12)" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose an instrument" });
  await expect(dialog.getByRole("radio")).toHaveCount(12);
  await expect(dialog.getByText("Sustained square organ with a quick release.")).toBeVisible();

  // Choosing from the full list closes it and puts the choice in the sidebar.
  await dialog.getByText("Organ", { exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(sidebar.getByRole("radio")).toHaveCount(6);
  await expect(sidebar.getByRole("radio", { name: "Organ" })).toBeChecked();

  const trackCount = page.locator(".property-row").filter({ hasText: "Tracks" }).locator("dd");
  const before = Number(await trackCount.textContent());
  await page.getByRole("button", { name: "Add instrument track" }).click();
  await expect(trackCount).toHaveText(String(before + 1));

  // Escape closes the modal without changing the choice.
  await page.getByRole("button", { name: "All instruments (12)" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(sidebar.getByRole("radio", { name: "Organ" })).toBeChecked();
});
