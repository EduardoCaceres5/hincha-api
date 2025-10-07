import { NextRequest } from "next/server";
import { withCORS, preflight } from "@/lib/cors";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { z } from "zod";
import { v2 as cloudinary } from "cloudinary";

// Prisma necesita Node runtime
export const runtime = "nodejs";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

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

// ===== Schemas =====
const TransactionTypeEnum = z.enum(["INCOME", "EXPENSE"]);

const CreateSchema = z.object({
  type: TransactionTypeEnum,
  amount: z.coerce.number().int().min(0), // Gs
  description: z.string().trim().max(500).optional(),
  category: z.string().trim().max(80).optional(),
  occurredAt: z.coerce.date().optional(),
});

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["admin", "seller"]);
    const url = new URL(req.url);

    const Query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      type: TransactionTypeEnum.optional(),
      category: z.string().optional(),
      search: z.string().optional(),
      dateFrom: z.coerce.date().optional(),
      dateTo: z.coerce.date().optional(),
      sort: z
        .string()
        .regex(/^(occurredAt|createdAt|amount):(asc|desc)$/)
        .default("occurredAt:desc"),
      mine: z
        .enum(["true", "false"]) // filtrar solo las propias
        .optional(),
    });

    const parsed = Query.parse({
      page: url.searchParams.get("page") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      type: url.searchParams.get("type") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      dateFrom: url.searchParams.get("dateFrom") ?? undefined,
      dateTo: url.searchParams.get("dateTo") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      mine: url.searchParams.get("mine") ?? undefined,
    });

    const where: Record<string, unknown> = { AND: [] };
    const and = where.AND as Array<Record<string, unknown>>;

    if (parsed.type) and.push({ type: parsed.type });
    if (parsed.category)
      and.push({
        category: { contains: parsed.category, mode: "insensitive" },
      });
    if (parsed.search && parsed.search.trim().length > 0) {
      and.push({
        OR: [
          { description: { contains: parsed.search, mode: "insensitive" } },
          { category: { contains: parsed.search, mode: "insensitive" } },
        ],
      });
    }
    if (parsed.dateFrom) and.push({ occurredAt: { gte: parsed.dateFrom } });
    if (parsed.dateTo) and.push({ occurredAt: { lte: parsed.dateTo } });

    // Si mine=true, sólo las creadas por el usuario; admin puede ver todas por defecto
    if (parsed.mine === "true") and.push({ userId: user.id });

    const [field, dir] = parsed.sort.split(":") as [string, "asc" | "desc"];
    const orderBy = { [field]: dir } as Record<string, "asc" | "desc">;

    const [total, rawItems] = await Promise.all([
      prisma.transaction.count({ where: and.length ? (where as never) : {} }),
      prisma.transaction.findMany({
        where: and.length ? (where as never) : {},
        orderBy,
        skip: (parsed.page - 1) * parsed.limit,
        take: parsed.limit,
        include: {
          TransactionImage: {
            orderBy: { order: "asc" },
          },
        },
      }),
    ]);

    // Mapear TransactionImage -> images para compatibilidad con frontend
    const items = rawItems.map((item) => ({
      ...item,
      images: item.TransactionImage,
      TransactionImage: undefined,
    }));

    // Calcular totales de ingresos y egresos
    const incomeTotal = items
      .filter((t) => t.type === "INCOME")
      .reduce((sum, t) => sum + t.amount, 0);
    const expenseTotal = items
      .filter((t) => t.type === "EXPENSE")
      .reduce((sum, t) => sum + t.amount, 0);
    const balance = incomeTotal - expenseTotal;

    return new Response(
      JSON.stringify({
        items,
        total,
        page: parsed.page,
        limit: parsed.limit,
        incomeTotal,
        expenseTotal,
        balance,
      }),
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
        req.headers.get("origin")
      )
    );
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["admin", "seller"]);
    const ct = req.headers.get("content-type") || "";

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const type = String(form.get("type"));
      const amount = Number(form.get("amount"));
      const description = (form.get("description") as string) || undefined;
      const category = (form.get("category") as string) || undefined;
      const occurredAtRaw = form.get("occurredAt");
      const occurredAt = occurredAtRaw ? new Date(String(occurredAtRaw)) : new Date();

      const dto = CreateSchema.parse({
        type,
        amount,
        description,
        category,
        occurredAt,
      });

      const created = await prisma.transaction.create({
        data: {
          userId: user.id,
          type: dto.type,
          amount: dto.amount,
          description: dto.description ?? null,
          category: dto.category ?? null,
          occurredAt: dto.occurredAt ?? new Date(),
        },
      });

      // Subir múltiples imágenes (campo "images")
      const files = form.getAll("images");
      const startOrder = Number(form.get("order") || 0);
      let order = Number.isFinite(startOrder) ? startOrder : 0;

      const uploaded: Array<{ imageUrl: string; imagePublicId: string; order: number }> = [];
      for (const f of files) {
        if (!(f instanceof File)) continue;
        const bytes = Buffer.from(await f.arrayBuffer());
        const dataUri = `data:${f.type};base64,${bytes.toString("base64")}`;
        const { secure_url, public_id } = await cloudinary.uploader.upload(
          dataUri,
          { folder: "hincha/transactions", resource_type: "image" }
        );
        uploaded.push({ imageUrl: secure_url, imagePublicId: public_id, order: order++ });
      }

      if (uploaded.length > 0) {
        await prisma.transactionImage.createMany({
          data: uploaded.map((img) => ({ transactionId: created.id, ...img })),
        });
      }

      return new Response(
        JSON.stringify({ ...created, imagesCount: uploaded.length }),
        withCORS(
          { status: 201, headers: { "Content-Type": "application/json" } },
          origin
        )
      );
    } else {
      // JSON path (opcionalmente admite images[] con imageUrl o imagePublicId)
      const body = await req.json();
      const dto = CreateSchema.parse(body);

      const created = await prisma.transaction.create({
        data: {
          userId: user.id,
          type: dto.type,
          amount: dto.amount,
          description: dto.description ?? null,
          category: dto.category ?? null,
          occurredAt: dto.occurredAt ?? new Date(),
        },
      });

      const ImagesSchema = z
        .array(
          z.object({
            imageUrl: z.string().url().optional(),
            imagePublicId: z.string().min(1).optional(),
            order: z.coerce.number().int().min(0).default(0),
          })
        )
        .optional();

      const images = ImagesSchema.parse(body.images);
      if (images && images.length > 0) {
        await prisma.transactionImage.createMany({
          data: images.map((img) => ({
            transactionId: created.id,
            imageUrl: img.imageUrl ?? (img.imagePublicId ? makeCldUrl(img.imagePublicId) : ""),
            imagePublicId: img.imagePublicId ?? null,
            order: img.order,
          })),
        });
      }

      return new Response(
        JSON.stringify(created),
        withCORS(
          { status: 201, headers: { "Content-Type": "application/json" } },
          origin
        )
      );
    }
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
