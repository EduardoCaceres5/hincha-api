# Configuración de Instagram API

Esta guía te ayudará a configurar la integración con Instagram para publicar productos automáticamente.

## Requisitos previos

1. **Cuenta de Instagram Business o Creator**
   - Tu cuenta de Instagram debe estar convertida a cuenta Business o Creator
   - Debe estar vinculada a una Página de Facebook

2. **Meta Business Account**
   - Crear una cuenta en [business.facebook.com](https://business.facebook.com)
   - Vincular tu página de Facebook

## Pasos de configuración

### 1. Crear una App en Meta for Developers

1. Ir a [developers.facebook.com](https://developers.facebook.com)
2. Click en **"Mis aplicaciones"** → **"Crear aplicación"**
3. Seleccionar tipo: **"Empresa"**
4. Completar información básica:
   - Nombre de la aplicación: "Hincha Store Instagram Bot" (o el que prefieras)
   - Email de contacto
5. Click en **"Crear aplicación"**

### 2. Configurar Instagram Graph API

1. En el panel de tu aplicación, ir a **"Agregar productos"**
2. Buscar **"Instagram Graph API"** y hacer click en **"Configurar"**
3. En la barra lateral, ir a **"Instagram Graph API"** → **"Herramientas"**

### 3. Obtener el Access Token

#### Opción A: Token temporal (desarrollo/pruebas - dura 1 hora)

1. Ir a **Graph API Explorer** en [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer)
2. Seleccionar tu aplicación
3. En "Permisos", agregar:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_read_engagement`
4. Click en **"Generate Access Token"**
5. Copiar el token (empieza con `EAAG...`)

#### Opción B: Token de larga duración (producción - dura 60 días)

Primero obtén un token de corta duración (Opción A), luego ejecuta:

```bash
curl -X GET "https://graph.facebook.com/v21.0/oauth/access_token?\
grant_type=fb_exchange_token&\
client_id=TU_APP_ID&\
client_secret=TU_APP_SECRET&\
fb_exchange_token=TU_TOKEN_CORTO"
```

**Importante**: Los tokens de 60 días deben renovarse periódicamente.

### 4. Obtener el Instagram Account ID

Ejecuta este comando (reemplaza `TU_ACCESS_TOKEN` con tu token):

```bash
curl -X GET "https://graph.facebook.com/v21.0/me/accounts?access_token=TU_ACCESS_TOKEN"
```

Esto devuelve tus páginas de Facebook. Busca el `id` de la página vinculada a tu Instagram.

Luego, obtén el Instagram Business Account ID:

```bash
curl -X GET "https://graph.facebook.com/v21.0/FACEBOOK_PAGE_ID?\
fields=instagram_business_account&\
access_token=TU_ACCESS_TOKEN"
```

Copia el valor de `instagram_business_account.id`

### 5. Configurar variables de entorno

En tu archivo `.env` (backend), agrega:

```env
INSTAGRAM_ACCESS_TOKEN="tu_access_token_aqui"
INSTAGRAM_ACCOUNT_ID="tu_instagram_business_account_id_aqui"
```

### 6. Configurar en Vercel (Producción)

1. Ir a tu proyecto en [vercel.com](https://vercel.com)
2. Settings → Environment Variables
3. Agregar las dos variables:
   - `INSTAGRAM_ACCESS_TOKEN`
   - `INSTAGRAM_ACCOUNT_ID`
4. Guardar y redesplegar

## Verificación

Para verificar que está funcionando:

1. Crear un producto desde el admin panel
2. Revisar los logs del servidor:
   - Si está configurado: `✅ Producto "..." publicado en Instagram: [POST_ID]`
   - Si no está configurado: `⚠️  Instagram no configurado...`
3. Verificar tu cuenta de Instagram

## Limitaciones y consideraciones

### Limitaciones de la API

- **Máximo 10 imágenes** por carrusel
- Las **imágenes deben ser públicas** (URLs accesibles desde internet)
- **Límites de publicación**: 25 posts por día por cuenta
- **Formato de imágenes**: JPG, PNG (no GIF animado)
- **Tamaño recomendado**: 1080x1080px (cuadrado) o 1080x1350px (vertical)

### Requisitos de las imágenes

- Las URLs deben ser **HTTPS** y públicamente accesibles
- Instagram descarga las imágenes desde las URLs de Cloudinary
- Si las imágenes no son accesibles, la publicación fallará

### Manejo de errores

- Si Instagram falla, **el producto se crea igualmente** en tu base de datos
- Los errores se logean en la consola del servidor
- No afecta la experiencia del usuario

### Renovación de tokens

Los tokens de larga duración expiran cada 60 días. Para renovarlos:

```bash
curl -X GET "https://graph.facebook.com/v21.0/oauth/access_token?\
grant_type=fb_exchange_token&\
client_id=TU_APP_ID&\
client_secret=TU_APP_SECRET&\
fb_exchange_token=TU_TOKEN_ACTUAL"
```

**Recomendación**: Configurar un recordatorio mensual para renovar el token.

## Solución de problemas

### Error: "Image URL must be publicly accessible"

- Verifica que las URLs de Cloudinary sean públicas
- Asegúrate de que las URLs usen HTTPS
- Prueba abrir la URL en un navegador incógnito

### Error: "Invalid Instagram Account ID"

- Verifica que el ID sea del tipo Instagram Business Account
- Asegúrate de que la cuenta esté vinculada a una página de Facebook

### Error: "Invalid access token"

- El token puede haber expirado
- Genera un nuevo token de larga duración
- Verifica que los permisos incluyan `instagram_content_publish`

### No se publica pero no hay errores

- Revisa los logs del servidor en Vercel
- Verifica que las variables de entorno estén configuradas en producción
- Confirma que el servicio de Instagram esté habilitado (no comentado en `.env`)

## Testing local

Para probar localmente sin publicar en Instagram:

1. Comenta las variables en `.env`:
   ```env
   # INSTAGRAM_ACCESS_TOKEN="..."
   # INSTAGRAM_ACCOUNT_ID="..."
   ```

2. Verás el warning en consola pero la app funcionará normalmente

## Recursos útiles

- [Instagram Graph API Documentation](https://developers.facebook.com/docs/instagram-api)
- [Instagram Content Publishing](https://developers.facebook.com/docs/instagram-api/guides/content-publishing)
- [Graph API Explorer](https://developers.facebook.com/tools/explorer)
- [Meta Business Suite](https://business.facebook.com)

## Soporte

Si tienes problemas:
1. Revisa los logs del servidor
2. Verifica que todos los pasos estén completos
3. Consulta la documentación oficial de Meta
