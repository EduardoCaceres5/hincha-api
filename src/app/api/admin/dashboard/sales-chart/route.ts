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
    const daysParam = searchParams.get("days");
    const days = daysParam ? Math.min(90, Math.max(1, Number(daysParam))) : 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: {
        status: "paid",
        createdAt: {
          gte: startDate,
        },
      },
      select: {
        createdAt: true,
        totalPrice: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Agrupar por día
    const salesByDay = new Map<string, { date: string; total: number; count: number }>();

    orders.forEach((order) => {
      const dateKey = order.createdAt.toISOString().split("T")[0];
      const existing = salesByDay.get(dateKey);
      if (existing) {
        existing.total += order.totalPrice;
        existing.count += 1;
      } else {
        salesByDay.set(dateKey, {
          date: dateKey,
          total: order.totalPrice,
          count: 1,
        });
      }
    });

    const data = Array.from(salesByDay.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    return new Response(
      JSON.stringify({ data }),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    console.error("Dashboard sales-chart error:", message);
    return new Response(
      JSON.stringify({ error: "FORBIDDEN", message }),
      withCORS({ status: 403 }, origin)
    );
  }
}
