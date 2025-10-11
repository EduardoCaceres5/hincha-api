import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireRole } from "@/lib/authz";
import { z } from "zod";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

const schema = z.object({
  status: z.enum(["pending", "paid", "canceled"]).optional(),
  depositAmount: z.number().int().positive().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["admin"]);
    const body = schema.parse(await req.json());
    const { id } = await params;

    // Obtener la orden actual
    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        totalPrice: true,
        depositAmount: true,
        depositTransactionId: true,
        balanceTransactionId: true,
        userId: true,
      },
    });

    if (!order) {
      return new Response(
        JSON.stringify({ error: "ORDER_NOT_FOUND" }),
        withCORS({ status: 404 }, origin)
      );
    }

    // Actualizar usando transacción de Prisma
    const updated = await prisma.$transaction(async (tx) => {
      const updateData: {
        status?: string;
        depositAmount?: number;
        depositPaidAt?: Date;
        depositTransactionId?: string;
        balancePaidAt?: Date;
        balanceTransactionId?: string;
      } = {};

      // Si se está registrando una seña
      if (body.depositAmount !== undefined && !order.depositTransactionId) {
        const depositTransaction = await tx.transaction.create({
          data: {
            userId: order.userId || user.id,
            type: "INCOME",
            amount: body.depositAmount,
            description: `Seña del pedido #${order.id.slice(-8)}`,
            category: "venta",
            occurredAt: new Date(),
          },
        });

        updateData.depositAmount = body.depositAmount;
        updateData.depositPaidAt = new Date();
        updateData.depositTransactionId = depositTransaction.id;
      }

      // Si se está cambiando el status a "paid" y hay saldo pendiente
      if (body.status === "paid" && order.status !== "paid") {
        const depositAmount = updateData.depositAmount || order.depositAmount || 0;
        const balance = order.totalPrice - depositAmount;

        // Solo crear transacción de saldo si hay un balance > 0 y no se ha registrado antes
        if (balance > 0 && !order.balanceTransactionId) {
          const balanceTransaction = await tx.transaction.create({
            data: {
              userId: order.userId || user.id,
              type: "INCOME",
              amount: balance,
              description: `Saldo del pedido #${order.id.slice(-8)}`,
              category: "venta",
              occurredAt: new Date(),
            },
          });

          updateData.balancePaidAt = new Date();
          updateData.balanceTransactionId = balanceTransaction.id;
        }

        updateData.status = "paid";
      } else if (body.status && body.status !== order.status) {
        updateData.status = body.status;
      }

      return await tx.order.update({
        where: { id },
        data: updateData,
      });
    });

    return new Response(
      JSON.stringify(updated),
      withCORS({ status: 200 }, origin)
    );
  } catch (err) {
    console.error("Error updating order:", err);
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST" }),
      withCORS({ status: 400 }, origin)
    );
  }
}
