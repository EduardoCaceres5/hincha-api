import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { withCORS, preflight } from "@/lib/cors";
import { z } from "zod";

export async function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

const schema = z.object({
  option: z.string().min(1), // ej: "Talle:M"
  stock: z.coerce.number().int().min(0),
  price: z.coerce.number().int().optional(), // override opcional
  sku: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["seller", "admin"]);
    const { id: productId } = await ctx.params;
    const body = schema.parse(await req.json());

    const prod = await prisma.product.findUnique({
      where: { id: productId },
      select: { ownerId: true },
    });
    if (!prod || (user.role !== "admin" && prod.ownerId !== user.id)) {
      return new Response(
        JSON.stringify({ error: "FORBIDDEN" }),
        withCORS({ status: 403 }, origin)
      );
    }

    const v = await prisma.productVariant.create({
      data: { productId, ...body },
    });
    return new Response(JSON.stringify(v), withCORS({ status: 201 }, origin));
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "BAD_REQUEST" }),
      withCORS({ status: 400 }, origin)
    );
  }
}
