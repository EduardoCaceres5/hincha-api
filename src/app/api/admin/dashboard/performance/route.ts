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

    // === TOP PRODUCTOS ===
    // Obtener items de órdenes pagadas del período actual
    const orderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          status: "paid",
          createdAt: { gte: startDate, lte: now },
        },
      },
      select: {
        productId: true,
        title: true,
        price: true,
        quantity: true,
      },
    });

    // Obtener items del período anterior para calcular crecimiento
    const previousOrderItems = await prisma.orderItem.findMany({
      where: {
        order: {
          status: "paid",
          createdAt: { gte: previousStartDate, lt: previousEndDate },
        },
      },
      select: {
        productId: true,
        price: true,
        quantity: true,
      },
    });

    // Agrupar por producto
    const productMap = new Map<
      string,
      { id: string; title: string; revenue: number; sales: number }
    >();
    const previousProductMap = new Map<string, number>();

    orderItems.forEach((item) => {
      const current = productMap.get(item.productId) || {
        id: item.productId,
        title: item.title,
        revenue: 0,
        sales: 0,
      };
      current.revenue += item.price * item.quantity;
      current.sales += item.quantity;
      productMap.set(item.productId, current);
    });

    previousOrderItems.forEach((item) => {
      const current = previousProductMap.get(item.productId) || 0;
      previousProductMap.set(
        item.productId,
        current + item.price * item.quantity
      );
    });

    // Calcular top productos con crecimiento
    const topProducts = Array.from(productMap.values())
      .map((product) => {
        const previousRevenue = previousProductMap.get(product.id) || 0;
        const growth =
          previousRevenue > 0
            ? ((product.revenue - previousRevenue) / previousRevenue) * 100
            : product.revenue > 0
              ? 100
              : 0;

        return {
          id: product.id,
          title: product.title,
          revenue: product.revenue,
          sales: product.sales,
          growth,
        };
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // === CATEGORÍAS DE GASTOS ===
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

    const categoryMap = new Map<string, number>();
    let totalExpenses = 0;

    expenses.forEach((expense) => {
      const category = expense.category || "Sin categoría";
      const current = categoryMap.get(category) || 0;
      categoryMap.set(category, current + expense.amount);
      totalExpenses += expense.amount;
    });

    const expenseCategories = Array.from(categoryMap.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // === TASA DE CRECIMIENTO MENSUAL ===
    const currentRevenue = await prisma.order.aggregate({
      where: {
        status: "paid",
        createdAt: { gte: startDate, lte: now },
      },
      _sum: { totalPrice: true },
    });

    const previousRevenue = await prisma.order.aggregate({
      where: {
        status: "paid",
        createdAt: { gte: previousStartDate, lt: previousEndDate },
      },
      _sum: { totalPrice: true },
    });

    const currentRev = currentRevenue._sum.totalPrice || 0;
    const previousRev = previousRevenue._sum.totalPrice || 0;

    const monthlyGrowthRate =
      previousRev > 0 ? ((currentRev - previousRev) / previousRev) * 100 : 0;

    // === PUNTO DE EQUILIBRIO ===
    // Promedio de egresos mensuales de los últimos 3 meses
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const averageExpenses = await prisma.transaction.aggregate({
      where: {
        type: "EXPENSE",
        occurredAt: { gte: threeMonthsAgo, lte: now },
      },
      _sum: { amount: true },
    });

    const breakEvenPoint = (averageExpenses._sum.amount || 0) / 3; // Promedio mensual

    return new Response(
      JSON.stringify({
        topProducts,
        expenseCategories,
        monthlyGrowthRate,
        breakEvenPoint,
      }),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "FORBIDDEN";
    console.error("Performance indicators error:", message);
    return new Response(
      JSON.stringify({ error: "FORBIDDEN", message }),
      withCORS({ status: 403 }, origin)
    );
  }
}
