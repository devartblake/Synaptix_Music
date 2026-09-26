import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";

import { HttpProjectLoader, httpProjectLoaderFromEnv } from "./http-project-loader.ts";

test("loads and validates an exact revision with service authentication", async () => {
  const project = createEmptyProject("project-a", { revisionId: "revision-a" });
  let requestedUrl = "";
  let requestedToken: string | null = null;
  const loader = new HttpProjectLoader({
    baseUrl: "https://platform.example/",
    serviceToken: "service-secret",
    fetch: async (input, init) => {
      requestedUrl = input.toString();
      requestedToken = new Headers(init?.headers).get("X-Service-Token");
      return Response.json({ project, checksumSha256: "a".repeat(64) });
    }
  });

  assert.deepEqual(await loader.loadProject("project-a", "revision-a"), project);
  assert.equal(
    requestedUrl,
    "https://platform.example/internal/music/projects/project-a/revisions/revision-a"
  );
  assert.equal(requestedToken, "service-secret");
});

test("fails closed on HTTP errors, schema drift, or identifier mismatch", async () => {
  const unavailable = new HttpProjectLoader({
    baseUrl: "https://platform.example",
    serviceToken: "secret",
    fetch: async () => new Response("denied", { status: 401 })
  });
  await assert.rejects(() => unavailable.loadProject("project-a", "revision-a"), /401: denied/);

  const invalid = new HttpProjectLoader({
    baseUrl: "https://platform.example",
    serviceToken: "secret",
    fetch: async () => Response.json({ project: { schemaVersion: 999 } })
  });
  await assert.rejects(() => invalid.loadProject("project-a", "revision-a"));

  const different = createEmptyProject("different-project", { revisionId: "revision-a" });
  const mismatch = new HttpProjectLoader({
    baseUrl: "https://platform.example",
    serviceToken: "secret",
    fetch: async () => Response.json({ project: different })
  });
  await assert.rejects(() => mismatch.loadProject("project-a", "revision-a"), /identifiers/);
});

test("environment configuration is optional but fails on partial configuration", () => {
  assert.equal(httpProjectLoaderFromEnv({}), null);
  assert.equal(
    httpProjectLoaderFromEnv({ SYNAPTIX_PLATFORM_API_URL: "https://platform.example" }),
    null
  );
  assert.throws(
    () => httpProjectLoaderFromEnv({ RENDER_WORKER_SERVICE_TOKEN: "secret" }),
    /configured together/
  );
  assert.ok(
    httpProjectLoaderFromEnv({
      SYNAPTIX_PLATFORM_API_URL: "https://platform.example",
      RENDER_WORKER_SERVICE_TOKEN: "secret"
    })
  );
});

test("loads Project Schema v2 revisions and still rejects unknown schema versions", async () => {
  const { migrateProjectV1ToV2 } = await import("@synaptix/project-model/v2");
  const project = migrateProjectV1ToV2(createEmptyProject("project-a", { revisionId: "revision-a" }));
  const loader = (body: unknown) => new HttpProjectLoader({
    baseUrl: "https://platform.example", serviceToken: "secret", fetch: async () => Response.json(body)
  });
  assert.deepEqual(await loader({ project }).loadProject("project-a", "revision-a"), project);
  await assert.rejects(loader({ project: { ...project, schemaVersion: 3 } }).loadProject("project-a", "revision-a"));
});
