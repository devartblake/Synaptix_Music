/*
 * The inaudible watermark on exported music (publication-rules-v1, phase 2; EU AI Act Art. 50).
 * Each rendered WAV goes through the platform's /internal/music/watermark before it is transcoded,
 * so MP3, OGG and previews all carry the mark. The platform forwards it to its AudioSeal service and
 * decides the mark's message; this worker only sends audio, with its service token.
 */

export interface AudioWatermarker {
  markWav(wav: Buffer): Promise<Buffer>;
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

/**
 * The platform's watermarker whenever the worker renders for the platform (it has the platform URL
 * and service token). RENDER_WATERMARK=off turns it off for local demos; renders then carry no mark.
 */
export function watermarkerFromEnv(env: NodeJS.ProcessEnv = process.env): HttpWatermarker | null {
  if (env.RENDER_WATERMARK?.trim().toLowerCase() === "off") return null;
  const baseUrl = env.SYNAPTIX_PLATFORM_API_URL;
  const serviceToken = env.RENDER_WORKER_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken) return null;
  return new HttpWatermarker({ baseUrl, serviceToken });
}
