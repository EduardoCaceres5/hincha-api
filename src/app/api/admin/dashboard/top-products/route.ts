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

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(20, Math.max(1, Number(limitParam))) : 10;

    const topProducts = await prisma.orderItem.groupBy({
      by: ["productId"],
      where: {
        order: {
          status: "paid",
        },
      },
      _sum: {
        quantity: true,
      },
      _count: {
        _all: true,
      },
      orderBy: {
        _sum: {
          quantity: "desc",
        },
      },
      take: limit,
    });

    const productIds = topProducts.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: {
          in: productIds,
        },
      },
      select: {
        id: true,
        title: true,
        imageUrl: true,
        seasonLabel: true,
      },
    });

    const data = topProducts.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      return {
        productId: item.productId,
        title: product?.title || "Producto desconocido",
        imageUrl: product?.imageUrl,
        seasonLabel: product?.seasonLabel,
        totalSold: item._sum.quantity || 0,
        orderCount: item._count._all,
      };
    });

    return new Response(
      JSON.stringify({ data }),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    console.error("Dashboard top-products error:", message);
    return new Response(
      JSON.stringify({ error: "FORBIDDEN", message }),
      withCORS({ status: 403 }, origin)
    );
  }
}
