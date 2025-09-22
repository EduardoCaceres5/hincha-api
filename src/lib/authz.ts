import { NextRequest } from "next/server";
import { jwtVerify, JWTPayload } from "jose";
import { z } from "zod";
// Si tienes enum en Prisma, úsalo:
// import { Role } from "@prisma/client"

// ===== Tipos de rol =====
export type AppRole = "user" | "seller" | "admin";
// Si usas Prisma Role, cambia a: export type AppRole = Role

// ===== Payload esperado del JWT =====
const JwtUser = z.object({
  sub: z.string().min(1), // user id
  role: z.enum(["user", "seller", "admin"]), // o z.nativeEnum(Role)
  email: z.string().email().optional(),
  name: z.string().optional(),
});
type JwtUser = z.infer<typeof JwtUser>;

export type AuthUser = {
  id: string;
  role: AppRole;
  email?: string;
  name?: string;
};

// ===== Helpers =====
function getBearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const [type, token] = h.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

async function verifyToken(token: string): Promise<JwtUser> {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("MISSING_JWT_SECRET");
  const encoder = new TextEncoder();
  const { payload } = await jwtVerify(token, encoder.encode(secret));
  // payload es unknown → validamos con Zod (sin any)
  return JwtUser.parse(payload as JWTPayload);
}

// ===== API =====
export async function requireAuth(req: NextRequest): Promise<AuthUser> {
  const token = getBearer(req);
  if (!token) throw new Error("FORBIDDEN");
  const u = await verifyToken(token);
  return { id: u.sub, role: u.role, email: u.email, name: u.name };
}

/**
 * Verifica que el usuario tenga alguno de los roles requeridos.
 * Ejemplo de uso:
 *   await requireRole(req, ["seller", "admin"])
 */
export async function requireRole(
  req: NextRequest,
  roles: ReadonlyArray<AppRole> // o ReadonlyArray<Role> si usas Prisma enum
): Promise<AuthUser> {
  const user = await requireAuth(req);
  if (!roles.includes(user.role)) throw new Error("FORBIDDEN");
  return user;
}
