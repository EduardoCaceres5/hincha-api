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
 * POST /api/admin/instagram/publish-missing
 * Publica SOLO los productos que NO están en Instagram (sin instagramPostId)
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

    // Obtener SOLO productos sin instagramPostId
    const products = await prisma.product.findMany({
      where: {
        instagramPostId: null,
      },
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

    // Si no hay productos sin publicar, retornar inmediatamente
    if (products.length === 0) {
      return new Response(
        JSON.stringify({
          message: "Todos los productos ya están publicados en Instagram",
          summary: {
            total: 0,
            success: 0,
            errors: 0,
            skipped: 0,
          },
          results: [],
        }),
        withCORS(
          { status: 200, headers: { "Content-Type": "application/json" } },
          origin
        )
      );
    }

    console.log(`📦 Productos sin publicar encontrados: ${products.length}`);

    const results: Array<{
      productId: string;
      title: string;
      status: "success" | "error" | "skipped";
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
          console.log(`⚠️  ${product.title} - Sin imágenes, saltando...`);
          results.push({
            productId: product.id,
            title: product.title,
            status: "skipped",
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

        // Guardar el ID del post en la base de datos
        await prisma.product.update({
          where: { id: product.id },
          data: { instagramPostId: postId },
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
      skipped: results.filter((r) => r.status === "skipped").length,
    };

    return new Response(
      JSON.stringify({
        message: "Publicación de productos faltantes completada",
        summary,
        results,
      }),
      withCORS(
        { status: 200, headers: { "Content-Type": "application/json" } },
        origin
      )
    );
  } catch (err: unknown) {
    console.error("Error en POST /api/admin/instagram/publish-missing:", err);
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
