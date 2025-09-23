import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";

const VariantSchema = z.object({
  name: z.string().min(1),
  stock: z.coerce.number().int().min(0),
  price: z.coerce.number().int().min(0).optional().nullable(),
});

const BaseSchema = z.object({
  title: z.string().min(2),
  price: z.coerce.number().int().min(0),
  description: z.string().optional(),
});

const CreateJsonSchema = BaseSchema.extend({
  imageUrl: z.string().url(),
  variants: z.array(VariantSchema).min(1),
});

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

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

    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

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

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const { sub } = await requireAuth(req);

    const ct = req.headers.get("content-type") || "";

    let dto: z.infer<typeof CreateJsonSchema>;

    if (ct.includes("multipart/form-data")) {
      // ---------- multipart/form-data ----------
      const fd = await req.formData();

      const base = BaseSchema.parse({
        title: fd.get("title"),
        price: fd.get("price"),
        description: fd.get("description") || undefined,
      });

      // variants viene como string JSON en form-data
      const variantsRaw = fd.get("variants");
      const variants = z
        .array(VariantSchema)
        .min(1)
        .parse(
          typeof variantsRaw === "string"
            ? JSON.parse(variantsRaw)
            : variantsRaw
        );

      // Imagen obligatoria (File)
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

      // Subida de imagen (ejemplo/placeholder)
      // const bytes = await imageEntry.arrayBuffer();
      // const buffer = Buffer.from(bytes);
      // const { secure_url, public_id } = await uploadToCloudinary(buffer);
      const secure_url = "https://via.placeholder.com/640x640?text=Hincha";
      // const public_id = null;

      dto = { ...base, imageUrl: secure_url, variants };
    } else {
      // ---------- application/json ----------
      const json = await req.json();
      dto = CreateJsonSchema.parse(json);
    }

    // Crear producto + variantes
    const created = await prisma.product.create({
      data: {
        title: dto.title,
        price: dto.price,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl,
        ownerId: String(sub),
        ProductVariant: { createMany: { data: dto.variants } },
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
