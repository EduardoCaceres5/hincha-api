export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { withCORS, preflight } from "@/lib/cors";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    await requireAuth(req);
    const { ids } = (await req.json()) as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "INVALID_BODY" }),
        withCORS({ status: 400 }, origin)
      );
    }

    // Traer productos
    const products = await prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, imagePublicId: true },
    });
    if (products.length === 0) {
      return new Response(
        JSON.stringify({ deleted: 0 }),
        withCORS({ status: 200 }, origin)
      );
    }

    // Borrar imágenes en Cloudinary en paralelo (ignorar errores individuales)
    await Promise.all(
      products.map((p) =>
        p.imagePublicId
          ? cloudinary.uploader.destroy(p.imagePublicId).catch(() => {})
          : Promise.resolve()
      )
    );

    // Borrar en DB (transacción)
    await prisma.$transaction([
      prisma.product.deleteMany({
        where: {
          id: { in: products.map((p) => p.id) },
        },
      }),
    ]);

    return new Response(
      JSON.stringify({ deleted: products.length }),
      withCORS({ status: 200 }, origin)
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST" }),
      withCORS({ status: 400 }, origin)
    );
  }
}
