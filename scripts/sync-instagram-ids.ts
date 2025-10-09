#!/usr/bin/env tsx
/**
 * Script para sincronizar los IDs de Instagram con los productos existentes
 *
 * Este script obtiene los posts recientes de Instagram y los asocia con los productos
 * en la base de datos basándose en el título del producto en el caption.
 *
 * Uso: tsx scripts/sync-instagram-ids.ts
 *
 * Requiere:
 * - INSTAGRAM_ACCESS_TOKEN
 * - INSTAGRAM_ACCOUNT_ID
 */

import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();

interface InstagramPost {
  id: string;
  caption?: string;
  media_type: string;
  timestamp: string;
}

async function main() {
  console.log("🔄 Iniciando sincronización de IDs de Instagram...\n");

  // Verificar configuración
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const instagramAccountId = process.env.INSTAGRAM_ACCOUNT_ID;

  if (!accessToken || !instagramAccountId) {
    console.error(
      "❌ Error: Define INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_ACCOUNT_ID en .env"
    );
    process.exit(1);
  }

  try {
    // Obtener posts recientes de Instagram (últimos 100)
    console.log("📥 Obteniendo posts de Instagram...");
    const response = await axios.get(
      `https://graph.instagram.com/v24.0/${instagramAccountId}/media`,
      {
        params: {
          fields: "id,caption,media_type,timestamp",
          limit: 100, // Máximo permitido
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const posts: InstagramPost[] = response.data.data;
    console.log(`✅ ${posts.length} posts encontrados en Instagram\n`);

    // Obtener productos sin instagramPostId
    const productsWithoutId = await prisma.product.findMany({
      where: {
        instagramPostId: null,
      },
      select: {
        id: true,
        title: true,
        instagramPostId: true,
      },
    });

    console.log(
      `📦 ${productsWithoutId.length} productos sin ID de Instagram\n`
    );

    if (productsWithoutId.length === 0) {
      console.log("✨ Todos los productos ya tienen ID de Instagram asociado");
      return;
    }

    const results: Array<{
      productId: string;
      productTitle: string;
      status: "matched" | "not_found";
      instagramPostId?: string;
    }> = [];

    // Intentar asociar cada producto con un post
    for (const product of productsWithoutId) {
      // Buscar post que contenga el título del producto en el caption
      const matchingPost = posts.find((post) => {
        if (!post.caption) return false;

        // Normalizar para comparación (remover emojis comunes, espacios extras, etc)
        const normalizedCaption = post.caption
          .replace(/✨|🏆|👕|📅|⚽|💰|🛒|#/g, "")
          .toLowerCase()
          .trim();

        const normalizedTitle = product.title.toLowerCase().trim();

        return normalizedCaption.includes(normalizedTitle);
      });

      if (matchingPost) {
        // Actualizar producto con el ID de Instagram
        await prisma.product.update({
          where: { id: product.id },
          data: { instagramPostId: matchingPost.id },
        });

        console.log(
          `✅ "${product.title}" → Instagram Post ID: ${matchingPost.id}`
        );

        results.push({
          productId: product.id,
          productTitle: product.title,
          status: "matched",
          instagramPostId: matchingPost.id,
        });

        // Remover el post de la lista para evitar duplicados
        const index = posts.indexOf(matchingPost);
        if (index > -1) {
          posts.splice(index, 1);
        }
      } else {
        console.log(`⚠️  "${product.title}" → No se encontró post coincidente`);

        results.push({
          productId: product.id,
          productTitle: product.title,
          status: "not_found",
        });
      }
    }

    // Resumen
    console.log("\n" + "=".repeat(60));
    console.log("📊 RESUMEN DE SINCRONIZACIÓN");
    console.log("=".repeat(60));
    console.log(`Total procesados: ${results.length}`);
    console.log(
      `✅ Asociados: ${results.filter((r) => r.status === "matched").length}`
    );
    console.log(
      `⚠️  No encontrados: ${results.filter((r) => r.status === "not_found").length}`
    );
    console.log("=".repeat(60));

    // Mostrar productos no encontrados
    const notFound = results.filter((r) => r.status === "not_found");
    if (notFound.length > 0) {
      console.log("\n⚠️  PRODUCTOS SIN ASOCIAR:");
      console.log(
        "Estos productos no se pudieron asociar automáticamente."
      );
      console.log("Puedes asociarlos manualmente o volver a publicarlos.\n");
      notFound.forEach((r) => {
        console.log(`  - ${r.productTitle} (ID: ${r.productId})`);
      });
    }

    console.log("\n✨ Sincronización completada\n");
  } catch (error) {
    console.error("❌ Error durante la sincronización:", error);
    if (axios.isAxiosError(error)) {
      console.error("Detalles:", error.response?.data);
    }
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error("💥 Error fatal:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
