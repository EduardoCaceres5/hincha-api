import { NextRequest } from "next/server";
import { withCORS, preflight } from "@/lib/cors";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { z } from "zod";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

const TransactionTypeEnum = z.enum(["INCOME", "EXPENSE"]);

const UpdateSchema = z.object({
  type: TransactionTypeEnum.optional(),
  amount: z.coerce.number().int().min(0).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.string().trim().max(80).optional().nullable(),
  occurredAt: z.coerce.date().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireRole(_req, ["admin", "seller"]);
    const { id } = await params;
    const item = await prisma.transaction.findUnique({
      where: { id },
    });
    if (!item) {
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 })
      );
    }
    return new Response(JSON.stringify(item), withCORS({ status: 200 }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 })
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["admin", "seller"]);
    const body = await req.json();
    const dto = UpdateSchema.parse(body);

    // Permitir que seller sólo modifique sus propias transacciones
    const { id } = await params;
    const existing = await prisma.transaction.findUnique({
      where: { id },
    });
    if (!existing)
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, origin)
      );
    if (user.role === "seller" && existing.userId !== user.id) {
      return new Response(
        JSON.stringify({ error: "FORBIDDEN" }),
        withCORS({ status: 403 }, origin)
      );
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data: {
        type: dto.type ?? undefined,
        amount: dto.amount ?? undefined,
        description: dto.description ?? undefined,
        category: dto.category ?? undefined,
        occurredAt: dto.occurredAt ?? undefined,
      },
    });
    return new Response(
      JSON.stringify(updated),
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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  try {
    const user = await requireRole(req, ["admin", "seller"]);
    const { id } = await params;
    const existing = await prisma.transaction.findUnique({
      where: { id },
    });
    if (!existing)
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, origin)
      );
    if (user.role === "seller" && existing.userId !== user.id) {
      return new Response(
        JSON.stringify({ error: "FORBIDDEN" }),
        withCORS({ status: 403 }, origin)
      );
    }
    await prisma.transaction.delete({ where: { id } });
    return new Response(null, withCORS({ status: 204 }, origin));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST", message }),
      withCORS({ status: 400 }, origin)
    );
  }
}
