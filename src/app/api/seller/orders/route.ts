import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireRole } from "@/lib/authz";

export async function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["seller", "admin"]);
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(50, Number(searchParams.get("limit") || 20));
    const status = searchParams.get("status") || undefined;
    const search = searchParams.get("search") || undefined;

    // Órdenes donde alguno de los items pertenece a productos del seller
    const where: any = {
      items: { some: { product: { ownerId: user.id } } },
    };
    if (status) where.status = status;
    if (search)
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { id: { contains: search } },
      ];

    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          name: true,
          phone: true,
          subtotal: true,
          createdAt: true,
          items: {
            where: { product: { ownerId: user.id } },
            select: { id: true, title: true, price: true, quantity: true },
          },
        },
      }),
    ]);

    return new Response(
      JSON.stringify({ items, page, limit, total }),
      withCORS({ status: 200 }, origin)
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "FORBIDDEN" }),
      withCORS({ status: 403 }, origin)
    );
  }
}
