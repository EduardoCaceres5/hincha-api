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
    let previousStartDate = new Date();
    let previousEndDate = new Date();

    switch (dateRange) {
      case "day":
        startDate.setHours(0, 0, 0, 0);
        previousStartDate = new Date(startDate);
        previousStartDate.setDate(previousStartDate.getDate() - 1);
        previousEndDate = new Date(startDate);
        break;
      case "week":
        startDate.setDate(now.getDate() - 7);
        previousStartDate = new Date(startDate);
        previousStartDate.setDate(previousStartDate.getDate() - 7);
        previousEndDate = new Date(startDate);
        break;
      case "month":
        startDate.setMonth(now.getMonth() - 1);
        previousStartDate = new Date(startDate);
        previousStartDate.setMonth(previousStartDate.getMonth() - 1);
        previousEndDate = new Date(startDate);
        break;
      case "year":
        startDate.setFullYear(now.getFullYear() - 1);
        previousStartDate = new Date(startDate);
        previousStartDate.setFullYear(previousStartDate.getFullYear() - 1);
        previousEndDate = new Date(startDate);
        break;
      case "custom":
        const customStart = searchParams.get("startDate");
        const customEnd = searchParams.get("endDate");
        if (customStart) startDate = new Date(customStart);
        if (customEnd) now.setTime(new Date(customEnd).getTime());

        const diffTime = now.getTime() - startDate.getTime();
        previousEndDate = new Date(startDate);
        previousStartDate = new Date(startDate.getTime() - diffTime);
        break;
    }

    // Obtener ingresos del período actual (órdenes pagadas)
    const currentRevenue = await prisma.order.aggregate({
      where: {
        status: "paid",
        createdAt: { gte: startDate, lte: now },
      },
      _sum: { totalPrice: true },
    });

    // Obtener egresos del período actual (transacciones tipo EXPENSE)
    const currentExpenses = await prisma.transaction.aggregate({
      where: {
        type: "EXPENSE",
        occurredAt: { gte: startDate, lte: now },
      },
      _sum: { amount: true },
    });

    // Obtener ingresos del período anterior
    const previousRevenue = await prisma.order.aggregate({
      where: {
        status: "paid",
        createdAt: { gte: previousStartDate, lt: previousEndDate },
      },
      _sum: { totalPrice: true },
    });

    // Obtener egresos del período anterior
    const previousExpenses = await prisma.transaction.aggregate({
      where: {
        type: "EXPENSE",
        occurredAt: { gte: previousStartDate, lt: previousEndDate },
      },
      _sum: { amount: true },
    });

    const totalRevenue = currentRevenue._sum.totalPrice || 0;
    const totalExpenses = currentExpenses._sum.amount || 0;
    const prevRevenue = previousRevenue._sum.totalPrice || 0;
    const prevExpenses = previousExpenses._sum.amount || 0;

    const profitMargin = totalRevenue - totalExpenses;
    const profitMarginPercentage = totalRevenue > 0
      ? (profitMargin / totalRevenue) * 100
      : 0;

    const revenueChange = prevRevenue > 0
      ? ((totalRevenue - prevRevenue) / prevRevenue) * 100
      : 0;

    const expenseChange = prevExpenses > 0
      ? ((totalExpenses - prevExpenses) / prevExpenses) * 100
      : 0;

    return new Response(
      JSON.stringify({
        totalRevenue,
        totalExpenses,
        profitMargin,
        profitMarginPercentage,
        revenueChange,
        expenseChange,
        previousRevenue: prevRevenue,
        previousExpenses: prevExpenses,
      }),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    console.error("Financial summary error:", message);
    return new Response(
      JSON.stringify({ error: "FORBIDDEN", message }),
      withCORS({ status: 403 }, origin)
    );
  }
}
