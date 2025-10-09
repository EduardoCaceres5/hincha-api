#!/usr/bin/env tsx
/**
 * Script para publicar SOLO los productos que NO están en Instagram
 *
 * Uso: tsx scripts/publish-missing-to-instagram.ts
 *
 * Requiere:
 * - INSTAGRAM_ACCESS_TOKEN
 * - INSTAGRAM_ACCOUNT_ID
 *
 * Este script:
 * - Identifica productos sin instagramPostId
 * - Los publica en Instagram
 * - Actualiza el instagramPostId automáticamente
 */

import { PrismaClient } from "@prisma/client";
import { InstagramService } from "../src/lib/instagram";

const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Buscando productos faltantes en Instagram...\n");

  // Verificar configuración
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const instagramAccountId = process.env.INSTAGRAM_ACCOUNT_ID;

  if (!accessToken || !instagramAccountId) {
    console.error(
      "❌ Error: Define INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_ACCOUNT_ID en .env"
    );
    process.exit(1);
  }

  const instagramService = new InstagramService({
    accessToken,
    instagramAccountId,
  });

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

  if (products.length === 0) {
    console.log("✅ ¡Todos los productos ya están publicados en Instagram!");
    console.log("   No hay nada que hacer.\n");
    return;
  }

  console.log(`📦 Productos sin publicar encontrados: ${products.length}\n`);
  console.log("🚀 Iniciando publicación...\n");

  const results: Array<{
    productId: string;
    title: string;
    status: "success" | "error" | "skipped";
    instagramPostId?: string;
    error?: string;
  }> = [];

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    console.log(`[${i + 1}/${products.length}] Procesando: ${product.title}`);

    try {
      // Construir array de URLs de imágenes
      const imageUrls =
        product.ProductImage.length > 0
          ? product.ProductImage.map((img) => img.imageUrl)
          : product.imageUrl
          ? [product.imageUrl]
          : [];

      if (imageUrls.length === 0) {
        console.log(`⚠️  Sin imágenes, saltando...\n`);
        results.push({
          productId: product.id,
          title: product.title,
          status: "skipped",
          error: "No hay imágenes disponibles",
        });
        continue;
      }

      // Publicar en Instagram
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

      console.log(`✅ Publicado con éxito → Post ID: ${postId}`);

      // Guardar el ID del post en la base de datos
      await prisma.product.update({
        where: { id: product.id },
        data: { instagramPostId: postId },
      });

      console.log(`💾 ID guardado en base de datos\n`);

      results.push({
        productId: product.id,
        title: product.title,
        status: "success",
        instagramPostId: postId,
      });

      // Esperar 3 segundos entre publicaciones
      if (i < products.length - 1) {
        console.log("⏳ Esperando 3 segundos antes de continuar...\n");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Error: ${errorMessage}\n`);

      results.push({
        productId: product.id,
        title: product.title,
        status: "error",
        error: errorMessage,
      });

      // Esperar más tiempo si hay un error (puede ser rate limit)
      if (i < products.length - 1) {
        console.log("⏳ Esperando 5 segundos después del error...\n");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  // Resumen
  console.log("\n" + "=".repeat(60));
  console.log("📊 RESUMEN DE PUBLICACIÓN");
  console.log("=".repeat(60));
  console.log(`Total procesados: ${results.length}`);
  console.log(`✅ Exitosos: ${results.filter((r) => r.status === "success").length}`);
  console.log(`❌ Errores: ${results.filter((r) => r.status === "error").length}`);
  console.log(`⚠️  Saltados: ${results.filter((r) => r.status === "skipped").length}`);
  console.log("=".repeat(60));

  // Mostrar errores si los hay
  const errors = results.filter((r) => r.status === "error");
  if (errors.length > 0) {
    console.log("\n❌ ERRORES DETALLADOS:");
    errors.forEach((e) => {
      console.log(`  - ${e.title}: ${e.error}`);
    });
  }

  // Mostrar lista de productos publicados exitosamente
  const successes = results.filter((r) => r.status === "success");
  if (successes.length > 0) {
    console.log("\n✅ PRODUCTOS PUBLICADOS:");
    successes.forEach((s) => {
      console.log(`  - ${s.title} → ${s.instagramPostId}`);
    });
  }

  console.log("\n✨ Proceso completado\n");
}

main()
  .catch((error) => {
    console.error("💥 Error fatal:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
