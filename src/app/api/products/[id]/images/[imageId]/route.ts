import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireAuth } from "@/lib/auth";
import { v2 as cloudinary } from "cloudinary";

export const runtime = "nodejs";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

// DELETE /api/products/:id/images/:imageId - Eliminar una imagen
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; imageId: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const { id, imageId } = await ctx.params;
    const user = await requireAuth(req);

    // Verificar que el producto existe y pertenece al usuario
    const product = await prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, origin)
      );
    }

    if (product.ownerId !== user.sub) {
      return new Response(
        JSON.stringify({ error: "FORBIDDEN" }),
        withCORS({ status: 403 }, origin)
      );
    }

    // Buscar la imagen
    const image = await prisma.productImage.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      return new Response(
        JSON.stringify({ error: "IMAGE_NOT_FOUND" }),
        withCORS({ status: 404 }, origin)
      );
    }

    // Verificar que la imagen pertenece al producto
    if (image.productId !== id) {
      return new Response(
        JSON.stringify({ error: "IMAGE_PRODUCT_MISMATCH" }),
        withCORS({ status: 400 }, origin)
      );
    }

    // Eliminar de Cloudinary si existe
    if (image.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(image.imagePublicId);
      } catch (err) {
        console.error("Error eliminando de Cloudinary:", err);
      }
    }

    // Eliminar de la base de datos
    await prisma.productImage.delete({
      where: { id: imageId },
    });

    return new Response(
      null,
      withCORS({ status: 204 }, origin)
    );
  } catch (err: unknown) {
    console.error("Error en DELETE /api/products/:id/images/:imageId:", err);
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 }, origin)
    );
  }
}
