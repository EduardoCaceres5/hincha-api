import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireRole } from "@/lib/authz";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

export async function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

// Alineado a tu modelo ProductVariant:
// id: default, productId: lo tomamos de la ruta,
// sku?: unique, name: string, stock?: int>=0, price?: int>=0 | null
const variantSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .min(1, "sku no puede estar vacío")
      .optional()
      .transform((v) => (v && v.length ? v : undefined)),
    name: z.string().trim().min(1, "name es requerido"),
    stock: z.coerce.number().int().min(0).optional(), // si omitís, Prisma usa default(0)
    // si querés permitir null explícito para usar el price del product:
    price: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
  })
  .strict(); // rechaza claves extra

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    // seller o admin
    const user = await requireRole(req, ["seller", "admin"]);

    const { id: productId } = await ctx.params;

    // Confirma que el product exista y, si no sos admin, que sea tuyo
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

    const body = variantSchema.parse(await req.json());

    // Crea la variante (@@unique([productId, name]) y sku unique se validan en DB)
    const v = await prisma.productVariant.create({
      data: { productId, ...body },
      // opcional: select para devolver menos datos
      // select: { id: true, name: true, sku: true, stock: true, price: true },
    });

    return new Response(JSON.stringify(v), withCORS({ status: 201 }, origin));
  } catch (err: unknown) {
    // Manejo fino de errores Prisma
    if (
      err &&
      typeof err === "object" &&
      "code" in (err as Prisma.PrismaClientKnownRequestError)
    ) {
      const e = err as Prisma.PrismaClientKnownRequestError;
      if (e.code === "P2002") {
        // Unique constraint: puede ser 'sku' o la compuesta 'productId+name'
        return new Response(
          JSON.stringify({
            error: "CONFLICT",
            message: "Variant ya existe (sku o nombre duplicado).",
          }),
          withCORS({ status: 409 }, origin)
        );
      }
      if (e.code === "P2003") {
        // FK inválida (por si se borra el product entre el check y el create)
        return new Response(
          JSON.stringify({
            error: "BAD_REQUEST",
            message: "Producto inexistente.",
          }),
          withCORS({ status: 400 }, origin)
        );
      }
    }

    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 }, origin)
    );
  }
}
