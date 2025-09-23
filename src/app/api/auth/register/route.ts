import { withCORS, preflight } from "@/lib/cors";
import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Mínimo 6 caracteres"),
  name: z.string().min(2).max(60).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, name } = schema.parse(body);

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return new Response(
        JSON.stringify({ error: "EMAIL_IN_USE" }),
        withCORS({ status: 409 })
      );
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hash, name: name || null },
      select: { id: true, email: true, name: true, createdAt: true },
    });

    return new Response(JSON.stringify(user), withCORS({ status: 201 }));
  } catch {
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST" }),
      withCORS({ status: 400 })
    );
  }
}
