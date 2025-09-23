import { withCORS, preflight } from "@/lib/cors";
import { NextRequest } from "next/server";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}
export async function GET() {
  return new Response(JSON.stringify({ ok: true }), withCORS({ status: 200 }));
}
