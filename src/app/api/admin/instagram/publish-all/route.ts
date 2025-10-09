import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { withCORS, preflight } from "@/lib/cors";
import { requireAuth } from "@/lib/auth";
import { instagramService } from "@/lib/instagram";

export const runtime = "nodejs";

// Preflight CORS
export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

/**
 * POST /api/admin/instagram/publish-all
 * Publica todos los productos existentes en Instagram
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");

  try {
    // Requiere autenticación (idealmente verificar que sea admin)
    await requireAuth(req);

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

    // Obtener todos los productos con sus imágenes
    const products = await prisma.product.findMany({
      select: {
        id: true,
        title: true,
        description: true,
        basePrice: true,
        imageUrl: true,
        imagePublicId: true,
        seasonLabel: true,
        kit: true,
        quality: true,
        league: true,
        ProductImage: {
          select: {
            imageUrl: true,
          },
          orderBy: { order: "asc" },
        },
      },
    });

    const results: Array<{
      productId: number;
      title: string;
      status: "success" | "error";
      instagramPostId?: string;
      error?: string;
    }> = [];

    // Publicar cada producto
    for (const product of products) {
      try {
        // Construir array de URLs de imágenes
        const imageUrls =
          product.ProductImage.length > 0
            ? product.ProductImage.map((img) => img.imageUrl)
            : product.imageUrl
            ? [product.imageUrl]
            : [];

        if (imageUrls.length === 0) {
          results.push({
            productId: product.id,
            title: product.title,
            status: "error",
            error: "No hay imágenes disponibles",
          });
          continue;
        }

        console.log(`📤 Publicando producto: ${product.title}`);

        const postId = await instagramService.publishAuto({
          title: product.title,
          description: product.description ?? undefined,
          imageUrls,
          basePrice: product.basePrice,
          league: product.league ?? undefined,
          kit: product.kit ?? undefined,
          quality: product.quality ?? undefined,
          seasonLabel: product.seasonLabel ?? undefined,
        });

        results.push({
          productId: product.id,
          title: product.title,
          status: "success",
          instagramPostId: postId,
        });

        console.log(`✅ ${product.title} → Instagram Post ID: ${postId}`);

        // Esperar un poco entre publicaciones para no sobrecargar la API
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        results.push({
          productId: product.id,
          title: product.title,
          status: "error",
          error: errorMessage,
        });

        console.error(`❌ Error publicando ${product.title}:`, errorMessage);
      }
    }

    const summary = {
      total: results.length,
      success: results.filter((r) => r.status === "success").length,
      errors: results.filter((r) => r.status === "error").length,
    };

    return new Response(
      JSON.stringify({
        message: "Publicación en lote completada",
        summary,
        results,
      }),
      withCORS(
        { status: 200, headers: { "Content-Type": "application/json" } },
        origin
      )
    );
  } catch (err: unknown) {
    console.error("Error en POST /api/admin/instagram/publish-all:", err);
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
