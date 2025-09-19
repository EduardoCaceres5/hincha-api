import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz"; // debe devolver { id, role }
import { withCORS, preflight } from "@/lib/cors"; // tus helpers CORS

export async function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    // Solo seller/admin
    const user = await requireRole(req, ["seller", "admin"]);

    // Admin ve todos; seller solo los propios
    const where = user.role === "admin" ? {} : { ownerId: user.id };

    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        price: true,
        imageUrl: true,
        createdAt: true,
        ProductVariant: {
          select: {
            id: true,
            name: true,
            price: true,
            stock: true,
            sku: true,
          },
        },
      },
    });

    // Mapeo a "variants" para el front
    const items = products.map((p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      imageUrl: p.imageUrl,
      createdAt: p.createdAt,
      variants: p.ProductVariant, // alias amigable
    }));

    return new Response(
      JSON.stringify({ items }),
      withCORS({ status: 200 }, origin)
    );
  } catch (e: any) {
    // 403 cuando no tiene rol o falla authz
    const status = e?.message === "FORBIDDEN" ? 403 : 400;
    return new Response(
      JSON.stringify({ error: e?.message || "BAD_REQUEST" }),
      withCORS({ status }, origin)
    );
  }
}
