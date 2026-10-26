import { createHash, timingSafeEqual } from "node:crypto";
import type { LocalDb } from "./db";
import { accessTtl, newOpaqueToken, signAccessToken, signRefreshToken, verifyToken, type AccessTokenPayload } from "./jwt";

export interface AuthCall {
  method: string;
  pathname: string;
  search: URLSearchParams;
  body: Record<string, unknown>;
  authorization: string | undefined;
  ip: string;
}

export interface AuthResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly payload: Record<string, unknown>,
  ) {
    super(String(payload.msg ?? payload.message ?? payload.error_description ?? ""));
  }
}

function authErr(status: number, code: string, msg: string): AuthError {
  return new AuthError(status, { code, error_code: code, msg, error_description: msg, error: code });
}

interface UserRow {
  id: string;
  email: string;
  encrypted_password: string;
  email_confirmed_at: Date | null;
  last_sign_in_at: Date | null;
  raw_user_meta_data: Record<string, unknown> | null;
  created_at: Date | null;
  updated_at: Date | null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function toUser(row: UserRow): Record<string, unknown> {
  const confirmed = iso(row.email_confirmed_at);
  return {
    id: row.id,
    aud: "authenticated",
    role: "authenticated",
    email: row.email,
    email_confirmed_at: confirmed,
    confirmed_at: confirmed,
    phone: "",
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    last_sign_in_at: iso(row.last_sign_in_at),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [],
    is_anonymous: false,
  };
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string, limit = 10, windowMs = 60_000): void {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new AuthError(429, {
      code: "over_request_rate_limit",
      error_code: "over_request_rate_limit",
      msg: "Request rate limit reached",
      error_description: "Request rate limit reached",
      error: "over_request_rate_limit",
    });
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function createSession(
  db: LocalDb,
  user: UserRow,
): Promise<Record<string, unknown>> {
  const claims: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    role: "authenticated",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: user.raw_user_meta_data ?? {},
  };
  const access = signAccessToken(claims);
  const refresh = signRefreshToken(user.id);
  const refreshExpiry = new Date(refresh.expiresAt * 1000);
  await db.queryAsSuperuser(
    "insert into auth.refresh_tokens (token, user_id, expires_at) values ($1, $2, $3)",
    [refresh.token, user.id, refreshExpiry.toISOString()],
  );
  await db.queryAsSuperuser("update auth.users set last_sign_in_at = now() where id = $1", [
    user.id,
  ]);
  return {
    access_token: access.token,
    token_type: "bearer",
    expires_in: accessTtl,
    expires_at: access.expiresAt,
    refresh_token: refresh.token,
    user: toUser({ ...user, last_sign_in_at: new Date() }),
  };
}

async function loadUserByEmail(db: LocalDb, email: string): Promise<UserRow | null> {
  const res = await db.queryAsSuperuser<UserRow>(
    "select id, email, encrypted_password, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at, updated_at from auth.users where lower(email) = lower($1)",
    [email],
  );
  return res.rows[0] ?? null;
}

async function passwordMatches(db: LocalDb, user: UserRow, password: string): Promise<boolean> {
  if (!user.encrypted_password) return false;
  const res = await db.queryAsSuperuser<{ ok: boolean }>(
    "select crypt($1, $2) = $2 as ok",
    [password, user.encrypted_password],
  );
  return res.rows[0]?.ok === true;
}

async function requireActiveProfile(db: LocalDb, userId: string): Promise<Record<string, unknown>> {
  const res = await db.queryAsSuperuser<{ is_active: boolean; full_name: string; role: string }>(
    "select is_active, full_name, role from public.profiles where id = $1",
    [userId],
  );
  const profile = res.rows[0];
  if (!profile || !profile.is_active) {
    throw authErr(403, "user_banned", "Your account has been deactivated. Contact the business owner.");
  }
  return profile as unknown as Record<string, unknown>;
}

async function userFromBearer(db: LocalDb, authorization: string | undefined): Promise<UserRow> {
  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) {
    throw authErr(401, "missing_bearer_token", "requires authentication: missing access token");
  }
  const token = authorization.slice(7).trim();
  const verified = verifyToken(token);
  if (!verified.ok) {
    throw authErr(401, "bad_jwt", "invalid JWT");
  }
  if (verified.payload.type === "refresh") {
    throw authErr(401, "bad_jwt", "invalid JWT");
  }
  const sub = typeof verified.payload.sub === "string" ? verified.payload.sub : "";
  if (!sub) throw authErr(401, "bad_jwt", "invalid JWT");
  const res = await db.queryAsSuperuser<UserRow>(
    "select id, email, encrypted_password, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at, updated_at from auth.users where id = $1",
    [sub],
  );
  const user = res.rows[0];
  if (!user) throw authErr(401, "user_not_found", "User from sub claim in JWT does not exist");
  await requireActiveProfile(db, user.id);
  return user;
}

function parseBody(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined || raw === "") return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

function b64urlSha256(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function handleAuth(db: LocalDb, call: AuthCall): Promise<AuthResult> {
  const path = call.pathname.replace(/^\/auth\/v1/, "");
  const body = parseBody(call.body);
  const headers: Record<string, string> = { "api-version": "2024-01-01" };

  try {
    if (path === "/signup" && call.method === "POST") {
      rateLimit(`signup:${call.ip}`);
      const email = str(body.email).trim().toLowerCase();
      const password = str(body.password);
      if (!email || !password) throw authErr(422, "validation_failed", "email and password are required");
      const metadata = (body.data as Record<string, unknown>) ?? {};
      const existing = await loadUserByEmail(db, email);
      if (existing) {
        throw new AuthError(422, {
          code: "user_already_exists",
          error_code: "user_already_exists",
          msg: "User already registered",
          error_description: "User already registered",
          error: "user_already_exists",
        });
      }
      const inserted = await db.queryAsSuperuser<UserRow>(
        `insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
         values ($1, crypt($2, gen_salt('bf')), now(), $3::jsonb, '{"provider":"email","providers":["email"]}'::jsonb, now(), now())
         returning id, email, encrypted_password, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at, updated_at`,
        [email, password, JSON.stringify(metadata)],
      );
      const user = inserted.rows[0];
      const session = await createSession(db, user);
      return { status: 200, body: session, headers };
    }

    if (path === "/token" && call.method === "POST") {
      const grantType = call.search.get("grant_type") ?? "password";

      if (grantType === "password") {
        rateLimit(`password:${call.ip}:${str(body.email).toLowerCase()}`);
        const email = str(body.email);
        const password = str(body.password);
        const user = await loadUserByEmail(db, email);
        if (!user || !(await passwordMatches(db, user, password))) {
          throw authErr(400, "invalid_credentials", "Invalid login credentials");
        }
        await requireActiveProfile(db, user.id);
        const session = await createSession(db, user);
        return { status: 200, body: session, headers };
      }

      if (grantType === "refresh_token") {
        const token = str(body.refresh_token);
        if (!token) throw authErr(400, "refresh_token_not_found", "Invalid Refresh Token");
        const verified = verifyToken(token);
        if (!verified.ok || verified.payload.type !== "refresh") {
          throw authErr(400, "refresh_token_not_found", "Invalid Refresh Token");
        }
        const lookup = await db.queryAsSuperuser<{ user_id: string; expires_at: Date }>(
          "select user_id, expires_at from auth.refresh_tokens where token = $1",
          [token],
        );
        const row = lookup.rows[0];
        if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
          await db.queryAsSuperuser("delete from auth.refresh_tokens where token = $1", [token]);
          throw authErr(400, "refresh_token_not_found", "Invalid Refresh Token");
        }
        const userRes = await db.queryAsSuperuser<UserRow>(
          `select id, email, encrypted_password, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at, updated_at
             from auth.users where id = $1`,
          [row.user_id],
        );
        const user = userRes.rows[0];
        if (!user) throw authErr(400, "refresh_token_not_found", "Invalid Refresh Token");
        await requireActiveProfile(db, user.id);
        await db.queryAsSuperuser("delete from auth.refresh_tokens where token = $1", [token]);
        const session = await createSession(db, user);
        return { status: 200, body: session, headers };
      }

      if (grantType === "pkce") {
        const authCode = str(body.auth_code);
        const verifier = str(body.code_verifier);
        if (!authCode || !verifier) throw authErr(400, "bad_code_verifier", "invalid code exchange");
        const lookup = await db.queryAsSuperuser<{
          user_id: string;
          code_challenge: string | null;
          expires_at: Date;
        }>(
          "select user_id, code_challenge, expires_at from auth.recovery_codes where code = $1",
          [authCode],
        );
        const row = lookup.rows[0];
        if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
          throw authErr(400, "bad_code_verifier", "invalid code exchange");
        }
        if (row.code_challenge && !safeEqual(b64urlSha256(verifier), row.code_challenge)) {
          throw authErr(400, "bad_code_verifier", "invalid code exchange");
        }
        await db.queryAsSuperuser("delete from auth.recovery_codes where code = $1", [authCode]);
        const userRes = await db.queryAsSuperuser<UserRow>(
          `select id, email, encrypted_password, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at, updated_at
             from auth.users where id = $1`,
          [row.user_id],
        );
        const user = userRes.rows[0];
        if (!user) throw authErr(400, "user_not_found", "User not found");
        await requireActiveProfile(db, user.id);
        const session = await createSession(db, user);
        return { status: 200, body: session, headers };
      }

      throw authErr(400, "unsupported_grant_type", `grant type ${grantType} is not supported locally`);
    }

    if (path === "/user" && call.method === "GET") {
      const user = await userFromBearer(db, call.authorization);
      return { status: 200, body: toUser(user), headers };
    }

    if (path === "/user" && call.method === "PUT") {
      const user = await userFromBearer(db, call.authorization);
      const password = str(body.password);
      if (password) {
        await db.queryAsSuperuser(
          "update auth.users set encrypted_password = crypt($1, gen_salt('bf')), updated_at = now() where id = $2",
          [password, user.id],
        );
        const updated = await db.queryAsSuperuser<UserRow>(
          `select id, email, encrypted_password, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at, updated_at
             from auth.users where id = $1`,
          [user.id],
        );
        return { status: 200, body: toUser(updated.rows[0]), headers };
      }
      const metadata = body.user_metadata as Record<string, unknown> | undefined;
      if (metadata) {
        await db.queryAsSuperuser(
          "update auth.users set raw_user_meta_data = $1::jsonb, updated_at = now() where id = $2",
          [JSON.stringify(metadata), user.id],
        );
      }
      const refreshed = await db.queryAsSuperuser<UserRow>(
        `select id, email, encrypted_password, email_confirmed_at, last_sign_in_at, raw_user_meta_data, created_at, updated_at
           from auth.users where id = $1`,
        [user.id],
      );
      return { status: 200, body: toUser(refreshed.rows[0]), headers };
    }

    if (path === "/logout" && call.method === "POST") {
      const authorization = call.authorization;
      if (authorization && authorization.toLowerCase().startsWith("bearer ")) {
        const token = authorization.slice(7).trim();
        const verified = verifyToken(token);
        if (verified.ok && typeof verified.payload.sub === "string") {
          await db.queryAsSuperuser("delete from auth.refresh_tokens where user_id = $1", [
            verified.payload.sub,
          ]);
        }
      }
      return { status: 204, headers };
    }

    if (path === "/recover" && call.method === "POST") {
      rateLimit(`recover:${call.ip}:${str(body.email).toLowerCase()}`);
      const email = str(body.email).trim().toLowerCase();
      const redirect = call.search.get("redirect_to") ?? "http://localhost:5173/";
      const challenge = str(body.code_challenge) || null;
      const user = await loadUserByEmail(db, email);
      if (user) {
        const code = newOpaqueToken();
        const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await db.queryAsSuperuser(
          "insert into auth.recovery_codes (code, user_id, code_challenge, expires_at) values ($1, $2, $3, $4)",
          [code, user.id, challenge, expires],
        );
        const url = new URL(redirect);
        url.searchParams.set("code", code);
        console.log(`\n  [local-auth] Password reset link for ${email}:\n    ${url.toString()}\n`);
      }
      return { status: 200, body: {}, headers };
    }

    throw new AuthError(404, { code: "not_found", msg: `endpoint ${call.method} ${path} not found locally` });
  } catch (e) {
    if (e instanceof AuthError) return { status: e.status, body: e.payload, headers };
    const pgErr = e as { code?: string; message?: string };
    if (pgErr && typeof pgErr.code === "string") {
      if (pgErr.code === "23505") {
        return {
          status: 422,
          body: {
            code: "user_already_exists",
            error_code: "user_already_exists",
            msg: "User already registered",
            error_description: "User already registered",
            error: "user_already_exists",
          },
          headers,
        };
      }
      return {
        status: 400,
        body: { code: pgErr.code, error_code: pgErr.code, msg: pgErr.message ?? "database error" },
        headers,
      };
    }
    throw e;
  }
}
