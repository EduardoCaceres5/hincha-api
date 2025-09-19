import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireAuth } from "@/lib/auth";

export async function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  const { sub } = await requireAuth(req);
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") || 1);
  const limit = Math.min(Number(searchParams.get("limit") || 12), 50);
  const [total, items] = await Promise.all([
    prisma.product.count({ where: { ownerId: String(sub) } }),
    prisma.product.findMany({
      where: { ownerId: String(sub) },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return new Response(
    JSON.stringify({ items, page, limit, total }),
    withCORS({ status: 200 }, req.headers.get("origin"))
  );
}
