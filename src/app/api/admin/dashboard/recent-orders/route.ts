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
    const limit = limitParam ? Math.min(50, Math.max(1, Number(limitParam))) : 10;

    const orders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        status: true,
        name: true,
        phone: true,
        subtotal: true,
        totalPrice: true,
        createdAt: true,
        _count: {
          select: { items: true },
        },
        items: {
          select: {
            id: true,
            title: true,
            price: true,
            quantity: true,
            imageUrl: true,
          },
          take: 3,
        },
      },
    });

    return new Response(
      JSON.stringify({ data: orders }),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    console.error("Dashboard recent-orders error:", message);
    return new Response(
      JSON.stringify({ error: "FORBIDDEN", message }),
      withCORS({ status: 403 }, origin)
    );
  }
}
