import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireAuth } from "@/lib/auth";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  await requireAuth(req);
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") || 1);
  const limit = Math.min(Number(searchParams.get("limit") || 12), 50);

  // Filtros
  const search = searchParams.get("search") || undefined;
  const league = searchParams.get("league") || undefined;
  const kit = searchParams.get("kit") || undefined;
  const quality = searchParams.get("quality") || undefined;
  const sortBy = searchParams.get("sortBy") || "createdAt";
  const sortOrder = searchParams.get("sortOrder") || "desc";

  // Construir where clause
  const where: any = {};

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  if (league) {
    where.league = league;
  }

  if (kit) {
    where.kit = kit;
  }

  if (quality) {
    where.quality = quality;
  }

  // Construir orderBy
  const orderBy: any = {};
  if (sortBy) {
    orderBy[sortBy] = sortOrder;
  }

  const [total, items] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return new Response(
    JSON.stringify({ items, page, limit, total }),
    withCORS({ status: 200 }, req.headers.get("origin"))
  );
}
