import axios from "axios";

interface InstagramConfig {
  accessToken: string;
  instagramAccountId: string;
}

interface ProductData {
  title: string;
  description?: string;
  imageUrls: string[];
  basePrice: number;
  league?: string;
  kit?: string;
  quality?: string;
  seasonLabel?: string;
}

export class InstagramService {
  private config: InstagramConfig;

  constructor(config: InstagramConfig) {
    this.config = config;
  }

  /**
   * Verifica el estado de un container de media y espera hasta que esté listo
   */
  private async waitForMediaReady(
    containerId: string,
    maxAttempts: number = 30,
    intervalMs: number = 2000
  ): Promise<void> {
    const { accessToken } = this.config;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await axios.get(
          `https://graph.instagram.com/v24.0/${containerId}`,
          {
            params: {
              fields: "status_code",
            },
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        const statusCode = response.data.status_code;

        // Status codes:
        // - EXPIRED: El container expiró
        // - ERROR: Hubo un error procesando el media
        // - FINISHED: El media está listo para publicar
        // - IN_PROGRESS: El media todavía se está procesando
        // - PUBLISHED: El media ya fue publicado

        if (statusCode === "FINISHED") {
          return; // Está listo para publicar
        }

        if (statusCode === "ERROR" || statusCode === "EXPIRED") {
          throw new Error(
            `Media container status: ${statusCode}. No se puede publicar.`
          );
        }

        // Si está en progreso, esperar antes de intentar de nuevo
        if (statusCode === "IN_PROGRESS") {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          continue;
        }
      } catch (error: unknown) {
        if (axios.isAxiosError(error)) {
          console.error(
            `Error verificando estado del media (intento ${attempt + 1}/${maxAttempts}):`,
            error.response?.data || error.message
          );
        }
        throw error;
      }
    }

    throw new Error(
      `Timeout: El media no estuvo listo después de ${maxAttempts} intentos`
    );
  }

  /**
   * Publica una imagen en Instagram con caption
   */
  async publishPost(product: ProductData): Promise<string> {
    const { accessToken, instagramAccountId } = this.config;

    // Usar solo la primera imagen
    const imageUrl = product.imageUrls[0];

    // Crear el caption
    const caption = this.buildCaption(product);

    try {
      // Paso 1: Crear container
      const containerResponse = await axios.post(
        `https://graph.instagram.com/v24.0/${instagramAccountId}/media`,
        {
          image_url: imageUrl,
          caption: caption,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const creationId = containerResponse.data.id;

      // Esperar a que el media esté listo
      await this.waitForMediaReady(creationId);

      // Paso 2: Publicar el container
      const publishResponse = await axios.post(
        `https://graph.instagram.com/v24.0/${instagramAccountId}/media_publish`,
        {
          creation_id: creationId,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return publishResponse.data.id; // ID del post publicado
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        console.error(
          "Error publicando en Instagram:",
          error.response?.data || error.message
        );
        throw new Error(
          `Instagram API Error: ${error.response?.data?.error?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Publica un carrusel (múltiples imágenes)
   */
  async publishCarousel(product: ProductData): Promise<string> {
    const { accessToken, instagramAccountId } = this.config;
    const caption = this.buildCaption(product);

    try {
      // Paso 1: Crear containers para cada imagen (max 10)
      const mediaIds = await Promise.all(
        product.imageUrls.slice(0, 10).map(async (imageUrl) => {
          const response = await axios.post(
            `https://graph.instagram.com/v24.0/${instagramAccountId}/media`,
            {
              image_url: imageUrl,
              is_carousel_item: true,
            },
            {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
            }
          );
          return response.data.id;
        })
      );

      // Paso 2: Crear container del carrusel
      const carouselResponse = await axios.post(
        `https://graph.instagram.com/v24.0/${instagramAccountId}/media`,
        {
          media_type: "CAROUSEL",
          children: mediaIds,
          caption: caption,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const creationId = carouselResponse.data.id;

      // Esperar a que el carrusel esté listo
      await this.waitForMediaReady(creationId);

      // Paso 3: Publicar
      const publishResponse = await axios.post(
        `https://graph.instagram.com/v24.0/${instagramAccountId}/media_publish`,
        {
          creation_id: creationId,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return publishResponse.data.id;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        console.error(
          "Error publicando carrusel en Instagram:",
          error.response?.data || error.message
        );
        throw new Error(
          `Instagram API Error: ${error.response?.data?.error?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Publica un Reel en Instagram
   */
  async publishReel(videoUrl: string, caption?: string): Promise<string> {
    const { accessToken, instagramAccountId } = this.config;

    try {
      // Paso 1: Crear el container del Reel
      const containerResponse = await axios.post(
        `https://graph.instagram.com/v24.0/${instagramAccountId}/media`,
        {
          video_url: videoUrl,
          media_type: "REELS",
          caption: caption,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const creationId = containerResponse.data.id;

      // Esperar a que el video esté listo (los videos pueden tardar más)
      await this.waitForMediaReady(creationId, 60, 3000); // 60 intentos cada 3 segundos = max 3 minutos

      // Paso 2: Publicar el Reel
      const publishResponse = await axios.post(
        `https://graph.instagram.com/v24.0/${instagramAccountId}/media_publish`,
        {
          creation_id: creationId,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return publishResponse.data.id; // ID del Reel publicado
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        console.error(
          "Error publicando Reel en Instagram:",
          error.response?.data || error.message
        );
        throw new Error(
          `Instagram API Error: ${error.response?.data?.error?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Publica automáticamente (carrusel si hay múltiples imágenes, post simple si es solo una)
   */
  async publishAuto(product: ProductData): Promise<string> {
    if (product.imageUrls.length > 1) {
      return this.publishCarousel(product);
    } else {
      return this.publishPost(product);
    }
  }

  /**
   * Elimina un post de Instagram
   */
  async deletePost(postId: string): Promise<void> {
    const { accessToken } = this.config;

    try {
      await axios.delete(
        `https://graph.instagram.com/v24.0/${postId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      console.log(`🗑️  Post ${postId} eliminado de Instagram`);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        console.error(
          "Error eliminando post de Instagram:",
          error.response?.data || error.message
        );
        throw new Error(
          `Instagram API Error: ${error.response?.data?.error?.message || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Actualiza el caption de un post existente
   *
   * IMPORTANTE: La Instagram Graph API NO permite actualizar el caption de posts ya publicados.
   * Solo permite actualizar comment_enabled y hide_like_and_view_counts.
   *
   * Este método está disponible pero puede fallar. La única forma real de actualizar
   * el contenido de un post es eliminarlo y volver a publicarlo.
   *
   * @deprecated La API de Instagram no soporta actualización de captions
   */
  async updateCaption(postId: string, caption: string): Promise<void> {
    const { accessToken } = this.config;

    console.warn(
      `⚠️  ADVERTENCIA: Instagram API no permite actualizar captions de posts publicados. Post ID: ${postId}`
    );

    try {
      // Intentar actualizar (probablemente falle)
      await axios.post(
        `https://graph.instagram.com/v24.0/${postId}`,
        {
          caption: caption,
          comment_enabled: true, // Requerido por la API
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      console.log(`✏️  Caption actualizado para post ${postId}`);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        console.error(
          "Error actualizando caption en Instagram:",
          error.response?.data || error.message
        );
        // No lanzar error, solo loggear
        console.log(
          `ℹ️  Nota: Instagram no permite actualizar captions. Considera eliminar y republicar el post.`
        );
      }
    }
  }

  /**
   * Elimina un post y lo vuelve a publicar con nueva información
   * Esta es la única forma de "actualizar" un post en Instagram
   */
  async republishPost(
    postId: string,
    product: ProductData
  ): Promise<string> {
    console.log(`🔄 Republicando post ${postId}...`);

    // Primero eliminar el post existente
    await this.deletePost(postId);

    // Esperar un momento antes de republicar
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Publicar nuevamente
    const newPostId = await this.publishAuto(product);

    console.log(`✅ Post republicado. Nuevo ID: ${newPostId}`);
    return newPostId;
  }

  public buildCaption(product: ProductData): string {
    let caption = `✨ ${product.title}\n\n`;

    if (product.description) {
      caption += `${product.description}\n\n`;
    }

    // Agregar metadatos si están disponibles
    if (product.quality) {
      const qualityText =
        product.quality === "PLAYER_VERSION" ? "Versión Jugador" : "Fan";
      caption += `🏆 ${qualityText}\n`;
    }

    if (product.kit) {
      const kitText = this.getKitText(product.kit);
      caption += `👕 ${kitText}\n`;
    }

    if (product.seasonLabel) {
      caption += `📅 ${product.seasonLabel}\n`;
    }

    if (product.league) {
      caption += `⚽ ${this.getLeagueText(product.league)}\n`;
    }

    caption += `\n💰 Precio: Gs ${product.basePrice.toLocaleString("es-PY")}\n\n`;
    caption += `🛒 ¡Compralo en nuestro sitio web!\n\n`;
    caption += `#hincha #camisetas #futbol #paraguay`;

    return caption;
  }

  private getKitText(kit: string): string {
    const kitMap: Record<string, string> = {
      HOME: "Titular",
      AWAY: "Alternativa",
      THIRD: "Tercera",
      RETRO: "Retro",
    };
    return kitMap[kit] || kit;
  }

  private getLeagueText(league: string): string {
    const leagueMap: Record<string, string> = {
      PREMIER_LEAGUE: "Premier League",
      LA_LIGA: "La Liga",
      LIGUE_1: "Ligue 1",
      SERIE_A: "Serie A",
      BUNDESLIGA: "Bundesliga",
      LIGA_PROFESIONAL: "Liga Profesional",
      LIGA_SAUDI: "Liga Saudí",
      INTERNACIONAL: "Internacional",
    };
    return leagueMap[league] || league;
  }
}

// Exportar instancia configurada (solo si las variables de entorno están disponibles)
export function createInstagramService(): InstagramService | null {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const instagramAccountId = process.env.INSTAGRAM_ACCOUNT_ID;

  if (!accessToken || !instagramAccountId) {
    console.warn(
      "⚠️  Instagram no configurado. Define INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_ACCOUNT_ID para habilitar publicación automática."
    );
    return null;
  }

  return new InstagramService({
    accessToken,
    instagramAccountId,
  });
}

export const instagramService = createInstagramService();
