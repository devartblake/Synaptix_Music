import { expect, test, type Page } from "@playwright/test";

async function openStudio(page: Page, projectId: string) {
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto(`/studio/${projectId}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
}

// The header status pill is hidden on narrow layouts (the banners still show),
// so pill assertions only run where the layout displays it.
async function expectSaveState(page: Page, text: string) {
  const pill = page.locator(".studio-status [aria-label='Save state']");
  if (await pill.isVisible()) await expect(pill).toHaveText(text);
}

test("a failed save is shown, protected on unload, and recovered by retry", async ({ page }) => {
  await openStudio(page, `save-${Date.now()}`);
  await expectSaveState(page, "Saved");

  // Make IndexedDB writes fail, as a full or blocked browser store would.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { __restorePut: () => void }).__restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByRole("spinbutton", { name: "Tempo" }).fill("131");
  await page.getByRole("spinbutton", { name: "Tempo" }).press("Tab");

  const alert = page.getByRole("alert").filter({ hasText: "Your latest changes aren’t saved" });
  await expect(alert).toBeVisible();
  await expectSaveState(page, "Not saved");
  await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("131");

  // Leaving now must ask first.
  let prompted = false;
  page.once("dialog", async (dialog) => {
    prompted = dialog.type() === "beforeunload";
    await dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true }).catch(() => undefined);
  await expect.poll(() => prompted).toBe(true);
});

test("retrying after storage recovers saves the same revision", async ({ page }) => {
  const projectId = `retry-${Date.now()}`;
  await openStudio(page, projectId);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as unknown as { __restorePut: () => void }).__restorePut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  await page.getByRole("spinbutton", { name: "Tempo" }).fill("133");
  await page.getByRole("spinbutton", { name: "Tempo" }).press("Tab");
  await expectSaveState(page, "Not saved");

  await page.evaluate(() => (window as unknown as { __restorePut: () => void }).__restorePut());
  await page.getByRole("button", { name: "Retry save" }).click();
  await expectSaveState(page, "Saved");
  await expect(page.getByRole("alert").filter({ hasText: "aren’t saved" })).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("133");
});

test("a second tab on the same project is read-only until the first closes", async ({
  context
}) => {
  const projectId = `tabs-${Date.now()}`;
  const first = await context.newPage();
  await openStudio(first, projectId);
  const second = await context.newPage();
  await openStudio(second, projectId);

  await expect(second.getByText("This project is open in another tab")).toBeVisible();
  await expectSaveState(second, "Read-only");
  await expect(first.getByText("This project is open in another tab")).toHaveCount(0);

  // Edits in the read-only tab do nothing.
  await second.getByRole("spinbutton", { name: "Tempo" }).fill("140");
  await second.getByRole("spinbutton", { name: "Tempo" }).press("Tab");
  await expectSaveState(second, "Read-only");

  await first.close();
  await expect(second.getByText("This project is open in another tab")).toHaveCount(0, {
    timeout: 10_000
  });
  await expectSaveState(second, "Saved");
});

async function failNextSaves(page: Page) {
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
}

test("unsaved changes left by a closed tab can be restored after reopening", async ({ page }) => {
  const projectId = `recover-${Date.now()}`;
  await openStudio(page, projectId);
  await failNextSaves(page);
  await page.getByRole("spinbutton", { name: "Tempo" }).fill("141");
  await page.getByRole("spinbutton", { name: "Tempo" }).press("Tab");
  await expect(page.getByRole("alert").filter({ hasText: "aren’t saved" })).toContainText(
    "Browser storage is full"
  );

  // Simulate the tab closing: reloading drops the page (and the broken storage).
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("120");
  await expect(page.getByText("Unsaved changes were recovered")).toBeVisible();

  await page.getByRole("button", { name: "Restore changes" }).click();
  await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("141");
  await expectSaveState(page, "Saved");
  await expect(page.getByText("Unsaved changes were recovered")).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("141");
  await expect(page.getByText("Unsaved changes were recovered")).toHaveCount(0);
});

test("recovered changes can be discarded", async ({ page }) => {
  await openStudio(page, `discard-${Date.now()}`);
  await failNextSaves(page);
  await page.getByRole("spinbutton", { name: "Tempo" }).fill("99");
  await page.getByRole("spinbutton", { name: "Tempo" }).press("Tab");
  await expectSaveState(page, "Not saved");
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");

  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Unsaved changes were recovered")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await expect(page.getByText("Unsaved changes were recovered")).toHaveCount(0);
  await expect(page.getByRole("spinbutton", { name: "Tempo" })).toHaveValue("120");
});

test("nearly full browser storage is flagged on home and in the studio", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: { estimate: async () => ({ usage: 900 * 1024 * 1024, quota: 1000 * 1024 * 1024 }) }
    });
  });
  await page.route("**/api/platform/**", (route) =>
    route.fulfill({ status: 503, json: { message: "Platform unavailable" } })
  );
  await page.goto("/");
  await expect(page.getByText("Browser storage is getting full.")).toBeVisible();
  await expect(page.getByText(/900\.0 MB of 1000\.0 MB browser storage used/)).toBeVisible();

  await openStudio(page, `storage-${Date.now()}`);
  await expect(page.getByText("Browser storage is getting full")).toBeVisible();
});
