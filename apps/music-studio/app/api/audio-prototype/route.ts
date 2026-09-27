import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Prototype text-to-audio (MusicGen) on a local GPU service. MusicGen weights are CC-BY-NC 4.0,
 * so this is a local development tool: it's off unless AUDIO_GENERATION_API_URL is set, and
 * its audio is never published, packaged or saved into projects.
 */
function serviceUrl(): string | null {
  const value = process.env.AUDIO_GENERATION_API_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

const FORWARDED_HEADERS = [
  "x-synaptix-model",
  "x-synaptix-license",
  "x-synaptix-usage",
  "x-synaptix-duration-seconds",
  "x-synaptix-generation-seconds",
  "x-synaptix-seed"
];

export async function GET(): Promise<NextResponse> {
  const base = serviceUrl();
  if (!base) return NextResponse.json({ enabled: false });
  try {
    const response = await fetch(`${base}/readyz`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    return NextResponse.json({ enabled: true, reachable: response.ok, ...(await response.json()) });
  } catch {
    return NextResponse.json({ enabled: true, reachable: false });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const base = serviceUrl();
  if (!base) {
    return NextResponse.json({ message: "Prototype audio isn't configured for this studio." }, { status: 404 });
  }
  let response: Response;
  try {
    response = await fetch(`${base}/audio/generations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      cache: "no-store",
      // Loading the model on first use and generating 30 s can take a few minutes on a laptop GPU.
      signal: AbortSignal.timeout(300_000)
    });
  } catch {
    return NextResponse.json(
      { message: "The prototype audio service couldn't be reached. Start it with COMPOSE_PROFILES=local-ai." },
      { status: 502 }
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: unknown };
    const message = typeof body.detail === "string" ? body.detail : `Prototype audio failed (${response.status}).`;
    return NextResponse.json({ message }, { status: response.status });
  }
  const headers = new Headers({ "content-type": "audio/wav", "cache-control": "no-store" });
  for (const name of FORWARDED_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(await response.arrayBuffer(), { status: 200, headers });
}
