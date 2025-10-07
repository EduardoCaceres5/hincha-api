import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireRole } from "@/lib/authz";
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

// POST /api/transactions/:id/images - Agregar imágenes
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const { id } = await ctx.params;
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

    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const files = form.getAll("images");
      const startOrder = Number(form.get("order") || 0);
      let order = Number.isFinite(startOrder) ? startOrder : 0;

      if (files.length === 0) {
        return new Response(
          JSON.stringify({ error: "NO_IMAGES" }),
          withCORS({ status: 400 }, origin)
        );
      }

      const createdImages = [] as Array<{
        imageUrl: string;
        imagePublicId: string;
        order: number;
      }>;
      for (const f of files) {
        if (!(f instanceof File)) continue;
        if (f.size > MAX_BYTES) {
          return new Response(
            JSON.stringify({ error: "FILE_TOO_LARGE" }),
            withCORS({ status: 413 }, origin)
          );
        }
        if (!ALLOWED.includes(f.type || "")) {
          return new Response(
            JSON.stringify({ error: "INVALID_TYPE" }),
            withCORS({ status: 400 }, origin)
          );
        }
        const bytes = Buffer.from(await f.arrayBuffer());
        const dataUri = `data:${f.type};base64,${bytes.toString("base64")}`;
        const { secure_url, public_id } = await cloudinary.uploader.upload(
          dataUri,
          { folder: "hincha/transactions", resource_type: "image" }
        );
        createdImages.push({
          imageUrl: secure_url,
          imagePublicId: public_id,
          order: order++,
        });
      }

      const created = await prisma.transactionImage.createMany({
        data: createdImages.map((img) => ({ transactionId: id, ...img })),
      });
      return new Response(
        JSON.stringify({ success: true, count: created.count }),
        withCORS({ status: 201 }, origin)
      );
    } else {
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

      const data = images.map((img) => ({
        transactionId: id,
        imageUrl:
          img.imageUrl ??
          (img.imagePublicId ? makeCldUrl(img.imagePublicId) : ""),
        imagePublicId: img.imagePublicId ?? null,
        order: img.order,
      }));
      const created = await prisma.transactionImage.createMany({ data });
      return new Response(
        JSON.stringify({ success: true, count: created.count }),
        withCORS({ status: 201 }, origin)
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 }, origin)
    );
  }
}
