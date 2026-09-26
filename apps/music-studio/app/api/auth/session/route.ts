import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  PLATFORM_DEVICE_COOKIE,
  PLATFORM_PROFILE_COOKIE,
  PLATFORM_SESSION_COOKIE,
  sessionCookieOptions,
  sessionProfile,
  sessionToken,
  tokenExpiresAt
} from "../../../../lib/platform/platform-session";

export const runtime = "nodejs";

const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const SignInSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(512)
});

const LoginResponseSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().positive(),
  user: z.object({ handle: z.string(), email: z.string() }).passthrough()
});

function platformBaseUrl(): string | null {
  const value = process.env.SYNAPTIX_PLATFORM_API_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

function status(request: NextRequest) {
  const token = sessionToken(request);
  const profile = sessionProfile(request);
  return token && profile
    ? { signedIn: true as const, profile, expiresAt: new Date(tokenExpiresAt(token)! * 1000).toISOString() }
    : { signedIn: false as const };
}

function error(message: string, statusCode: number) {
  return NextResponse.json({ signedIn: false, message }, { status: statusCode });
}

export function GET(request: NextRequest): NextResponse {
  return NextResponse.json(status(request), { headers: { "cache-control": "no-store" } });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const base = platformBaseUrl();
  if (!base) return error("The SynaptixPlay platform isn't configured for this studio.", 503);

  const parsed = SignInSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return error("Enter your email address and password.", 400);

  const deviceId = request.cookies.get(PLATFORM_DEVICE_COOKIE)?.value || `music-studio-${crypto.randomUUID()}`;
  let response: Response;
  try {
    response = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: parsed.data.email, password: parsed.data.password, deviceId }),
      cache: "no-store"
    });
  } catch {
    return error("SynaptixPlay couldn't be reached. Check that the platform is running, then try again.", 502);
  }
  if (response.status === 401 || response.status === 400)
    return error("That email and password don't match a SynaptixPlay account.", 401);
  if (response.status === 429) return error("Too many sign-in attempts. Wait a minute, then try again.", 429);
  if (!response.ok) return error(`SynaptixPlay couldn't sign you in (error ${response.status}).`, 502);

  const login = LoginResponseSchema.safeParse(await response.json().catch(() => null));
  if (!login.success) return error("SynaptixPlay returned an unexpected sign-in response.", 502);

  const profile = { handle: login.data.user.handle, email: login.data.user.email };
  const expiresAt = tokenExpiresAt(login.data.accessToken) ?? Date.now() / 1000 + login.data.expiresIn;
  const maxAge = expiresAt - Date.now() / 1000;
  const result = NextResponse.json(
    { signedIn: true, profile, expiresAt: new Date(expiresAt * 1000).toISOString() },
    { headers: { "cache-control": "no-store" } }
  );
  result.cookies.set(PLATFORM_SESSION_COOKIE, login.data.accessToken, sessionCookieOptions(request, maxAge));
  result.cookies.set(PLATFORM_PROFILE_COOKIE, JSON.stringify(profile), sessionCookieOptions(request, maxAge));
  result.cookies.set(PLATFORM_DEVICE_COOKIE, deviceId, sessionCookieOptions(request, DEVICE_COOKIE_MAX_AGE));
  return result;
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const base = platformBaseUrl();
  const token = sessionToken(request);
  const deviceId = request.cookies.get(PLATFORM_DEVICE_COOKIE)?.value;
  if (base && token && deviceId) {
    // Best effort: end the platform session too. Signing out locally never depends on it.
    await fetch(`${base}/api/v1/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId }),
      cache: "no-store"
    }).catch(() => undefined);
  }
  const result = NextResponse.json({ signedIn: false });
  result.cookies.set(PLATFORM_SESSION_COOKIE, "", sessionCookieOptions(request, 0));
  result.cookies.set(PLATFORM_PROFILE_COOKIE, "", sessionCookieOptions(request, 0));
  return result;
}
