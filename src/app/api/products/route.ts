import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";

const VariantSchema = z.object({
  name: z.string().min(1),
  stock: z.number().int().min(0),
  price: z.number().int().min(0).optional(),
});
const CreateSchema = z.object({
  title: z.string().min(2),
  price: z.number().int().min(0), // base
  description: z.string().optional(),
  imageUrl: z.string().url(),
  variants: z.array(VariantSchema).min(1), // 👈 al menos una variante
});

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

const QuerySchema = z.object({
  search: z.string().trim().optional(),
  sort: z
    .string()
    .regex(/^[a-zA-Z_]+:(asc|desc)$/)
    .default("createdAt:desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const url = new URL(req.url);
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
      prisma.product.count({ where }), // ✅ sin `select`
      prisma.product.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return new Response(
      JSON.stringify({ items, total, page, limit }),
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

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const { sub } = await requireAuth(req);
    const body = await req.json();
    const dto = CreateSchema.parse(body);

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
      withCORS({ status: 201 }, origin)
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 }, origin)
    );
  }
}
