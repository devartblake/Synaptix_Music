import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const screenshot = {
  animations: "disabled" as const,
  caret: "hide" as const,
  stylePath: resolve("tests/ui/visual.css"),
  maxDiffPixelRatio: 0.002
};
test("reviewed home and editor surfaces match visual baselines", async ({ page }) => {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Find or create project" })).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(page).toHaveScreenshot("home.png", { ...screenshot, fullPage: true });
  await page.goto("/studio/visual-baseline");
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; } .studio-topbar { position: static !important; }" });
  const workspace = page.getByRole("region", { name: "Project workspace", exact: true });
  await expect(workspace).toHaveScreenshot("arrangement.png", screenshot);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Select Bass Generated Loop", exact: true })
    .press("Enter");
  await page.locator('[data-note-id="clip-2-note-0-0"]').press("Space");
  await expect(page.getByRole("region", { name: "Piano roll editor" })).toHaveScreenshot(
    "piano.png",
    screenshot
  );
  await page.getByRole("tab", { name: "Arrangement", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Drum step sequencer" })).toHaveScreenshot(
    "drums.png",
    screenshot
  );
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("devices");
  await page.locator(".studio-topbar").evaluate(element => { (element as HTMLElement).style.visibility = "hidden"; });
  await expect(page.getByRole("region", { name: "Devices and effects" })).toHaveScreenshot(
    "devices.png",
    screenshot
  );
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("adaptive");
  await expect(page.getByText("Completed renders are unavailable.", { exact: true })).toBeVisible();
  const adaptive = page.getByRole("region", { name: "Adaptive States authoring workspace" });
  await expect(adaptive).toHaveScreenshot("adaptive.png", screenshot);
});
