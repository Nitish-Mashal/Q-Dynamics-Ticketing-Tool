import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export interface AccessTokenPayload {
  sub: string;
  email?: string;
  role?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  session_id?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  phone?: string;
  [key: string]: unknown;
}

const SECRET = process.env.SUPABASE_JWT_SECRET ?? "quantumberg-local-dev-secret-change-me";
const ISSUER = "supabase";
const AUDIENCE = "authenticated";
const ACCESS_TTL_SECONDS = Number(process.env.SUPABASE_ACCESS_TTL ?? 3600);
const REFRESH_TTL_SECONDS = Number(process.env.SUPABASE_REFRESH_TTL ?? 60 * 60 * 24 * 30);

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(input: string): Buffer {
  return createHmac("sha256", SECRET).update(input).digest();
}

export function signAccessToken(payload: AccessTokenPayload): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TTL_SECONDS;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ ...payload, iss: ISSUER, aud: AUDIENCE, iat: now, exp, role: "authenticated" }),
  );
  const signature = hmac(`${header}.${body}`).toString("base64url");
  return { token: `${header}.${body}.${signature}`, expiresAt: exp };
}

export function signRefreshToken(userId: string): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + REFRESH_TTL_SECONDS;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ sub: userId, type: "refresh", iss: ISSUER, aud: "refresh", iat: now, exp }),
  );
  const signature = hmac(`${header}.${body}`).toString("base64url");
  return { token: `${header}.${body}.${signature}`, expiresAt: exp };
}

export type JwtVerification =
  | { ok: true; payload: AccessTokenPayload }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

export function verifyToken(token: string): JwtVerification {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [header, body, signature] = parts;
  const expected = hmac(`${header}.${body}`).toString("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature" };
  let payload: AccessTokenPayload & { exp?: number };
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp === "number" && payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export const jwtSecret = SECRET;
export const accessTtl = ACCESS_TTL_SECONDS;
