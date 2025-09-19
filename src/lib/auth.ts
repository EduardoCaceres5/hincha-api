import { NextRequest } from "next/server";
import { verifyJWT } from "./jwt";

export async function requireAuth(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  const token = auth.substring("Bearer ".length);
  const payload = await verifyJWT(token);
  return payload as { sub: string; email: string };
}
