import { NextRequest } from "next/server";
import { withCORS, preflight } from "@/lib/cors";
import { instagramService } from "@/lib/instagram";

export const runtime = "nodejs";

// Preflight CORS
export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

/**
 * GET /api/instagram/permalink/[postId]
 * Obtiene el permalink (URL pública) de un post de Instagram y redirige
 * Endpoint público para facilitar el acceso desde el frontend
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const origin = req.headers.get("origin");

  try {
    if (!instagramService) {
      return new Response(
        JSON.stringify({
          error: "INSTAGRAM_NOT_CONFIGURED",
          message:
            "Instagram no está configurado. Define INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_ACCOUNT_ID",
        }),
        withCORS(
          { status: 503, headers: { "Content-Type": "application/json" } },
          origin
        )
      );
    }

    const { postId } = await params;

    if (!postId) {
      return new Response(
        JSON.stringify({
          error: "MISSING_POST_ID",
          message: "El postId es requerido",
        }),
        withCORS(
          { status: 400, headers: { "Content-Type": "application/json" } },
          origin
        )
      );
    }

    const permalink = await instagramService.getPostPermalink(postId);

    // Redirigir directamente al permalink de Instagram
    return Response.redirect(permalink, 302);
  } catch (err: unknown) {
    console.error("Error en GET /api/instagram/permalink/[postId]:", err);
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    return new Response(
      JSON.stringify({ error: "INTERNAL_SERVER_ERROR", message }),
      withCORS(
        { status: 500, headers: { "Content-Type": "application/json" } },
        origin
      )
    );
  }
}
