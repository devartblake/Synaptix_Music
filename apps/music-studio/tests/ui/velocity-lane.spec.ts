import { expect, test } from "@playwright/test";

test("velocity lane bars drag and step note velocities, each as one undo step", async ({ page }) => {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto(`/studio/velocity-${Date.now()}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("button", { name: "Select Bass Generated Loop", exact: true }).press("Enter");

  const roll = page.getByRole("region", { name: "Piano roll editor" });
  const lane = roll.getByRole("group", { name: "Note velocities" });
  const bars = lane.locator("[data-velocity-note-id]");
  await expect(bars).toHaveCount(64);

  const noteId = "clip-2-note-0-0";
  const bar = lane.locator(`[data-velocity-note-id="${noteId}"]`);
  const note = roll.locator(`[data-note-id="${noteId}"]`);
  const original = await note.getAttribute("data-velocity");

  // Drag the bar to the top of the lane: maximum velocity.
  const box = (await lane.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height - 2);
  await page.mouse.down();
  await page.mouse.move(barBox.x + barBox.width / 2, box.y - 20, { steps: 4 });
  await page.mouse.up();
  await expect(note).toHaveAttribute("data-velocity", "127");

  // Drag it to the bottom: minimum velocity.
  const top = (await bar.boundingBox())!;
  await page.mouse.move(top.x + top.width / 2, top.y + 2);
  await page.mouse.down();
  await page.mouse.move(top.x + top.width / 2, box.y + box.height + 20, { steps: 4 });
  await page.mouse.up();
  await expect(note).toHaveAttribute("data-velocity", "1");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(note).toHaveAttribute("data-velocity", "127");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(note).toHaveAttribute("data-velocity", original!);

  // Keyboard: up/down step by 1, Shift by 10.
  await bar.focus();
  await bar.press("ArrowDown");
  await expect(note).toHaveAttribute("data-velocity", String(Number(original) - 1));
  await bar.press("Shift+ArrowDown");
  await expect(note).toHaveAttribute("data-velocity", String(Number(original) - 11));
  await expect(bar).toHaveAccessibleName(new RegExp(`velocity ${Number(original) - 11}$`));
});
