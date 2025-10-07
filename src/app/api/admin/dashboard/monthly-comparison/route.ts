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
    const yearParam = searchParams.get("year");
    const year = yearParam ? parseInt(yearParam) : new Date().getFullYear();

    // Crear fechas de inicio y fin del año
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    // Obtener órdenes pagadas del año
    const orders = await prisma.order.findMany({
      where: {
        status: "paid",
        createdAt: { gte: startDate, lte: endDate },
      },
      select: {
        createdAt: true,
        totalPrice: true,
      },
    });

    // Obtener transacciones de egresos del año
    const expenses = await prisma.transaction.findMany({
      where: {
        type: "EXPENSE",
        occurredAt: { gte: startDate, lte: endDate },
      },
      select: {
        occurredAt: true,
        amount: true,
      },
    });

    // Agrupar por mes
    const monthlyData = new Map<
      number,
      { revenue: number; expenses: number }
    >();

    // Inicializar todos los meses
    for (let i = 0; i < 12; i++) {
      monthlyData.set(i, { revenue: 0, expenses: 0 });
    }

    // Procesar ingresos
    orders.forEach((order) => {
      const month = order.createdAt.getMonth();
      const current = monthlyData.get(month)!;
      current.revenue += order.totalPrice;
    });

    // Procesar egresos
    expenses.forEach((expense) => {
      const month = expense.occurredAt.getMonth();
      const current = monthlyData.get(month)!;
      current.expenses += expense.amount;
    });

    // Convertir a array con nombres de meses
    const monthNames = [
      "Ene",
      "Feb",
      "Mar",
      "Abr",
      "May",
      "Jun",
      "Jul",
      "Ago",
      "Sep",
      "Oct",
      "Nov",
      "Dic",
    ];

    const comparison = Array.from(monthlyData.entries()).map(
      ([monthIndex, data]) => ({
        month: monthNames[monthIndex],
        revenue: data.revenue,
        expenses: data.expenses,
        profit: data.revenue - data.expenses,
      })
    );

    return new Response(
      JSON.stringify(comparison),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    console.error("Monthly comparison error:", message);
    return new Response(
      JSON.stringify({ error: "FORBIDDEN", message }),
      withCORS({ status: 403 }, origin)
    );
  }
}
