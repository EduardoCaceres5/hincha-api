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
        `https://graph.facebook.com/v21.0/${instagramAccountId}/media`,
        {
          image_url: imageUrl,
          caption: caption,
          access_token: accessToken,
        }
      );

      const creationId = containerResponse.data.id;

      // Paso 2: Publicar el container
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${instagramAccountId}/media_publish`,
        {
          creation_id: creationId,
          access_token: accessToken,
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
            `https://graph.facebook.com/v21.0/${instagramAccountId}/media`,
            {
              image_url: imageUrl,
              is_carousel_item: true,
              access_token: accessToken,
            }
          );
          return response.data.id;
        })
      );

      // Paso 2: Crear container del carrusel
      const carouselResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${instagramAccountId}/media`,
        {
          media_type: "CAROUSEL",
          children: mediaIds,
          caption: caption,
          access_token: accessToken,
        }
      );

      const creationId = carouselResponse.data.id;

      // Paso 3: Publicar
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v21.0/${instagramAccountId}/media_publish`,
        {
          creation_id: creationId,
          access_token: accessToken,
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
   * Publica automáticamente (carrusel si hay múltiples imágenes, post simple si es solo una)
   */
  async publishAuto(product: ProductData): Promise<string> {
    if (product.imageUrls.length > 1) {
      return this.publishCarousel(product);
    } else {
      return this.publishPost(product);
    }
  }

  private buildCaption(product: ProductData): string {
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
