import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { withCORS, preflight } from "@/lib/cors";
import { z } from "zod";

export async function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

const updateSchema = z.object({
  option: z.string().min(1).optional(),
  stock: z.coerce.number().int().min(0).optional(),
  price: z.coerce.number().int().nullable().optional(),
  sku: z.string().nullable().optional(),
});

async function assertOwnership(
  variantId: string,
  userId: string,
  isAdmin: boolean
) {
  const v = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { product: { select: { ownerId: true } } },
  });
  if (!v) return false;
  if (isAdmin) return true;
  return v.product.ownerId === userId;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ variantId: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["seller", "admin"]);
    const { variantId } = await ctx.params;
    if (!(await assertOwnership(variantId, user.id, user.role === "admin"))) {
      return new Response(
        JSON.stringify({ error: "FORBIDDEN" }),
        withCORS({ status: 403 }, origin)
      );
    }
    const data = updateSchema.parse(await req.json());
    const updated = await prisma.productVariant.update({
      where: { id: variantId },
      data,
    });
    return new Response(
      JSON.stringify(updated),
      withCORS({ status: 200 }, origin)
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "BAD_REQUEST" }),
      withCORS({ status: 400 }, origin)
    );
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ variantId: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["seller", "admin"]);
    const { variantId } = await ctx.params;
    if (!(await assertOwnership(variantId, user.id, user.role === "admin"))) {
      return new Response(
        JSON.stringify({ error: "FORBIDDEN" }),
        withCORS({ status: 403 }, origin)
      );
    }
    await prisma.productVariant.delete({ where: { id: variantId } });
    return new Response(null, withCORS({ status: 204 }, origin));
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || "BAD_REQUEST" }),
      withCORS({ status: 400 }, origin)
    );
  }
}
