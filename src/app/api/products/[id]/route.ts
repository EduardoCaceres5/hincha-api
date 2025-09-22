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
  return preflight(req.headers.get("origin"));
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

// PUT /api/products/:id (protegido, solo dueño)
const updateSchema = z.object({
  title: z.string().min(3).optional(),
  price: z.coerce.number().int().min(0).optional(),
  size: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().url().optional(),
});

// Strongly-typed payload inferred from Zod schema
type UpdatePayload = z.infer<typeof updateSchema>;
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const user = await requireAuth(req);
    const existing = await prisma.product.findUnique({
      where: { id: id },
    });
    if (!existing)
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, req.headers.get("origin"))
      );
    if (existing.ownerId !== user.sub)
      return new Response(
        JSON.stringify({ error: "FORBIDDEN" }),
        withCORS({ status: 403 }, req.headers.get("origin"))
      );

    const ct = req.headers.get("content-type") || "";
    let data: Partial<UpdatePayload> = {};
    let payload!: UpdatePayload;
    let newImageUrl: string | undefined;
    let newPublicId: string | undefined;

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      // campos de texto
      for (const k of [
        "title",
        "price",
        "size",
        "condition",
        "description",
      ] as const) {
        const v = form.get(k);
        if (typeof v === "string" && v !== "") {
          switch (k) {
            case "price":
              data.price = Number(v);
              break;
            case "title":
              data.title = v;
              break;
            case "size":
              data.size = v;
              break;
            case "condition":
              data.condition = v;
              break;
            case "description":
              data.description = v;
              break;
          }
        }
      }
      payload = updateSchema.parse(data);

      // imagen opcional
      const file = form.get("image") as File | null;
      if (file && file.size) {
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
        newImageUrl = uploaded.secure_url;
        newPublicId = uploaded.public_id;
      }
    } else {
      // JSON
      const body: unknown = await req.json().catch(() => ({}));
      payload = updateSchema.parse(body);
      data = updateSchema.parse(body);
    }

    // si reemplazamos imagen, borramos la anterior
    if (newImageUrl && existing.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(existing.imagePublicId);
      } catch {}
    }

    const updated = await prisma.product.update({
      where: { id: existing.id },
      data: {
        ...payload,
        ...(newImageUrl
          ? { imageUrl: newImageUrl, imagePublicId: newPublicId }
          : {}),
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

// DELETE /api/products/:id (protegido, solo dueño)
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const user = await requireAuth(req);
    const existing = await prisma.product.findUnique({
      where: { id: id },
    });
    if (!existing)
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, req.headers.get("origin"))
      );
    if (existing.ownerId !== user.sub)
      return new Response(
        JSON.stringify({ error: "FORBIDDEN" }),
        withCORS({ status: 403 }, req.headers.get("origin"))
      );

    if (existing.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(existing.imagePublicId);
      } catch {}
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
