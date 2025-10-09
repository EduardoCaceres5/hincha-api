import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { v2 as cloudinary } from "cloudinary";
import { instagramService } from "@/lib/instagram";

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
  // nuevos campos de compra
  purchasePrice: z.coerce.number().int().min(0).optional(),
  purchaseUrl: z.string().url().optional(),

  // legacy 'type' → quality
  type: z.enum(["FAN", "PLAYER_VERSION"]).optional(),

  // nuevos metadatos
  seasonLabel: z.string().max(20).optional(),
  seasonStart: z.coerce.number().int().min(1900).max(2100).optional(),
  kit: KitEnum.optional(),
  quality: ProductQuality.optional(),
  league: z.string().max(50).optional(),
});

const ImageSchema = z
  .object({
    imageUrl: z.string().url().optional(),
    imagePublicId: z.string().min(1).optional(),
    order: z.coerce.number().int().min(0).default(0),
  })
  .refine((d) => !!d.imageUrl || !!d.imagePublicId, {
    message: "Debe proveer imageUrl o imagePublicId",
  });

const CreateJsonSchema = BaseSchema.extend({
  variants: z.array(VariantSchema).min(1),
  imageUrl: z.string().url().optional(),
  imagePublicId: z.string().min(1).optional(),
  images: z.array(ImageSchema).optional(),
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
      league: z.string().optional(),
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
      league: url.searchParams.get("league") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const { search, kit, quality, seasonStart, league, sort, page, limit } =
      parsed;

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
              ],
            }
          : {},
        kit ? { kit } : {},
        quality ? { quality } : {},
        typeof seasonStart === "number" ? { seasonStart } : {},
        league ? { league: { contains: league, mode: "insensitive" } } : {},
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
          purchasePrice: true,
          purchaseUrl: true,
          // imagen
          imageUrl: true,
          imagePublicId: true,
          // metadatos nuevos
          seasonLabel: true,
          seasonStart: true,
          kit: true,
          quality: true,
          league: true,
          createdAt: true,
          // variantes si necesitás en listing:
          ProductVariant: {
            select: { id: true, name: true, stock: true, price: true },
          },
          // múltiples imágenes
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
    console.error("Error en GET /api/products:", err);
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
      purchasePrice: number | null;
      purchaseUrl: string | null;

      // nuevos metadatos
      seasonLabel: string | null;
      seasonStart: number | null;
      kit: z.infer<typeof KitEnum> | null;
      quality: z.infer<typeof ProductQuality> | null;
      league: string | null;

      imageUrl: string;
      imagePublicId: string | null;
      variants: z.infer<typeof VariantSchema>[];
      additionalImages?: Array<{
        imageUrl: string;
        imagePublicId: string;
        order: number;
      }>;
    };

    if (ct.includes("multipart/form-data")) {
      // -------- multipart/form-data --------
      const fd = await req.formData();

      const base = BaseSchema.parse({
        title: fd.get("title"),
        basePrice: fd.get("basePrice"),
        price: fd.get("price"), // compat
        description: fd.get("description") || undefined,
        purchasePrice: fd.get("purchasePrice") || undefined,
        purchaseUrl: fd.get("purchaseUrl") || undefined,
        type: fd.get("type") || undefined, // compat
        seasonLabel: fd.get("seasonLabel") || undefined,
        seasonStart: fd.get("seasonStart") || undefined,
        kit: fd.get("kit") || undefined,
        quality: fd.get("quality") || undefined,
        league: fd.get("league") || undefined,
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

      // Imágenes (soporta "image" singular o "images" múltiple)
      const imageFiles: File[] = [];
      const singleImage = fd.get("image");
      const multipleImages = fd.getAll("images");

      if (singleImage instanceof File) {
        imageFiles.push(singleImage);
      } else if (multipleImages.length > 0) {
        for (const img of multipleImages) {
          if (img instanceof File) imageFiles.push(img);
        }
      }

      if (imageFiles.length === 0) {
        return new Response(
          JSON.stringify({
            error: "BAD_REQUEST",
            message: "Al menos una imagen es requerida",
          }),
          withCORS(
            { status: 400, headers: { "Content-Type": "application/json" } },
            origin
          )
        );
      }

      // Subir primera imagen como principal
      const mainImageFile = imageFiles[0];
      const mainBytes = Buffer.from(await mainImageFile.arrayBuffer());
      const mainDataUri = `data:${
        mainImageFile.type
      };base64,${mainBytes.toString("base64")}`;
      const mainUpload = await cloudinary.uploader.upload(mainDataUri, {
        folder: "hincha/products",
        resource_type: "image",
      });

      // Subir TODAS las imágenes a ProductImage (incluida la principal)
      const additionalImages: Array<{
        imageUrl: string;
        imagePublicId: string;
        order: number;
      }> = [];

      // Agregar la primera imagen también a ProductImage
      additionalImages.push({
        imageUrl: mainUpload.secure_url,
        imagePublicId: mainUpload.public_id,
        order: 0,
      });

      // Subir el resto de las imágenes
      for (let i = 1; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        const bytes = Buffer.from(await file.arrayBuffer());
        const dataUri = `data:${file.type};base64,${bytes.toString("base64")}`;
        const { secure_url, public_id } = await cloudinary.uploader.upload(
          dataUri,
          {
            folder: "hincha/products",
            resource_type: "image",
          }
        );
        additionalImages.push({
          imageUrl: secure_url,
          imagePublicId: public_id,
          order: i,
        });
      }

      dataForDb = {
        title: base.title,
        basePrice: norm.basePrice,
        description: base.description ?? null,
        purchasePrice: base.purchasePrice ?? null,
        purchaseUrl: base.purchaseUrl ?? null,
        seasonLabel: norm.seasonLabel ?? null,
        seasonStart: norm.seasonStart ?? null,
        kit: norm.kit ?? null,
        quality: norm.quality ?? null,
        league: norm.league ?? null,
        imageUrl: mainUpload.secure_url,
        imagePublicId: mainUpload.public_id,
        variants,
        additionalImages,
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
        purchasePrice: dto.purchasePrice ?? null,
        purchaseUrl: dto.purchaseUrl ?? null,
        seasonLabel: norm.seasonLabel ?? null,
        seasonStart: norm.seasonStart ?? null,
        kit: norm.kit ?? null,
        quality: norm.quality ?? null,
        league: norm.league ?? null,
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
        league: dataForDb.league,

        // compra
        purchasePrice: dataForDb.purchasePrice,
        purchaseUrl: dataForDb.purchaseUrl,

        // imagen
        imageUrl: dataForDb.imageUrl,
        imagePublicId: dataForDb.imagePublicId,

        // owner
        ownerId: String(sub),

        // variantes
        ProductVariant: { createMany: { data: dataForDb.variants } },

        // todas las imágenes en ProductImage
        ProductImage:
          dataForDb.additionalImages && dataForDb.additionalImages.length > 0
            ? { createMany: { data: dataForDb.additionalImages } }
            : undefined,
      },
      include: {
        ProductVariant: true,
        ProductImage: true,
      },
    });

    // Publicar en Instagram de forma asíncrona (no bloquea la respuesta)
    if (instagramService) {
      const imageUrls =
        dataForDb.additionalImages && dataForDb.additionalImages.length > 0
          ? dataForDb.additionalImages.map((img) => img.imageUrl)
          : [dataForDb.imageUrl];

      instagramService
        .publishAuto({
          title: dataForDb.title,
          description: dataForDb.description ?? undefined,
          imageUrls,
          basePrice: dataForDb.basePrice,
          league: dataForDb.league ?? undefined,
          kit: dataForDb.kit ?? undefined,
          quality: dataForDb.quality ?? undefined,
          seasonLabel: dataForDb.seasonLabel ?? undefined,
        })
        .then((postId) => {
          console.log(
            `✅ Producto "${dataForDb.title}" publicado en Instagram: ${postId}`
          );
        })
        .catch((error) => {
          console.error(
            `❌ Error publicando en Instagram el producto "${dataForDb.title}":`,
            error.message
          );
          // No falla la creación del producto si Instagram falla
        });
    }

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
