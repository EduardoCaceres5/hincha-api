import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { z } from "zod";
import { verifyJwtFromRequest } from "@/lib/auth"; // 👈 util que valida el JWT y retorna payload o lanza

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

/** Auth opcional: si hay token válido → payload; si no → null */
async function optionalAuth(
  req: NextRequest
): Promise<null | { sub: string; role?: string }> {
  try {
    const payload = await verifyJwtFromRequest(req); // implementá esto leyendo Authorization: Bearer ...
    return payload as { sub: string; role?: string };
  } catch {
    return null;
  }
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
  customName: z.string().optional(),
  customNumber: z.number().int().min(1).max(99).optional(),
  hasPatch: z.boolean().default(false),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    // 🔓 no exigimos login
    const user = await optionalAuth(req);

    const {
      name,
      phone,
      address,
      notes,
      items,
      customName,
      customNumber,
      hasPatch,
      lat,
      lng,
    } = schema.parse(await req.json());

    // Obtener información de productos para calcular precios
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        title: true,
        basePrice: true,
        imageUrl: true,
      },
    });

    // Calcular subtotal usando basePrice del producto
    let subtotal = 0;
    for (const it of items) {
      const product = products.find((p) => p.id === it.productId);
      if (!product) {
        return new Response(
          JSON.stringify({ error: "PRODUCT_NOT_FOUND", productId: it.productId }),
          withCORS({ status: 400 }, origin)
        );
      }
      subtotal += product.basePrice * it.qty;
    }

    // Calcular extras de personalización (ajustar precios según tu lógica)
    const CUSTOM_NAME_PRICE = 15000; // Gs
    const CUSTOM_NUMBER_PRICE = 10000; // Gs
    const PATCH_PRICE = 20000; // Gs

    let extras = 0;
    if (customName) extras += CUSTOM_NAME_PRICE;
    if (customNumber) extras += CUSTOM_NUMBER_PRICE;
    if (hasPatch) extras += PATCH_PRICE;

    const totalPrice = subtotal + extras;

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: user?.sub ?? null, // 👈 asociar si hay usuario; sino guest
          status: "pending",
          name,
          phone,
          address,
          notes: notes ?? null,
          subtotal,
          lat: lat ?? null,
          lng: lng ?? null,
          customName: customName ?? null,
          customNumber: customNumber ?? null,
          hasPatch: hasPatch ?? false,
          totalPrice,
          items: {
            create: items.map((it) => {
              const product = products.find((p) => p.id === it.productId)!;
              return {
                productId: product.id,
                variantId: it.variantId,
                title: `${product.title} (${it.variantId})`,
                price: product.basePrice,
                quantity: it.qty,
                imageUrl: product.imageUrl,
              };
            }),
          },
        },
      });
      // Nota: stock se descuenta al marcar "paid".
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
    // 🔒 sigue protegido: listar pedidos del usuario autenticado
    const payload = await optionalAuth(req);
    if (!payload?.sub) {
      return new Response(
        JSON.stringify({ error: "UNAUTHORIZED" }),
        withCORS({ status: 401 }, origin)
      );
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(50, Number(searchParams.get("limit") || 10));

    const [total, items] = await Promise.all([
      prisma.order.count(),
      prisma.order.findMany({
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
