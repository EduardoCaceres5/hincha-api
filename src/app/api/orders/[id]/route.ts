import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireAuth } from "@/lib/auth";
import { z } from "zod";
import { requireRole } from "@/lib/authz";

const schema = z.object({ status: z.enum(["pending", "paid", "canceled"]) });

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  const { id } = await params;
  try {
    const { sub } = await requireAuth(req);
    const order = await prisma.order.findUnique({
      where: { id: id },
      include: {
        items: {
          select: {
            id: true,
            productId: true,
            title: true,
            price: true,
            quantity: true,
            imageUrl: true,
          },
        },
      },
    });
    if (!order || order.userId !== String(sub)) {
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, origin)
      );
    }
    return new Response(
      JSON.stringify(order),
      withCORS({ status: 200 }, origin)
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "UNAUTHORIZED" }),
      withCORS({ status: 401 }, origin)
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    await requireRole(req, ["admin"]);

    const { status } = schema.parse(await req.json());

    const { id } = await params;

    const updated = await prisma.$transaction(async (tx) => {
      // Actualizamos el estado solicitado
      const order = await tx.order.update({
        where: { id: id },
        data: { status },
        include: {
          items: {
            select: {
              productId: true,
              variantId: true,
              quantity: true,
              title: true,
            },
          },
        },
      });

      // Si es "paid", descontar stock de variantes (si aplica)
      if (status === "paid") {
        // Restar stock solo de items con variantId
        for (const it of order.items) {
          if (it.variantId) {
            await tx.productVariant.update({
              where: { id: it.variantId },
              data: { stock: { decrement: it.quantity } },
            });
          }
        }
      }

      return order;
    });

    return new Response(
      JSON.stringify(updated),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 }, origin)
    );
  }
}
