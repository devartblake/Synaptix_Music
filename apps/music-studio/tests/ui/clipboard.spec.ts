import { expect, test } from "@playwright/test";

test("notes copy, paste, cut and undo as single steps; Stop sound is available", async ({
  page
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto(`/studio/clipboard-${Date.now()}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");

  await page.getByRole("button", { name: "Select Bass Generated Loop", exact: true }).press("Enter");
  const roll = page.getByRole("region", { name: "Piano roll editor" });
  const notes = roll.locator("[data-note-id]");
  await expect(notes).toHaveCount(64);

  const first = roll.locator('[data-note-id="clip-2-note-0-0"]');
  await first.press("Space");
  await first.press("Control+c");
  await expect(roll.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();

  await first.press("Control+v");
  await expect(notes).toHaveCount(65);
  // The pasted note becomes the selection and sits after the copied one.
  await expect(first).toHaveAttribute("aria-pressed", "false");
  const pasted = roll.locator('[data-note-id][aria-pressed="true"]');
  await expect(pasted).toHaveCount(1);
  expect(Number(await pasted.getAttribute("data-start"))).toBeGreaterThanOrEqual(
    Number(await first.getAttribute("data-start")) + Number(await first.getAttribute("data-duration"))
  );
  expect(await pasted.getAttribute("data-pitch")).toBe(await first.getAttribute("data-pitch"));

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(notes).toHaveCount(64);

  await first.press("Space");
  await first.press("Control+x");
  await expect(notes).toHaveCount(63);
  await roll.getByRole("button", { name: "Paste", exact: true }).click();
  await expect(notes).toHaveCount(64);

  await roll.getByRole("button", { name: "Stop sound" }).click();
  expect(errors).toEqual([]);
});
