import type { NextRequest } from "next/server";

function normalizeOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    // proto://host (sin path ni barra final)
    return `${u.protocol}//${u.host}`;
  } catch {
    return origin.replace(/\/+$/, "");
  }
}

function parseAllowedOrigins(): string[] {
  const raw =
    process.env.CORS_ORIGINS ??
    process.env.CORS_ORIGIN ??
    "http://localhost:5173";
  return raw
    .split(",")
    .map((s) => normalizeOrigin(s.trim()))
    .filter((x): x is string => Boolean(x));
}

const ALLOWED = new Set(parseAllowedOrigins());

export function withCORS(
  init: ResponseInit = {},
  reqOrigin?: string | null
): ResponseInit {
  const origin = normalizeOrigin(reqOrigin ?? null);
  const headers = new Headers(init.headers);

  if (origin && ALLOWED.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin); // debe coincidir 1:1
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,PUT,DELETE,OPTIONS"
  );
  // Si el preflight pidió headers específicos, se resuelven en preflight()
  headers.set("Access-Control-Allow-Headers", "authorization,content-type");
  headers.set(
    "Vary",
    "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
  );

  return { ...init, headers };
}

export function preflight(req: NextRequest) {
  const origin = normalizeOrigin(req.headers.get("origin"));
  const acrh =
    req.headers.get("access-control-request-headers") ??
    "authorization,content-type";

  const headers = new Headers();
  if (origin && ALLOWED.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,PUT,DELETE,OPTIONS"
  );
  headers.set("Access-Control-Allow-Headers", acrh);
  headers.set(
    "Vary",
    "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
  );

  // 204 si el origin es válido; 403 si no lo es
  const status = origin && ALLOWED.has(origin) ? 204 : 403;
  return new Response(null, { status, headers });
}
