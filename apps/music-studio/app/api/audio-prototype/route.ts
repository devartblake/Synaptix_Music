import { NextRequest, NextResponse } from "next/server";

import { audioServiceUrl, callAudioService, relayJson } from "../../../lib/audio-prototype/service";

export const runtime = "nodejs";

/**
 * Prototype text-to-audio (MusicGen) on a local GPU service. MusicGen weights are CC-BY-NC 4.0,
 * so this is a local development tool: it's off unless AUDIO_GENERATION_API_URL is set, and
 * its audio is never published, packaged or saved into projects.
 *
 * Generations are queued jobs: POST submits one, then the studio follows
 * /api/audio-prototype/jobs/{jobId}/events (live progress) and fetches .../audio when done.
 */

export async function GET(): Promise<NextResponse> {
  const base = audioServiceUrl();
  if (!base) return NextResponse.json({ enabled: false });
  try {
    const response = await fetch(`${base}/readyz`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return NextResponse.json({ enabled: true, reachable: response.ok, ...(await response.json()) });
  } catch {
    return NextResponse.json({ enabled: true, reachable: false });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = await callAudioService("/audio/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text()
  });
  return response instanceof NextResponse ? response : relayJson(response);
}
