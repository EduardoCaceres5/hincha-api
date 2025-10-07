import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireAuth } from "@/lib/auth";
import type { Prisma } from "@prisma/client";
import { KitType, ProductQuality } from "@prisma/client";

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
  const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";

  // Construir where clause
  const where: Prisma.ProductWhereInput = {};

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  if (league) {
    where.league = league;
  }

  if (kit && Object.values(KitType).includes(kit as KitType)) {
    where.kit = kit as KitType;
  }

  if (
    quality &&
    Object.values(ProductQuality).includes(quality as ProductQuality)
  ) {
    where.quality = quality as ProductQuality;
  }

  // Construir orderBy
  const orderBy: Prisma.ProductOrderByWithRelationInput =
    {} as Prisma.ProductOrderByWithRelationInput;
  if (sortBy) {
    (orderBy as Record<string, "asc" | "desc">)[sortBy] = sortOrder;
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
