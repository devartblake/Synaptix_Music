import { expect, type Page } from "@playwright/test";

// Studio UI v2 (docs/plans/ui/studio-ui-v2.md): until step 9 removes the classic layout, the tests for
// generation, export and adaptive authoring run in both layouts.
export const LAYOUTS = ["classic", "daw"] as const;
export type StudioLayout = (typeof LAYOUTS)[number];

/** The test title for [layout]: unchanged for the classic layout. */
export function titled(title: string, layout: StudioLayout): string {
  return layout === "daw" ? `${title} in the DAW layout` : title;
}

/**
 * Opens a workspace: the Workspace menu in the classic layout; in the DAW layout, Generate (a drawer),
 * Export (a dialog) or the Adaptive states view. The DAW layout is chosen first if it isn't already.
 */
export async function openWorkspace(page: Page, layout: StudioLayout, workspace: "generation" | "render" | "adaptive"): Promise<void> {
  if (layout === "classic") {
    await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption(workspace);
    return;
  }
  if (!(await page.locator(".studio-v2").isVisible())) {
    await page.getByRole("button", { name: "Layout", exact: true }).click();
    await page.getByRole("button", { name: "DAW layout (preview)" }).click();
    await expect(page.locator(".studio-v2")).toBeVisible();
  }
  const button = { generation: "Generate", render: "Export", adaptive: "Adaptive states" }[workspace];
  await page.getByRole("button", { name: button, exact: true }).click();
}
