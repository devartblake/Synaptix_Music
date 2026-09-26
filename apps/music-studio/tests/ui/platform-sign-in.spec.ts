import { expect, test } from "@playwright/test";

test("signing in to SynaptixPlay shows the player, explains failures, and signs out", async ({ page }) => {
  let signedIn = false;
  const posts: unknown[] = [];
  await page.route("**/api/auth/session", async (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const body = route.request().postDataJSON() as { password: string };
      posts.push(body);
      if (body.password !== "right-password")
        return route.fulfill({ status: 401, json: { signedIn: false, message: "That email and password don't match a SynaptixPlay account." } });
      signedIn = true;
    }
    if (method === "DELETE") signedIn = false;
    return route.fulfill({
      json: signedIn
        ? { signedIn: true, profile: { handle: "composer", email: "c@example.com" }, expiresAt: new Date(Date.now() + 480_000).toISOString() }
        : { signedIn: false }
    });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in to SynaptixPlay" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in to SynaptixPlay" });
  await dialog.getByLabel("Email").fill("c@example.com");
  await dialog.getByLabel("Password").fill("wrong");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("That email and password don't match a SynaptixPlay account.");

  await dialog.getByLabel("Password").fill("right-password");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("composer", { exact: true })).toBeVisible();
  expect(posts).toHaveLength(2);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in to SynaptixPlay" })).toBeVisible();
});

test("an expired session asks to sign in again", async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: { signedIn: true, profile: { handle: "composer", email: "c@example.com" }, expiresAt: new Date(Date.now() + 1_500).toISOString() }
    })
  );
  await page.goto("/");
  await expect(page.getByText("composer", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in again" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("status").filter({ hasText: "Session ended" })).toBeVisible();
});
