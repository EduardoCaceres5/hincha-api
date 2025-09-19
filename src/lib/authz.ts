import { requireAuth } from "./auth";
import { prisma } from "./db";
import { NextRequest } from "next/server";

export async function requireRole(
  req: NextRequest,
  roles: Array<"admin" | "seller">
) {
  const jwt = await requireAuth(req);
  const user = await prisma.user.findUnique({
    where: { id: String(jwt.sub) },
    select: { id: true, role: true },
  });
  if (!user || !roles.includes(user.role as any)) throw new Error("FORBIDDEN");
  return user;
}
