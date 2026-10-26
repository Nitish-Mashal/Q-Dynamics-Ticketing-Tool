import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { LocalDb, type Claims } from "./lib/db";
import { handleAuth, type AuthCall } from "./lib/auth";
import { handleRest, mapDatabaseError, registerSchema, RestError, type RestCall } from "./lib/rest";
import { verifyToken } from "./lib/jwt";

const PORT = Number(process.env.SUPABASE_LOCAL_PORT ?? 54321);
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "local-service-role-key";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "local-anon-key";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, HEAD, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer, accept, accept-profile, content-profile, range, x-retry-count, api-version",
  "Access-Control-Expose-Headers": "content-range, preference-applied, api-version, x-total-count",
  "Access-Control-Max-Age": "86400",
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
    ...extra,
  });
  if (payload === "") res.end();
  else res.end(payload);
}

interface RequestContext {
  claims: Claims | null;
  role: "anon" | "authenticated" | "service_role";
}

function resolveContext(req: IncomingMessage, rawAuth: string | undefined, apikey: string | undefined): RequestContext {
  if (apikey === SERVICE_KEY) {
    return { claims: null, role: "service_role" };
  }
  if (rawAuth && rawAuth.toLowerCase().startsWith("bearer ")) {
    const token = rawAuth.slice(7).trim();
    if (token === SERVICE_KEY) return { claims: null, role: "service_role" };
    if (token === ANON_KEY) return { claims: null, role: "anon" };
    const verified = verifyToken(token);
    if (verified.ok) {
      const payload = verified.payload;
      if (payload.role === "service_role") return { claims: null, role: "service_role" };
      return { claims: payload as Claims, role: "authenticated" };
    }
    throw Object.assign(new Error("JWT expired or invalid"), { pgrst: "PGRST301" });
  }
  return { claims: null, role: "anon" };
}

async function main(): Promise<void> {
  const reset = process.argv.includes("--reset") || process.env.DB_RESET === "1";
  const seed = process.argv.includes("--seed") || process.env.DB_SEED === "1";
  const db = new LocalDb();
  console.log("[local-supabase] starting...");
  await db.init({ reset, seed });
  registerSchema(db.tableNames().map((n) => db.table(n)!));
  console.log(`[local-supabase] schema ready: ${db.tableNames().length} tables`);

  const server = createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      const method = (req.method ?? "GET").toUpperCase();

      if (method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      if (url.pathname === "/health" || url.pathname === "/") {
        writeJson(res, 200, { ok: true, service: "supabase-local-dev", port: PORT });
        return;
      }

      const rawBody = method === "GET" || method === "HEAD" ? "" : await readBody(req);
      const rawAuth = req.headers.authorization;
      const apikey = typeof req.headers.apikey === "string" ? req.headers.apikey : undefined;

      if (url.pathname.startsWith("/auth/v1/")) {
        let parsedBody: Record<string, unknown> = {};
        if (rawBody) {
          try {
            parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
          } catch {
            parsedBody = {};
          }
        }
        const call: AuthCall = {
          method,
          pathname: url.pathname,
          search: url.searchParams,
          body: parsedBody,
          authorization: rawAuth,
          ip: req.socket.remoteAddress ?? "local",
        };
        const result = await handleAuth(db, call);
        writeJson(res, result.status, result.body, result.headers);
        return;
      }

      if (url.pathname.startsWith("/storage/v1/")) {
        writeJson(res, 501, {
          code: "storage_not_configured",
          message: "Private file storage arrives in a later prompt; configure SUPABASE_URL for hosted mode.",
        });
        return;
      }

      if (!url.pathname.startsWith("/rest/v1/") && !url.pathname.startsWith("/rpc/")) {
        writeJson(res, 404, { code: "not_found", message: `unknown endpoint ${url.pathname}` });
        return;
      }

      let ctx: RequestContext;
      try {
        ctx = resolveContext(req, rawAuth, apikey);
      } catch (e) {
        const message = (e as Error).message;
        writeJson(res, 401, { code: "PGRST301", message, details: null, hint: null });
        return;
      }

      const call: RestCall = {
        method,
        pathname: url.pathname,
        search: url.searchParams,
        prefer: String(req.headers.prefer ?? "")
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        accept: String(req.headers.accept ?? ""),
        range: typeof req.headers.range === "string" ? req.headers.range : undefined,
        body: rawBody,
        role: ctx.role,
        claims: ctx.claims,
      };

      try {
        const result = await db.withRequest(ctx.claims, ctx.role, (tx) => handleRest(tx, call));
        if (method === "HEAD") {
          res.writeHead(result.status, { ...CORS_HEADERS, ...(result.headers ?? {}) });
          res.end();
          return;
        }
        writeJson(res, result.status, result.body, result.headers);
      } catch (e) {
        if (e instanceof RestError) {
          writeJson(res, e.status, e.payload);
          return;
        }
        const mapped = mapDatabaseError(e, call);
        if (mapped) {
          writeJson(res, mapped.status, mapped.body, mapped.headers);
          return;
        }
        const errObj = e as { message?: string; stack?: string };
        console.error("[local-supabase] unhandled query error:", errObj);
        writeJson(res, 400, {
          code: "XX000",
          message: errObj.message ?? "internal error",
          details: null,
          hint: null,
        });
      }
    } catch (e) {
      const errObj = e as { message?: string };
      console.error("[local-supabase] request error:", errObj);
      writeJson(res, 400, { code: "XX000", message: errObj.message ?? "internal error" });
    } finally {
      const ms = Date.now() - started;
      if (ms > 500) console.log(`[local-supabase] slow request ${req.method} ${req.url} ${ms}ms`);
    }
  });

  server.listen(PORT, () => {
    console.log(`[local-supabase] ready on http://localhost:${PORT}`);
    console.log(`  REST   http://localhost:${PORT}/rest/v1`);
    console.log(`  AUTH   http://localhost:${PORT}/auth/v1`);
    console.log(`  ANON key: ${ANON_KEY}`);
  });

  const shutdown = () => {
    console.log("\n[local-supabase] shutting down");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error("[local-supabase] fatal:", e);
  process.exit(1);
});
