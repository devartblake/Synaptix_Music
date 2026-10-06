import { NextResponse } from "next/server";

import { callAudioService, isAudioJobId, relayJson } from "../../../../../lib/audio-prototype/service";

export const runtime = "nodejs";

type Context = { params: Promise<{ jobId: string }> };

const NOT_FOUND = { message: "This prototype audio job doesn't exist." };

/** A prototype-audio job's status (also the fallback when live updates aren't available). */
export async function GET(_request: Request, { params }: Context): Promise<NextResponse> {
  const { jobId } = await params;
  if (!isAudioJobId(jobId)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const response = await callAudioService(`/audio/jobs/${jobId}`);
  return response instanceof NextResponse ? response : relayJson(response);
}

/** Cancels a job that hasn't started yet. */
export async function DELETE(_request: Request, { params }: Context): Promise<NextResponse> {
  const { jobId } = await params;
  if (!isAudioJobId(jobId)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const response = await callAudioService(`/audio/jobs/${jobId}`, { method: "DELETE" });
  return response instanceof NextResponse ? response : relayJson(response);
}
