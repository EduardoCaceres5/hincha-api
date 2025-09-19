import { withCORS, preflight } from "@/lib/cors";

export async function OPTIONS() {
  return preflight(req.headers.get("origin"));
}
export async function GET() {
  return new Response(JSON.stringify({ ok: true }), withCORS({ status: 200 }));
}
