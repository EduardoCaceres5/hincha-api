// src/app/api/products/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { v2 as cloudinary } from "cloudinary";

// Nos aseguramos Node runtime (subida a Cloudinary necesita Node APIs)
export const runtime = "nodejs";

// Config Cloudinary (usa variables del servidor)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const CLOUD_NAME =
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
  process.env.CLOUDINARY_CLOUD_NAME;

// Helpers
function isAbsoluteUrl(u: string) {
  try {
    const x = new URL(u);
    return !!x.protocol && !!x.host;
  } catch {
    return false;
  }
}

function makeCldUrl(publicId: string, transform = "f_auto,q_auto") {
  if (!CLOUD_NAME) return ""; // evita romper si no está configurado
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transform}/${publicId}`;
}

// ── Schemas ────────────────────────────────────────────────────────────
const VariantSchema = z.object({
  name: z.string().min(1),
  stock: z.coerce.number().int().min(0),
  price: z.coerce.number().int().min(0).optional().nullable(),
});

const BaseSchema = z.object({
  title: z.string().min(2),
  price: z.coerce.number().int().min(0),
  description: z.string().optional(),
  size: z.string().optional(),
  condition: z.enum(["Nuevo", "Usado"]).optional(),
});

const CreateJsonSchema = BaseSchema.extend({
  variants: z.array(VariantSchema).min(1),
  imageUrl: z.string().url().optional(),
  imagePublicId: z.string().min(1).optional(),
}).refine((d) => !!d.imageUrl || !!d.imagePublicId, {
  message: "Debe proveer imageUrl o imagePublicId",
  path: ["imageUrl"],
});

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

// ── GET /api/products ─────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const url = new URL(req.url);
    const QuerySchema = z.object({
      search: z.string().trim().optional(),
      sort: z
        .string()
        .regex(/^[a-zA-Z_]+:(asc|desc)$/)
        .default("createdAt:desc"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(12),
    });

    const { search, sort, page, limit } = QuerySchema.parse({
      search: url.searchParams.get("search") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const where =
      search && search.length > 0
        ? {
            OR: [
              { title: { contains: search } },
              { description: { contains: search } },
              { size: { contains: search } },
              { condition: { contains: search } },
            ],
          }
        : {};

    const [field, dir] = sort.split(":") as [string, "asc" | "desc"];
    const allowed = new Set(["createdAt", "price", "title"]);
    const orderBy = allowed.has(field)
      ? ({ [field]: dir } as const)
      : ({ createdAt: "desc" } as const);

    const [total, rawItems] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          title: true,
          price: true,
          description: true,
          size: true,
          condition: true,
          imageUrl: true,
          imagePublicId: true,
          createdAt: true,
        },
      }),
    ]);

    // Aseguramos que imageUrl sea una URL Cloudinary válida, aun si solo hay publicId
    const items = rawItems.map((p) => {
      let url = p.imageUrl ?? "";
      if (!url && p.imagePublicId) url = makeCldUrl(p.imagePublicId);
      // Si imageUrl existe pero no es absoluta (por ej guardaron publicId por error)
      if (url && !isAbsoluteUrl(url) && p.imagePublicId) {
        url = makeCldUrl(p.imagePublicId);
      }
      return { ...p, imageUrl: url };
    });

    return new Response(
      JSON.stringify({ items, total, page, limit }),
      withCORS(
        { status: 200, headers: { "Content-Type": "application/json" } },
        origin
      )
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS(
        { status: 400, headers: { "Content-Type": "application/json" } },
        origin
      )
    );
  }
}

// ── POST /api/products ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const { sub } = await requireAuth(req);

    const ct = req.headers.get("content-type") || "";
    let dataForDb: {
      title: string;
      price: number;
      description: string | null;
      size: string | null;
      condition: "Nuevo" | "Usado" | null;
      imageUrl: string;
      imagePublicId: string | null;
      variants: z.infer<typeof VariantSchema>[];
    };

    if (ct.includes("multipart/form-data")) {
      // -------- multipart/form-data --------
      const fd = await req.formData();

      const base = BaseSchema.parse({
        title: fd.get("title"),
        price: fd.get("price"),
        description: fd.get("description") || undefined,
        size: fd.get("size") || undefined,
        condition: fd.get("condition") || undefined,
      });

      // variants (string JSON)
      const raw = fd.get("variants");
      const variants = z
        .array(VariantSchema)
        .min(1)
        .parse(typeof raw === "string" ? JSON.parse(raw) : raw);

      // Imagen obligatoria
      const imageEntry = fd.get("image");
      if (!(imageEntry instanceof File)) {
        return new Response(
          JSON.stringify({ error: "BAD_REQUEST", message: "Imagen requerida" }),
          withCORS(
            { status: 400, headers: { "Content-Type": "application/json" } },
            origin
          )
        );
      }

      // Subida a Cloudinary
      const bytes = Buffer.from(await imageEntry.arrayBuffer());
      const dataUri = `data:${imageEntry.type};base64,${bytes.toString(
        "base64"
      )}`;
      const { secure_url, public_id } = await cloudinary.uploader.upload(
        dataUri,
        {
          folder: "hincha/products",
          resource_type: "image",
        }
      );

      dataForDb = {
        title: base.title,
        price: base.price,
        description: base.description ?? null,
        size: base.size ?? null,
        condition: (base.condition as any) ?? null,
        imageUrl: secure_url, // https
        imagePublicId: public_id,
        variants,
      };
    } else {
      // -------- application/json --------
      const json = await req.json();
      const dto = CreateJsonSchema.parse(json);

      // Si mandan sólo publicId, construimos URL de delivery; si mandan ambos, usamos imageUrl
      const imageUrl =
        dto.imageUrl ??
        (dto.imagePublicId ? makeCldUrl(dto.imagePublicId) : "");
      if (!imageUrl) {
        return new Response(
          JSON.stringify({
            error: "BAD_REQUEST",
            message: "imageUrl o imagePublicId requerido",
          }),
          withCORS(
            { status: 400, headers: { "Content-Type": "application/json" } },
            origin
          )
        );
      }

      dataForDb = {
        title: dto.title,
        price: dto.price,
        description: dto.description ?? null,
        size: dto.size ?? null,
        condition: (dto.condition as any) ?? null,
        imageUrl,
        imagePublicId: dto.imagePublicId ?? null,
        variants: dto.variants,
      };
    }

    const created = await prisma.product.create({
      data: {
        title: dataForDb.title,
        price: dataForDb.price,
        description: dataForDb.description,
        size: dataForDb.size,
        condition: dataForDb.condition,
        imageUrl: dataForDb.imageUrl,
        imagePublicId: dataForDb.imagePublicId,
        ownerId: String(sub),
        ProductVariant: { createMany: { data: dataForDb.variants } },
      },
      include: { ProductVariant: true },
    });

    return new Response(
      JSON.stringify(created),
      withCORS(
        { status: 201, headers: { "Content-Type": "application/json" } },
        origin
      )
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS(
        { status: 400, headers: { "Content-Type": "application/json" } },
        origin
      )
    );
  }
}
