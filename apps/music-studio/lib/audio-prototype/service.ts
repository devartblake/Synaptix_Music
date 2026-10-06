import { NextResponse } from "next/server";

/*
 * Server-side access to the local prototype-audio (MusicGen) service. It's a development tool
 * that's off unless AUDIO_GENERATION_API_URL is set; the browser only ever talks to the
 * studio's own /api/audio-prototype routes.
 */

export function audioServiceUrl(): string | null {
  const value = process.env.AUDIO_GENERATION_API_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

/** Job ids are 32 lowercase hex characters (a UUID without dashes). */
export function isAudioJobId(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}

export const NOT_CONFIGURED = { message: "Prototype audio isn't configured for this studio." };
export const UNREACHABLE = {
  message: "The prototype audio service couldn't be reached. Start it with COMPOSE_PROFILES=local-ai."
};

/** Calls the service, turning "not configured", bad ids and network failures into JSON errors. */
export async function callAudioService(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response | NextResponse> {
  const base = audioServiceUrl();
  if (!base) return NextResponse.json(NOT_CONFIGURED, { status: 404 });
  const { timeoutMs = 15_000, signal, ...rest } = init;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    return await fetch(`${base}${path}`, {
      ...rest,
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
  } catch {
    return NextResponse.json(UNREACHABLE, { status: 502 });
  }
}

/** The service's JSON body, or its `detail` error as `{ message }` with the same status. */
export async function relayJson(response: Response): Promise<NextResponse> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return NextResponse.json(body, { status: response.status, headers: { "cache-control": "no-store" } });
  const message = typeof body.detail === "string" ? body.detail : `Prototype audio failed (${response.status}).`;
  return NextResponse.json({ message }, { status: response.status });
}
