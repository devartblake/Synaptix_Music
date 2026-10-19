import { expect, type Page } from "@playwright/test";

// Studio UI v2 (docs/plans/ui/studio-ui-v2.md): the studio has one layout, the DAW layout, since step 9b.

/** Opens Generate (a drawer), Export (a dialog) or the Adaptive states view. */
export async function openWorkspace(page: Page, workspace: "generation" | "render" | "adaptive"): Promise<void> {
  await expect(page.locator(".studio-v2")).toBeVisible();
  const button = { generation: "Generate", render: "Export", adaptive: "Adaptive states" }[workspace];
  await page.getByRole("button", { name: button, exact: true }).click();
}
