import { NextRequest } from "next/server";
import { verifyJWT } from "./jwt";
import { jwtVerify } from "jose";

export async function requireAuth(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const token = auth.substring("Bearer ".length);
  const payload = await verifyJWT(token);
  return payload as { sub: string; email: string };
}

export async function verifyJwtFromRequest(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) throw new Error("NO_TOKEN");
  const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
  const { payload } = await jwtVerify(token, secret);
  return payload; // { sub, role, ... }
}
