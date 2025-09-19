const DEFAULT_ORIGINS = process.env.CORS_ORIGIN || "http://localhost:5173";

function resolveOrigin(reqOrigin: string | null) {
  const env = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "";
  const allowed = env
    ? env
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_ORIGINS;
  if (!reqOrigin) return allowed[0];
  return allowed.includes(reqOrigin) ? reqOrigin : allowed[0];
}

export function withCORS(init?: ResponseInit, reqOrigin?: string | null) {
  const origin = resolveOrigin(reqOrigin || null);
  const baseHeaders = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // Si usás cookies/sesiones cross-site, descomenta la siguiente línea:
    "Access-Control-Allow-Credentials": "true",
    // Mejora de caché de CORS (evita respuestas “pegadas” a otro Origin)
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  } as Record<string, string>;

  return {
    ...init,
    headers: {
      ...baseHeaders,
      ...(init?.headers || {}),
    },
  };
}

export function preflight(origin?: string | null) {
  return new Response(null, withCORS({ status: 204 }, origin));
}
