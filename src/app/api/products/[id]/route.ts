import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireAuth } from "@/lib/auth";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { z } from "zod";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const { id } = await ctx.params; // 👈 await obligatorio
    if (!id || typeof id !== "string") {
      return new Response(
        JSON.stringify({ error: "INVALID_ID" }),
        withCORS({ status: 400 }, origin)
      );
    }

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
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

    if (!product) {
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, origin)
      );
    }

    return new Response(
      JSON.stringify(product),
      withCORS({ status: 200 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 }, origin)
    );
  }
}

// PUT /api/products/:id
const KitEnum = z.enum(["HOME", "AWAY", "THIRD", "RETRO"]);
const ProductQuality = z.enum(["FAN", "PLAYER_VERSION"]);

const updateSchema = z.object({
  title: z.string().min(3).optional(),
  basePrice: z.coerce.number().int().min(0).optional(),
  description: z.string().nullable().optional(),
  seasonLabel: z.string().max(20).nullable().optional(),
  seasonStart: z.coerce.number().int().min(1900).max(2100).nullable().optional(),
  kit: KitEnum.nullable().optional(),
  quality: ProductQuality.nullable().optional(),
  league: z.string().max(50).nullable().optional(),
  imageUrl: z.string().url().optional(),
  imagePublicId: z.string().nullable().optional(),
});

// Strongly-typed payload inferred from Zod schema
type UpdatePayload = z.infer<typeof updateSchema>;
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    await requireAuth(req);
    const existing = await prisma.product.findUnique({
      where: { id: id },
    });
    if (!existing)
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, req.headers.get("origin"))
      );

    const ct = req.headers.get("content-type") || "";
    let payload!: UpdatePayload;
    let newImageUrl: string | undefined;
    let newPublicId: string | undefined;
    let uploadedImages: Array<{ url: string; publicId: string }> = [];

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const data: Partial<UpdatePayload> = {};
      // campos de texto
      for (const k of [
        "title",
        "basePrice",
        "description",
        "seasonLabel",
        "seasonStart",
        "kit",
        "quality",
        "league",
      ] as const) {
        const v = form.get(k);
        if (v !== null && v !== undefined) {
          if (typeof v === "string" && v !== "") {
            switch (k) {
              case "basePrice":
                data.basePrice = Number(v);
                break;
              case "seasonStart":
                data.seasonStart = Number(v);
                break;
              case "title":
                data.title = v;
                break;
              case "description":
                data.description = v;
                break;
              case "seasonLabel":
                data.seasonLabel = v;
                break;
              case "kit":
                data.kit = v as z.infer<typeof KitEnum>;
                break;
              case "quality":
                data.quality = v as z.infer<typeof ProductQuality>;
                break;
              case "league":
                data.league = v;
                break;
            }
          } else if (v === "") {
            // Permitir limpiar campos nullable
            if (k === "description" || k === "seasonLabel" || k === "kit" || k === "quality" || k === "league" || k === "seasonStart") {
              data[k] = null;
            }
          }
        }
      }
      payload = updateSchema.parse(data);

      // Imágenes múltiples
      const images = form.getAll("images") as File[];

      if (images.length > 0) {
        for (const file of images) {
          if (!(file instanceof File) || !file.size) continue;

          if (file.size > MAX_BYTES)
            return new Response(
              JSON.stringify({ error: "FILE_TOO_LARGE" }),
              withCORS({ status: 413 }, req.headers.get("origin"))
            );
          if (!ALLOWED.includes(file.type || ""))
            return new Response(
              JSON.stringify({ error: "INVALID_TYPE" }),
              withCORS({ status: 400 }, req.headers.get("origin"))
            );

          const buffer = Buffer.from(await file.arrayBuffer());
          const uploaded = await new Promise<UploadApiResponse>(
            (resolve, reject) => {
              const stream = cloudinary.uploader.upload_stream(
                {
                  folder: process.env.CLOUDINARY_FOLDER || "hincha-store",
                  resource_type: "image",
                },
                (error, result) =>
                  error || !result
                    ? reject(error || new Error("Upload failed"))
                    : resolve(result)
              );
              stream.end(buffer);
            }
          );
          uploadedImages.push({
            url: uploaded.secure_url,
            publicId: uploaded.public_id,
          });
        }

        // La primera imagen se guarda como imagen principal
        if (uploadedImages.length > 0) {
          newImageUrl = uploadedImages[0].url;
          newPublicId = uploadedImages[0].publicId;
        }
      }
    } else {
      // JSON
      const body: unknown = await req.json().catch(() => ({}));
      payload = updateSchema.parse(body);
    }

    // Si se subieron nuevas imágenes, eliminamos las antiguas
    if (uploadedImages.length > 0) {
      // Eliminar imagen principal anterior
      if (existing.imagePublicId) {
        try {
          await cloudinary.uploader.destroy(existing.imagePublicId);
        } catch {}
      }

      // Eliminar todas las imágenes adicionales anteriores
      const oldImages = await prisma.productImage.findMany({
        where: { productId: existing.id },
      });

      for (const img of oldImages) {
        if (img.imagePublicId) {
          try {
            await cloudinary.uploader.destroy(img.imagePublicId);
          } catch {}
        }
      }

      // Eliminar registros de ProductImage antiguos
      await prisma.productImage.deleteMany({
        where: { productId: existing.id },
      });

      // Crear nuevos registros de ProductImage (TODAS las imágenes)
      if (uploadedImages.length > 0) {
        await prisma.productImage.createMany({
          data: uploadedImages.map((img, index) => ({
            productId: existing.id,
            imageUrl: img.url,
            imagePublicId: img.publicId,
            order: index,
          })),
        });
      }
    }

    const updated = await prisma.product.update({
      where: { id: existing.id },
      data: {
        ...payload,
        ...(newImageUrl
          ? { imageUrl: newImageUrl, imagePublicId: newPublicId }
          : {}),
      },
      include: {
        ProductVariant: true,
        ProductImage: true,
      },
    });

    return new Response(
      JSON.stringify(updated),
      withCORS({ status: 200 }, req.headers.get("origin"))
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST" }),
      withCORS({ status: 400 }, req.headers.get("origin"))
    );
  }
}

// DELETE /api/products/:id
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    await requireAuth(req);
    const existing = await prisma.product.findUnique({
      where: { id: id },
      include: { ProductImage: true },
    });
    if (!existing)
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, req.headers.get("origin"))
      );

    // Eliminar imagen principal
    if (existing.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(existing.imagePublicId);
      } catch {}
    }

    // Eliminar imágenes adicionales
    for (const img of existing.ProductImage) {
      if (img.imagePublicId) {
        try {
          await cloudinary.uploader.destroy(img.imagePublicId);
        } catch {}
      }
    }

    await prisma.product.delete({ where: { id: existing.id } });
    return new Response(
      null,
      withCORS({ status: 204 }, req.headers.get("origin"))
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST" }),
      withCORS({ status: 400 }, req.headers.get("origin"))
    );
  }
}
