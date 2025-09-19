import { withCORS, preflight } from "@/lib/cors";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

export async function OPTIONS(req: NextRequest) {
  return preflight(req.headers.get("origin"));
}

export async function GET(req: NextRequest) {
  try {
    const { sub } = await requireAuth(req);
    const user = await prisma.user.findUnique({
      where: { id: String(sub) },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
    if (!user) {
      return new Response(
        JSON.stringify({ error: "NOT_FOUND" }),
        withCORS({ status: 404 }, req.headers.get("origin"))
      );
    }
    return new Response(
      JSON.stringify(user),
      withCORS({ status: 200 }, req.headers.get("origin"))
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "UNAUTHORIZED" }),
      withCORS({ status: 401 }, req.headers.get("origin"))
    );
  }
}
