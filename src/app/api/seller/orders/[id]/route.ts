import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireRole } from "@/lib/authz";
import { z } from "zod";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}
const schema = z.object({
  status: z.enum(["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"])
    .transform(val => val.toUpperCase() as "PENDING" | "CONFIRMED" | "PREPARING" | "READY" | "DELIVERED" | "CANCELLED")
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["seller", "admin"]);
    const { status } = schema.parse(await req.json());

    const { id } = await params;
    // Verificar pertenencia
    const found = await prisma.order.findFirst({
      where: {
        id: id,
        items: { some: { product: { ownerId: user.id } } },
      },
      select: { id: true },
    });
    if (!found)
      return new Response(
        JSON.stringify({ error: "FORBIDDEN" }),
        withCORS({ status: 403 }, origin)
      );

    const updated = await prisma.order.update({
      where: { id: id },
      data: { status },
    });
    return new Response(
      JSON.stringify(updated),
      withCORS({ status: 200 }, origin)
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST" }),
      withCORS({ status: 400 }, origin)
    );
  }
}
