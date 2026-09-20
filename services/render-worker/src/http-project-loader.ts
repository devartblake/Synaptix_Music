import { MusicProjectSchema, type MusicProject } from "@synaptix/project-model";
import { z } from "zod";

import type { ProjectLoader } from "./worker.ts";

const RevisionResponseSchema = z
  .object({
    project: MusicProjectSchema
  })
  .passthrough();

export interface HttpProjectLoaderOptions {
  baseUrl: string;
  serviceToken: string;
  fetch?: typeof globalThis.fetch;
}

/** Loads one immutable canonical revision through the platform's internal API. */
export class HttpProjectLoader implements ProjectLoader {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly fetchImplementation: typeof globalThis.fetch;

  constructor(options: HttpProjectLoaderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.serviceToken = options.serviceToken;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    if (!this.baseUrl || !this.serviceToken)
      throw new Error("Project-loader base URL and service token are required.");
  }

  async loadProject(projectId: string, revisionId: string): Promise<MusicProject> {
    const response = await this.fetchImplementation(
      `${this.baseUrl}/internal/music/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}`,
      { headers: { "X-Service-Token": this.serviceToken, accept: "application/json" } }
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Platform revision fetch failed with ${response.status}${detail ? `: ${detail}` : "."}`
      );
    }

    const body: unknown = await response.json();
    const project = RevisionResponseSchema.parse(body).project;
    if (project.projectId !== projectId || project.revisionId !== revisionId) {
      throw new Error(
        "Platform revision response identifiers do not match the requested revision."
      );
    }
    return project;
  }
}

export function httpProjectLoaderFromEnv(
  env: NodeJS.ProcessEnv = process.env
): HttpProjectLoader | null {
  const baseUrl = env.SYNAPTIX_PLATFORM_API_URL;
  const serviceToken = env.RENDER_WORKER_SERVICE_TOKEN;
  if (!serviceToken) return null;
  if (!baseUrl) {
    throw new Error(
      "SYNAPTIX_PLATFORM_API_URL and RENDER_WORKER_SERVICE_TOKEN must be configured together."
    );
  }
  return new HttpProjectLoader({ baseUrl, serviceToken });
}
