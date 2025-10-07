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

    // Calcular fechas según el rango
    const now = new Date();
    let startDate = new Date();

    switch (dateRange) {
      case "day":
        startDate.setHours(0, 0, 0, 0);
        break;
      case "week":
        startDate.setDate(now.getDate() - 7);
        break;
      case "month":
        startDate.setMonth(now.getMonth() - 1);
        break;
      case "year":
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case "custom":
        const customStart = searchParams.get("startDate");
        if (customStart) startDate = new Date(customStart);
        break;
    }

    // Obtener transacciones de egresos agrupadas por categoría
    const expenses = await prisma.transaction.findMany({
      where: {
        type: "EXPENSE",
        occurredAt: { gte: startDate, lte: now },
      },
      select: {
        category: true,
        amount: true,
      },
    });

    // Agrupar por categoría
    const categoryMap = new Map<string, number>();
    let totalExpenses = 0;

    expenses.forEach((expense) => {
      const category = expense.category || "Sin categoría";
      const current = categoryMap.get(category) || 0;
      categoryMap.set(category, current + expense.amount);
      totalExpenses += expense.amount;
    });

    // Convertir a array con porcentajes
    const distribution = Array.from(categoryMap.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount); // Ordenar por monto descendente

    return new Response(
      JSON.stringify(distribution),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    console.error("Expense distribution error:", message);
    return new Response(
      JSON.stringify({ error: "FORBIDDEN", message }),
      withCORS({ status: 403 }, origin)
    );
  }
}
