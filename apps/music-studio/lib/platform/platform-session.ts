/**
 * The studio's SynaptixPlay sign-in session, held only by the studio's server.
 *
 * The platform issues short-lived bearer tokens. The studio keeps the access token in an
 * HttpOnly cookie that page scripts cannot read, and its /api/platform proxy routes turn that
 * cookie into the `Authorization` header the platform expects. Browser cookies are never
 * forwarded to the platform.
 */

export const PLATFORM_SESSION_COOKIE = "synaptix_platform_session";
export const PLATFORM_PROFILE_COOKIE = "synaptix_platform_profile";
export const PLATFORM_DEVICE_COOKIE = "synaptix_platform_device";

/** Leeway so a token isn't sent moments before it expires mid-request. */
const EXPIRY_LEEWAY_SECONDS = 15;

export interface PlatformProfile {
  handle: string;
  email: string;
}

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

interface RequestLike {
  headers: Headers;
  cookies: CookieReader;
}

/** Reads a JWT's `exp` claim (seconds since epoch). The platform verifies the signature. */
export function tokenExpiresAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
}

export function isTokenCurrent(token: string, nowSeconds = Date.now() / 1000): boolean {
  const expiresAt = tokenExpiresAt(token);
  return expiresAt !== null && expiresAt - EXPIRY_LEEWAY_SECONDS > nowSeconds;
}

/** The signed-in access token, if there is one and it has not expired. */
export function sessionToken(request: RequestLike): string | null {
  const token = request.cookies.get(PLATFORM_SESSION_COOKIE)?.value;
  return token && isTokenCurrent(token) ? token : null;
}

/**
 * The `Authorization` header to send to the platform: an explicit bearer header from the
 * caller (used by service clients and tests), otherwise the signed-in session.
 */
export function platformAuthorization(request: RequestLike): string | null {
  const explicit = request.headers.get("authorization");
  if (explicit) return explicit;
  const token = sessionToken(request);
  return token ? `Bearer ${token}` : null;
}

export function sessionProfile(request: RequestLike): PlatformProfile | null {
  const raw = request.cookies.get(PLATFORM_PROFILE_COOKIE)?.value;
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PlatformProfile>;
    return typeof value.handle === "string" && typeof value.email === "string"
      ? { handle: value.handle, email: value.email }
      : null;
  } catch {
    return null;
  }
}

/** Cookie options: HttpOnly, same-site, and Secure whenever the studio is served over HTTPS. */
export function sessionCookieOptions(request: RequestLike, maxAgeSeconds: number) {
  const forwarded = request.headers.get("x-forwarded-proto");
  const secure = forwarded ? forwarded.split(",")[0]!.trim() === "https" : process.env.NODE_ENV === "production" && !isLocalhost(request);
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: Math.max(0, Math.floor(maxAgeSeconds)) };
}

function isLocalhost(request: RequestLike): boolean {
  const host = (request.headers.get("host") ?? "").split(":")[0];
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
