import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireAuth } from "@/lib/auth";
import { z } from "zod";

export async function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

const itemSchema = z.object({
  productId: z.string(),
  variantId: z.string(),
  qty: z.number().int().min(1).max(99),
});
const schema = z.object({
  name: z.string().min(2),
  phone: z.string().min(6),
  address: z.string().min(5),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1),
});

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireAuth(req);
    const { name, phone, address, notes, items } = schema.parse(
      await req.json()
    );

    const variantIds = items.map((i) => i.variantId);
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: {
        id: true,
        name: true,
        stock: true,
        price: true,
        product: {
          select: { id: true, title: true, price: true, imageUrl: true },
        },
      },
    });
    if (variants.length !== items.length) {
      return new Response(
        JSON.stringify({ error: "PRODUCT_MISMATCH" }),
        withCORS({ status: 400 }, origin)
      );
    }

    // Validar stock y calcular subtotal
    let subtotal = 0;
    for (const it of items) {
      const v = variants.find((v) => v.id === it.variantId)!;
      if (v.stock < it.qty) {
        return new Response(
          JSON.stringify({
            error: "OUT_OF_STOCK",
            detail: `${v.product.title} - ${v.name}`,
          }),
          withCORS({ status: 409 }, origin)
        );
      }
      const unit = v.price ?? v.product.price;
      subtotal += unit * it.qty;
    }

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: String(user.sub),
          status: "pending",
          name,
          phone,
          address,
          notes: notes ?? null,
          subtotal,
          items: {
            create: items.map((it) => {
              const v = variants.find((v) => v.id === it.variantId)!;
              const unit = v.price ?? v.product.price;
              return {
                productId: v.product.id,
                title: `${v.product.title} (${v.name})`,
                price: unit,
                quantity: it.qty,
                imageUrl: v.product.imageUrl,
              };
            }),
          },
        },
      });
      // Nota: no descontamos stock aquí (pending). Lo hacemos al marcar paid.
      return created;
    });

    return new Response(
      JSON.stringify({ id: order.id }),
      withCORS({ status: 201 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 }, origin)
    );
  }
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const { sub } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(50, Number(searchParams.get("limit") || 10));

    const [total, items] = await Promise.all([
      prisma.order.count({ where: { userId: String(sub) } }),
      prisma.order.findMany({
        where: { userId: String(sub) },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          name: true,
          subtotal: true,
          createdAt: true,
          _count: { select: { items: true } },
        },
      }),
    ]);

    return new Response(
      JSON.stringify({ items, page, limit, total }),
      withCORS({ status: 200 }, origin)
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "UNAUTHORIZED" }),
      withCORS({ status: 401 }, origin)
    );
  }
}
