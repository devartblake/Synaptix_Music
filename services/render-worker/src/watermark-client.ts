/*
 * AI marking on exported music (publication-rules-v1, phase 2; EU AI Act Art. 50), done by the
 * platform. This worker only sends audio, with its service token:
 * - the inaudible watermark: each rendered WAV goes through /internal/music/watermark before it is
 *   transcoded, so MP3, OGG and previews all carry it. The platform decides the mark's message.
 * - C2PA content credentials: each WAV, MP3, M4A, MP4 (Opus) and FLAC export goes through the revision's
 *   /content-credentials. The platform states the provenance from its own copy of the revision.
 */

export interface AudioWatermarker {
  markWav(wav: Buffer): Promise<Buffer>;
}

/** Formats the C2PA SDK binds content credentials to (not Ogg). */
export type SignableMediaType = "audio/wav" | "audio/mpeg" | "audio/mp4" | "audio/flac";

export interface ContentCredentialSigner {
  sign(audio: Buffer, mediaType: SignableMediaType, projectId: string, revisionId: string): Promise<Buffer>;
}

export interface HttpWatermarkerOptions {
  baseUrl: string;
  serviceToken: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class HttpWatermarker implements AudioWatermarker {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpWatermarkerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.serviceToken = options.serviceToken;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 5 * 60_000;
    if (!this.baseUrl || !this.serviceToken)
      throw new Error("Watermark base URL and service token are required.");
  }

  async markWav(wav: Buffer): Promise<Buffer> {
    const response = await this.fetchImplementation(`${this.baseUrl}/internal/music/watermark`, {
      method: "POST",
      headers: { "X-Service-Token": this.serviceToken, "content-type": "audio/wav" },
      body: new Uint8Array(wav),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Watermarking failed with ${response.status}${detail ? `: ${detail}` : "."}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

export class HttpContentCredentialSigner implements ContentCredentialSigner {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly fetchImplementation: typeof globalThis.fetch;

  constructor(options: HttpWatermarkerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.serviceToken = options.serviceToken;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    if (!this.baseUrl || !this.serviceToken)
      throw new Error("Content-credential base URL and service token are required.");
  }

  async sign(audio: Buffer, mediaType: SignableMediaType, projectId: string, revisionId: string): Promise<Buffer> {
    const url = `${this.baseUrl}/internal/music/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/content-credentials`;
    const response = await this.fetchImplementation(url, {
      method: "POST",
      headers: { "X-Service-Token": this.serviceToken, "content-type": mediaType },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(5 * 60_000)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Signing content credentials failed with ${response.status}${detail ? `: ${detail}` : "."}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}

/**
 * Who gets the mark (publication-rules-v1, agreed 2026-10-10): every export with any AI involvement,
 * generated or edited, and none for hand-composed projects (their C2PA record says so instead). A
 * project has AI involvement once a generated arrangement was applied to it.
 */
export function watermarkerFor(
  project: { generationMetadata?: unknown },
  watermarker: AudioWatermarker | null
): AudioWatermarker | null {
  return project.generationMetadata ? watermarker : null;
}

export interface AiMarkingServices {
  watermarker: HttpWatermarker;
  signer: HttpContentCredentialSigner;
}

/**
 * The platform's marking services whenever the worker renders for the platform (it has the platform
 * URL and service token). RENDER_AI_MARKING=off turns marking off for local demos; renders then carry
 * no watermark or content credentials.
 */
export function aiMarkingFromEnv(env: NodeJS.ProcessEnv = process.env): AiMarkingServices | null {
  if (env.RENDER_AI_MARKING?.trim().toLowerCase() === "off") return null;
  const baseUrl = env.SYNAPTIX_PLATFORM_API_URL;
  const serviceToken = env.RENDER_WORKER_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken) return null;
  return {
    watermarker: new HttpWatermarker({ baseUrl, serviceToken }),
    signer: new HttpContentCredentialSigner({ baseUrl, serviceToken })
  };
}
