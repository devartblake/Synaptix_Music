import { expect, type Page } from "@playwright/test";

// Studio UI v2 (docs/plans/ui/studio-ui-v2.md): the DAW layout is the default since step 9b. Until
// the classic layout is removed, the tests for generation, export and adaptive authoring run in both.
export const LAYOUTS = ["classic", "daw"] as const;
export type StudioLayout = (typeof LAYOUTS)[number];

/** The test title for [layout]: unchanged for the classic layout. */
export function titled(title: string, layout: StudioLayout): string {
  return layout === "daw" ? `${title} in the DAW layout` : title;
}

/** Switches to the classic layout (Settings → Classic layout) if the DAW layout is showing. */
export async function useClassicLayout(page: Page): Promise<void> {
  if (!(await page.locator(".studio-v2").isVisible())) return;
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("switch", { name: "Classic layout" }).click();
  await expect(page.locator(".studio-topbar")).toBeVisible();
}

/**
 * Opens a workspace: the Workspace menu in the classic layout (switched to first); in the DAW layout,
 * Generate (a drawer), Export (a dialog) or the Adaptive states view.
 */
export async function openWorkspace(page: Page, layout: StudioLayout, workspace: "generation" | "render" | "adaptive"): Promise<void> {
  if (layout === "classic") {
    await useClassicLayout(page);
    await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption(workspace);
    return;
  }
  await expect(page.locator(".studio-v2")).toBeVisible();
  const button = { generation: "Generate", render: "Export", adaptive: "Adaptive states" }[workspace];
  await page.getByRole("button", { name: button, exact: true }).click();
}
