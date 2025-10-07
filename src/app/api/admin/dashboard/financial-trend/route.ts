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
    const dateRange = searchParams.get("dateRange") || "month";

    // Calcular fechas y períodos
    const now = new Date();
    let startDate = new Date();
    let groupBy: "day" | "week" | "month" = "day";

    switch (dateRange) {
      case "day":
        startDate.setDate(now.getDate() - 1);
        groupBy = "day";
        break;
      case "week":
        startDate.setDate(now.getDate() - 7);
        groupBy = "day";
        break;
      case "month":
        startDate.setMonth(now.getMonth() - 1);
        groupBy = "day";
        break;
      case "year":
        startDate.setFullYear(now.getFullYear() - 1);
        groupBy = "month";
        break;
      case "custom":
        const customStart = searchParams.get("startDate");
        if (customStart) {
          startDate = new Date(customStart);
          const diffDays = Math.floor(
            (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          groupBy = diffDays > 60 ? "month" : "day";
        }
        break;
    }

    // Obtener órdenes pagadas en el rango
    const orders = await prisma.order.findMany({
      where: {
        status: "paid",
        createdAt: { gte: startDate, lte: now },
      },
      select: {
        createdAt: true,
        totalPrice: true,
      },
    });

    // Obtener transacciones de egresos
    const expenses = await prisma.transaction.findMany({
      where: {
        type: "EXPENSE",
        occurredAt: { gte: startDate, lte: now },
      },
      select: {
        occurredAt: true,
        amount: true,
      },
    });

    // Agrupar por fecha
    const dataMap = new Map<string, { revenue: number; expenses: number }>();

    // Procesar ingresos
    orders.forEach((order) => {
      const dateKey = formatDate(order.createdAt, groupBy);
      const current = dataMap.get(dateKey) || { revenue: 0, expenses: 0 };
      current.revenue += order.totalPrice;
      dataMap.set(dateKey, current);
    });

    // Procesar egresos
    expenses.forEach((expense) => {
      const dateKey = formatDate(expense.occurredAt, groupBy);
      const current = dataMap.get(dateKey) || { revenue: 0, expenses: 0 };
      current.expenses += expense.amount;
      dataMap.set(dateKey, current);
    });

    // Convertir a array y ordenar
    const trend = Array.from(dataMap.entries())
      .map(([date, data]) => ({
        date,
        revenue: data.revenue,
        expenses: data.expenses,
        profit: data.revenue - data.expenses,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return new Response(
      JSON.stringify(trend),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    console.error("Financial trend error:", message);
    return new Response(
      JSON.stringify({ error: "FORBIDDEN", message }),
      withCORS({ status: 403 }, origin)
    );
  }
}

function formatDate(date: Date, groupBy: "day" | "week" | "month"): string {
  const d = new Date(date);

  if (groupBy === "month") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  // Por defecto, agrupar por día
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
