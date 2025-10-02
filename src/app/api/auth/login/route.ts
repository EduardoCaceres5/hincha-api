import { withCORS, preflight } from "@/lib/cors";
import { prisma } from "@/lib/db";
import { signJWT } from "@/lib/jwt";
import { NextRequest } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const body = await req.json();
    const { email, password } = schema.parse(body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return new Response(
        JSON.stringify({ error: "INVALID_CREDENTIALS" }),
        withCORS({ status: 401 })
      );
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return new Response(
        JSON.stringify({ error: "INVALID_CREDENTIALS" }),
        withCORS({ status: 401 }, origin)
      );
    }

    const accessToken = await signJWT({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });
    return new Response(
      JSON.stringify({ accessToken }),
      withCORS({ status: 200 }, origin)
    );
  } catch {
    return new Response(
      JSON.stringify({ error: "BAD_REQUEST" }),
      withCORS({ status: 400 }, origin)
    );
  }
}
