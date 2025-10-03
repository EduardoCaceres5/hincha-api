import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz"; // debe devolver { id, role }
import { withCORS, preflight } from "@/lib/cors"; // tus helpers CORS

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
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
        basePrice: true,
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
        ProductImage: {
          select: {
            id: true,
            imageUrl: true,
            imagePublicId: true,
            order: true,
          },
          orderBy: { order: "asc" },
        },
      },
    });

    // Mapeo a "variants" e "images" para el front
    const items = products.map((p) => ({
      id: p.id,
      title: p.title,
      price: p.basePrice,
      imageUrl: p.imageUrl,
      createdAt: p.createdAt,
      variants: p.ProductVariant, // alias amigable
      images: p.ProductImage, // imágenes adicionales
    }));

    return new Response(
      JSON.stringify({ items }),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "BAD_REQUEST";
    const status = message === "FORBIDDEN" ? 403 : 400;
    return new Response(
      JSON.stringify({ error: message }),
      withCORS({ status }, origin)
    );
  }
}
