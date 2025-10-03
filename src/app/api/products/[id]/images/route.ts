import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireAuth } from "@/lib/auth";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";

export const runtime = "nodejs";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
const CLOUD_NAME =
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
  process.env.CLOUDINARY_CLOUD_NAME;

function makeCldUrl(publicId: string, transform = "f_auto,q_auto") {
  if (!CLOUD_NAME) return "";
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transform}/${publicId}`;
}

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

// POST /api/products/:id/images - Agregar imágenes adicionales
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const { id } = await ctx.params;
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

    const ct = req.headers.get("content-type") || "";

    if (ct.includes("multipart/form-data")) {
      // Subir múltiples imágenes
      const form = await req.formData();
      const files = form.getAll("images") as File[];
      const orderParam = form.get("order");
      let order = orderParam ? Number(orderParam) : 0;

      if (files.length === 0) {
        return new Response(
          JSON.stringify({ error: "NO_IMAGES" }),
          withCORS({ status: 400 }, origin)
        );
      }

      const uploadedImages = [];

      for (const file of files) {
        if (!(file instanceof File)) continue;

        if (file.size > MAX_BYTES) {
          return new Response(
            JSON.stringify({ error: "FILE_TOO_LARGE" }),
            withCORS({ status: 413 }, origin)
          );
        }

        if (!ALLOWED.includes(file.type || "")) {
          return new Response(
            JSON.stringify({ error: "INVALID_TYPE" }),
            withCORS({ status: 400 }, origin)
          );
        }

        const bytes = Buffer.from(await file.arrayBuffer());
        const dataUri = `data:${file.type};base64,${bytes.toString("base64")}`;
        const { secure_url, public_id } = await cloudinary.uploader.upload(
          dataUri,
          {
            folder: "hincha/products",
            resource_type: "image",
          }
        );

        uploadedImages.push({
          imageUrl: secure_url,
          imagePublicId: public_id,
          order: order++,
        });
      }

      // Crear las imágenes en la base de datos
      const created = await prisma.productImage.createMany({
        data: uploadedImages.map((img) => ({
          productId: id,
          ...img,
        })),
      });

      return new Response(
        JSON.stringify({ success: true, count: created.count }),
        withCORS({ status: 201 }, origin)
      );
    } else {
      // JSON con URLs pre-subidas (ej: desde upload-sign)
      const body = await req.json();
      const schema = z.object({
        images: z
          .array(
            z.object({
              imageUrl: z.string().url().optional(),
              imagePublicId: z.string().min(1).optional(),
              order: z.coerce.number().int().min(0).default(0),
            })
          )
          .min(1),
      });

      const { images } = schema.parse(body);

      const dataToInsert = images.map((img) => ({
        productId: id,
        imageUrl:
          img.imageUrl ?? (img.imagePublicId ? makeCldUrl(img.imagePublicId) : ""),
        imagePublicId: img.imagePublicId ?? null,
        order: img.order,
      }));

      const created = await prisma.productImage.createMany({
        data: dataToInsert,
      });

      return new Response(
        JSON.stringify({ success: true, count: created.count }),
        withCORS({ status: 201 }, origin)
      );
    }
  } catch (err: unknown) {
    console.error("Error en POST /api/products/:id/images:", err);
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 }, origin)
    );
  }
}
