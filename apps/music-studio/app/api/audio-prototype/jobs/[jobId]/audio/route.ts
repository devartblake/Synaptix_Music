import { NextResponse } from "next/server";

import { callAudioService, isAudioJobId, relayJson } from "../../../../../../lib/audio-prototype/service";

export const runtime = "nodejs";

const FORWARDED_HEADERS = [
  "x-synaptix-model",
  "x-synaptix-license",
  "x-synaptix-usage",
  "x-synaptix-duration-seconds",
  "x-synaptix-generation-seconds",
  "x-synaptix-seed"
];

/** The finished job's WAV, with its model, licence and timing headers. */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }): Promise<NextResponse> {
  const { jobId } = await params;
  if (!isAudioJobId(jobId)) return NextResponse.json({ message: "This prototype audio job doesn't exist." }, { status: 404 });
  const response = await callAudioService(`/audio/jobs/${jobId}/audio`, { timeoutMs: 60_000 });
  if (response instanceof NextResponse) return response;
  if (!response.ok) return relayJson(response);
  const headers = new Headers({ "content-type": "audio/wav", "cache-control": "no-store" });
  for (const name of FORWARDED_HEADERS) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(await response.arrayBuffer(), { status: 200, headers });
}
