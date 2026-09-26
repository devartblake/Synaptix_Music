import { expect, test, type Page } from "@playwright/test";

/** A valid 0.1 s silent 16-bit mono WAV. */
function silentWav(): Buffer {
  const samples = 3200;
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(32000, 24); header.writeUInt32LE(64000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function openGenerate(page: Page, enabled: boolean) {
  await page.route("**/api/platform/**", (route) => route.fulfill({ status: 503, json: { message: "Platform unavailable" } }));
  const posts: unknown[] = [];
  let attempt = 0;
  await page.route("**/api/audio-prototype", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: enabled ? { enabled: true, reachable: true, model: "facebook/musicgen-small", loaded: false } : { enabled: false } });
    }
    posts.push(route.request().postDataJSON());
    attempt += 1;
    if (attempt === 1) return route.fulfill({ status: 429, json: { message: "The GPU is busy with another generation. Try again in a moment." } });
    return route.fulfill({
      status: 200,
      body: silentWav(),
      headers: {
        "content-type": "audio/wav",
        "x-synaptix-model": "facebook/musicgen-small",
        "x-synaptix-license": "CC-BY-NC-4.0",
        "x-synaptix-usage": "prototype-only",
        "x-synaptix-duration-seconds": "10.00",
        "x-synaptix-generation-seconds": "12.4"
      }
    });
  });
  await page.goto(`/studio/prototype-${Date.now()}`);
  await expect(page.locator(".studio-title small")).not.toContainText("Loading project");
  await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption("generation");
  return posts;
}

test("prototype audio stays hidden unless the service is configured", async ({ page }) => {
  await openGenerate(page, false);
  await expect(page.getByRole("region", { name: "AI generation workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prototype audio" })).toHaveCount(0);
});

test("prototype audio is labelled non-commercial, explains a busy GPU, and plays the clip", async ({ page }) => {
  const posts = await openGenerate(page, true);
  const panel = page.getByRole("region", { name: "Prototype audio" });
  await expect(panel.getByText("Non-commercial · prototype only")).toBeVisible();
  await expect(panel.getByLabel("Prompt")).toHaveValue(/video game music, \d+ BPM, D minor/);

  await panel.getByRole("button", { name: "Generate prototype audio" }).click();
  await expect(panel.getByRole("alert")).toHaveText("The GPU is busy with another generation. Try again in a moment.");

  await panel.getByRole("button", { name: "Generate prototype audio" }).click();
  await expect(panel.getByLabel("Prototype audio clip")).toBeVisible();
  await expect(panel.getByRole("link", { name: "Download WAV" })).toHaveAttribute("download", "prototype-audio-seed-1.wav");
  await expect(panel.getByText(/10\.00 s from facebook\/musicgen-small in 12\.4 s/)).toBeVisible();
  expect(posts.at(-1)).toMatchObject({ durationSeconds: 10, seed: 1 });
});
