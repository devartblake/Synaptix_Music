import type {
  PlatformProjectRepository,
  PlatformProjectSummary,
  PlatformRevisionEnvelope,
  RevisionUploadResult
} from "@synaptix/project-storage/platform-sync";

export function extractErrorMessage(body: string, status: number): string {
  if (!body) return `Platform project request failed with ${status}.`;
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.length > 0) return parsed.message;
  } catch {
    // Not a JSON error envelope; fall through to the raw body.
  }
  return body;
}

function requireOk(response: Response): Promise<Response> {
  if (response.ok) return Promise.resolve(response);
  return response.text().then((body) => {
    throw new Error(extractErrorMessage(body, response.status));
  });
}

function normalizeOutcome(value: unknown): RevisionUploadResult {
  if (!value || typeof value !== "object") throw new Error("Invalid revision upload response.");
  const record = value as Record<string, unknown>;
  const raw = String(record.outcome ?? "");
  const outcome = raw.length > 0 ? `${raw[0]?.toLowerCase()}${raw.slice(1)}` : raw;
  const currentRevisionId = String(record.currentRevisionId ?? "");
  if (outcome === "accepted" || outcome === "alreadyCurrent") {
    return { outcome, currentRevisionId };
  }
  if (outcome === "conflict") {
    return {
      outcome,
      expectedRevisionId: String(record.expectedRevisionId ?? ""),
      currentRevisionId,
      remote: record.remote as PlatformRevisionEnvelope
    };
  }
  throw new Error(`Unsupported revision upload outcome '${raw}'.`);
}

export class HttpPlatformProjectRepository implements PlatformProjectRepository {
  constructor(private readonly baseUrl = "/api/platform/projects") {}

  async listProjects(): Promise<PlatformProjectSummary[]> {
    const response = await requireOk(await fetch(this.baseUrl, { credentials: "include" }));
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) throw new Error("Invalid project-list response.");
    return body as PlatformProjectSummary[];
  }

  async getProject(projectId: string): Promise<PlatformRevisionEnvelope | null> {
    const response = await fetch(`${this.baseUrl}/${encodeURIComponent(projectId)}`, {
      credentials: "include"
    });
    if (response.status === 404) return null;
    await requireOk(response);
    return (await response.json()) as PlatformRevisionEnvelope;
  }

  async uploadRevision(
    envelope: PlatformRevisionEnvelope,
    expectedRevisionId: string | null,
    idempotencyKey: string
  ): Promise<RevisionUploadResult> {
    const revisionId = envelope.revision.revisionId;
    const headers = new Headers({
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    });
    if (expectedRevisionId) headers.set("If-Match", `\"${expectedRevisionId}\"`);

    const response = await fetch(
      `${this.baseUrl}/${encodeURIComponent(envelope.projectId)}/revisions/${encodeURIComponent(revisionId)}`,
      {
        method: "PUT",
        credentials: "include",
        headers,
        body: JSON.stringify({
          projectId: envelope.projectId,
          revisionId,
          parentRevisionId: envelope.revision.parentRevisionId,
          name: envelope.project.metadata.name,
          checksumSha256: envelope.revision.checksumSha256,
          revision: envelope.revision,
          project: envelope.project
        })
      }
    );
    if (response.status !== 409) await requireOk(response);
    return normalizeOutcome(await response.json());
  }
}
