import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { withCORS, preflight } from "@/lib/cors";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["seller", "admin"]);
    const products = await prisma.product.findMany({
      where: user.role === "admin" ? {} : { ownerId: user.id },
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
      },
    });
    // mapeo a "variants" por comodidad en el front
    const data = products.map((p) => ({ ...p, variants: p.ProductVariant }));
    return new Response(
      JSON.stringify({ items: data }),
      withCORS({ status: 200 }, origin)
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "FORBIDDEN" }),
      withCORS({ status: 403 }, origin)
    );
  }
}
