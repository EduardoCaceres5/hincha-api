import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireRole } from "@/lib/authz";
import { z } from "zod";

export async function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

const schema = z.object({ status: z.enum(["pending", "paid", "canceled"]) });

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const origin = req.headers.get("origin");
  try {
    await requireRole(req, ["admin"]);
    const { status } = schema.parse(await req.json());
    const updated = await prisma.order.update({
      where: { id: params.id },
      data: { status },
    });
    return new Response(
      JSON.stringify(updated),
      withCORS({ status: 200 }, origin)
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST" }),
      withCORS({ status: 400 }, origin)
    );
  }
}
