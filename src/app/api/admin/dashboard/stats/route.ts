import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireRole } from "@/lib/authz";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    await requireRole(req, ["admin"]);

    const [
      totalOrders,
      pendingOrders,
      paidOrders,
      totalRevenue,
      totalProducts,
      lowStockProducts,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: "pending" } }),
      prisma.order.count({ where: { status: "paid" } }),
      prisma.order.aggregate({
        where: { status: "paid" },
        _sum: { totalPrice: true },
      }),
      prisma.product.count(),
      prisma.productVariant.count({
        where: { stock: { lte: 5 } },
      }),
    ]);

    return new Response(
      JSON.stringify({
        totalOrders,
        pendingOrders,
        paidOrders,
        totalRevenue: totalRevenue._sum.totalPrice || 0,
        totalProducts,
        lowStockProducts,
      }),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    console.error("Dashboard stats error:", message);
    return new Response(
      JSON.stringify({ error: "FORBIDDEN", message }),
      withCORS({ status: 403 }, origin)
    );
  }
}
