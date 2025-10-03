import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { v2 as cloudinary } from "cloudinary";

// Nos aseguramos Node runtime (subida a Cloudinary necesita Node APIs)
export const runtime = "nodejs";

// ===== Enums (coinciden con schema.prisma) =====
const KitEnum = z.enum(["HOME", "AWAY", "THIRD", "RETRO"]);
const ProductQuality = z.enum(["FAN", "PLAYER_VERSION"]);

// ===== Cloudinary config =====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const CLOUD_NAME =
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ||
  process.env.CLOUDINARY_CLOUD_NAME;

// ===== Helpers =====
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

function normalizeBaseAndQuality(base: z.infer<typeof BaseSchema>) {
  // basePrice preferido, si no viene tomamos legacy price
  const basePrice = base.basePrice ?? base.price;
  // quality preferida; si no viene mapeamos legacy type → quality
  const quality =
    base.quality ??
    (base.type === "PLAYER_VERSION"
      ? "PLAYER_VERSION"
      : base.type === "FAN"
      ? "FAN"
      : undefined);

  return { ...base, basePrice, quality };
}

// ===== Schemas =====
const VariantSchema = z.object({
  name: z.string().min(1),
  stock: z.coerce.number().int().min(0),
  price: z.coerce.number().int().min(0).optional().nullable(),
});

const BaseSchema = z.object({
  title: z.string().min(2),

  // compat + nuevo
  basePrice: z.coerce.number().int().min(0).optional(),
  price: z.coerce.number().int().min(0).optional(), // legacy

  description: z.string().optional(),
  size: z.string().optional(), // si luego lo eliminás del modelo, quítalo en otra migración

  // legacy 'type' → quality
  type: z.enum(["FAN", "PLAYER_VERSION"]).optional(),

  // nuevos metadatos
  seasonLabel: z.string().max(20).optional(),
  seasonStart: z.coerce.number().int().min(1900).max(2100).optional(),
  kit: KitEnum.optional(),
  quality: ProductQuality.optional(),
});

const CreateJsonSchema = BaseSchema.extend({
  variants: z.array(VariantSchema).min(1),
  imageUrl: z.string().url().optional(),
  imagePublicId: z.string().min(1).optional(),
}).refine((d) => !!d.imageUrl || !!d.imagePublicId, {
  message: "Debe proveer imageUrl o imagePublicId",
  path: ["imageUrl"],
});

// ========== CORS (preflight) ==========
export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

// ── GET /api/products ─────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const url = new URL(req.url);
    const QuerySchema = z.object({
      // búsqueda simple
      search: z.string().trim().optional(),
      // filtros nuevos (opcionales)
      kit: KitEnum.optional(),
      quality: ProductQuality.optional(),
      seasonStart: z.coerce.number().int().optional(),
      // orden y paginación
      sort: z
        .string()
        .regex(/^[a-zA-Z_]+:(asc|desc)$/)
        .default("createdAt:desc"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(12),
    });

    const parsed = QuerySchema.parse({
      search: url.searchParams.get("search") ?? undefined,
      kit: url.searchParams.get("kit") ?? undefined,
      quality: url.searchParams.get("quality") ?? undefined,
      seasonStart: url.searchParams.get("seasonStart") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const { search, kit, quality, seasonStart, sort, page, limit } = parsed;

    // Filtros (incluye metadatos nuevos; mantenemos ciertos campos legacy para compat)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      AND: [
        search && search.length > 0
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
                { seasonLabel: { contains: search, mode: "insensitive" } },
                // compat (si aún existen en tu modelo)
                { size: { contains: search, mode: "insensitive" } },
                { type: { contains: search, mode: "insensitive" } },
              ],
            }
          : {},
        kit ? { kit } : {},
        quality ? { quality } : {},
        typeof seasonStart === "number" ? { seasonStart } : {},
      ],
    };

    // Orden (ampliamos whitelist)
    const [field, dir] = sort.split(":") as [string, "asc" | "desc"];
    const allowed = new Set(["createdAt", "title", "basePrice", "seasonStart"]);
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
          basePrice: true, // ← nuevo
          description: true,
          // imagen
          imageUrl: true,
          imagePublicId: true,
          // metadatos nuevos
          seasonLabel: true,
          seasonStart: true,
          kit: true,
          quality: true,
          createdAt: true,
          // variantes si necesitás en listing:
          ProductVariant: {
            select: { id: true, name: true, stock: true, price: true },
          },
        },
      }),
    ]);

    // Garantizamos imageUrl válida con Cloudinary si hay publicId
    const items = rawItems.map((p) => {
      let url = p.imageUrl ?? "";
      if (!url && p.imagePublicId) url = makeCldUrl(p.imagePublicId);
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
    console.error("Error en POST /api/products:", err);
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
      basePrice: number;
      description: string | null;
      // legacy (mantenelos hasta limpiar modelo/UX)
      size: string | null;
      type: "FAN" | "PLAYER_VERSION" | null;

      // nuevos metadatos
      seasonLabel: string | null;
      seasonStart: number | null;
      kit: z.infer<typeof KitEnum> | null;
      quality: z.infer<typeof ProductQuality> | null;

      imageUrl: string;
      imagePublicId: string | null;
      variants: z.infer<typeof VariantSchema>[];
    };

    if (ct.includes("multipart/form-data")) {
      // -------- multipart/form-data --------
      const fd = await req.formData();

      const base = BaseSchema.parse({
        title: fd.get("title"),
        basePrice: fd.get("basePrice"),
        price: fd.get("price"), // compat
        description: fd.get("description") || undefined,
        size: fd.get("size") || undefined, // compat
        type: fd.get("type") || undefined, // compat
        seasonLabel: fd.get("seasonLabel") || undefined,
        seasonStart: fd.get("seasonStart") || undefined,
        kit: fd.get("kit") || undefined,
        quality: fd.get("quality") || undefined,
      });
      const norm = normalizeBaseAndQuality(base);

      if (typeof norm.basePrice !== "number") {
        return new Response(
          JSON.stringify({
            error: "BAD_REQUEST",
            message: "basePrice o price requeridos",
          }),
          withCORS(
            { status: 400, headers: { "Content-Type": "application/json" } },
            origin
          )
        );
      }

      // variants (string JSON)
      const raw = fd.get("variants");
      const variants = z
        .array(VariantSchema)
        .min(1)
        .parse(typeof raw === "string" ? JSON.parse(raw) : raw);

      // Imagen obligatoria (aquí subimos a Cloudinary)
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
        basePrice: norm.basePrice,
        description: base.description ?? null,
        size: base.size ?? null, // compat
        type: base.type ?? null, // compat
        seasonLabel: norm.seasonLabel ?? null,
        seasonStart: norm.seasonStart ?? null,
        kit: norm.kit ?? null,
        quality: norm.quality ?? null,
        imageUrl: secure_url,
        imagePublicId: public_id,
        variants,
      };
    } else {
      // -------- application/json --------
      const json = await req.json();
      const dto = CreateJsonSchema.parse(json);
      const norm = normalizeBaseAndQuality(dto);

      if (typeof norm.basePrice !== "number") {
        return new Response(
          JSON.stringify({
            error: "BAD_REQUEST",
            message: "basePrice o price requeridos",
          }),
          withCORS(
            { status: 400, headers: { "Content-Type": "application/json" } },
            origin
          )
        );
      }

      // Si mandan sólo publicId, construimos URL de delivery; si mandan ambos, usamos imageUrl
      const effectiveImageUrl =
        dto.imageUrl ??
        (dto.imagePublicId ? makeCldUrl(dto.imagePublicId) : "");
      if (!effectiveImageUrl) {
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
        basePrice: norm.basePrice,
        description: dto.description ?? null,
        size: dto.size ?? null, // compat
        type: dto.type ?? null, // compat
        seasonLabel: norm.seasonLabel ?? null,
        seasonStart: norm.seasonStart ?? null,
        kit: norm.kit ?? null,
        quality: norm.quality ?? null,
        imageUrl: effectiveImageUrl,
        imagePublicId: dto.imagePublicId ?? null,
        variants: dto.variants,
      };
    }

    const created = await prisma.product.create({
      data: {
        title: dataForDb.title,
        description: dataForDb.description,
        basePrice: dataForDb.basePrice,

        // metadatos nuevos
        seasonLabel: dataForDb.seasonLabel,
        seasonStart: dataForDb.seasonStart,
        kit: dataForDb.kit,
        quality: dataForDb.quality,

        // imagen
        imageUrl: dataForDb.imageUrl,
        imagePublicId: dataForDb.imagePublicId,

        // owner
        ownerId: String(sub),

        // variantes
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
    console.error("Error en POST /api/products:", err);
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
