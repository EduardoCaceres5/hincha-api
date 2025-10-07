import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireRole } from "@/lib/authz";
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

// DELETE /api/transactions/:id/images/:imageId
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; imageId: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const { id, imageId } = await ctx.params;
    const user = await requireRole(req, ["admin", "seller"]);

    const trx = await prisma.transaction.findUnique({ where: { id } });
    if (!trx) {
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, origin)
      );
    }
    if (user.role === "seller" && trx.userId !== user.id) {
      return new Response(
        JSON.stringify({ error: "FORBIDDEN" }),
        withCORS({ status: 403 }, origin)
      );
    }

    const image = await prisma.transactionImage.findUnique({
      where: { id: imageId },
    });
    if (!image) {
      return new Response(
        JSON.stringify({ error: "IMAGE_NOT_FOUND" }),
        withCORS({ status: 404 }, origin)
      );
    }
    if (image.transactionId !== id) {
      return new Response(
        JSON.stringify({ error: "IMAGE_TRANSACTION_MISMATCH" }),
        withCORS({ status: 400 }, origin)
      );
    }

    if (image.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(image.imagePublicId);
      } catch (err) {
        console.error("Error eliminando de Cloudinary:", err);
      }
    }

    await prisma.transactionImage.delete({ where: { id: imageId } });
    return new Response(null, withCORS({ status: 204 }, origin));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 }, origin)
    );
  }
}
