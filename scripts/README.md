# Scripts de Instagram

## 1. Sincronizar IDs de Instagram con productos existentes

Si ya publicaste productos en Instagram ANTES de tener el campo `instagramPostId`, usa este script para asociar automáticamente los posts existentes con tus productos.

### ¿Cómo funciona?

- Obtiene los últimos 100 posts de tu cuenta de Instagram
- Busca cada producto en la base de datos que no tenga `instagramPostId`
- Intenta hacer match entre el título del producto y el caption del post
- Actualiza automáticamente el campo `instagramPostId` cuando encuentra coincidencias

### Uso

```bash
pnpm run instagram:sync-ids
```

### Output esperado

```
🔄 Iniciando sincronización de IDs de Instagram...

📥 Obteniendo posts de Instagram...
✅ 36 posts encontrados en Instagram

📦 36 productos sin ID de Instagram

✅ "CAMISETA PORTUGAL 2025 CR7" → Instagram Post ID: 18093122032796762
✅ "CAMISETA ARGENTINA 2025 MESSI" → Instagram Post ID: 18102794287616006
...

============================================================
📊 RESUMEN DE SINCRONIZACIÓN
============================================================
Total procesados: 36
✅ Asociados: 35
⚠️  No encontrados: 1
============================================================
```

### Notas importantes

- Solo procesa productos que NO tienen `instagramPostId`
- La asociación se hace por coincidencia de texto en el caption
- Si un producto no se asocia automáticamente, puedes:
  - Actualizarlo manualmente en la base de datos
  - Volver a publicarlo para crear un nuevo post
- El script obtiene máximo los últimos 100 posts de Instagram

---

## 2. Publicar productos faltantes en Instagram

Este script identifica y publica **solo los productos que NO están en Instagram** (sin `instagramPostId`).

### ¿Cuándo usar este script?

- Tienes productos nuevos que aún no se han publicado
- Algunos productos fallaron en publicaciones anteriores
- Quieres verificar y publicar solo lo que falta

### Ventajas sobre publish-all

- ✅ **Más eficiente**: Solo procesa productos sin publicar
- ✅ **Sin duplicados**: No intenta republicar productos existentes
- ✅ **Verificación clara**: Te dice exactamente cuántos productos faltan

### Uso

```bash
pnpm run instagram:publish-missing
```

### Output esperado

```
🔍 Buscando productos faltantes en Instagram...

📦 Productos sin publicar encontrados: 5

🚀 Iniciando publicación...

[1/5] Procesando: Camiseta Barcelona 2025
✅ Publicado con éxito → Post ID: 17969335175963394
💾 ID guardado en base de datos

⏳ Esperando 3 segundos antes de continuar...

[2/5] Procesando: Camiseta Bayern Munich 2025
✅ Publicado con éxito → Post ID: 17969335175963395
💾 ID guardado en base de datos

...

============================================================
📊 RESUMEN DE PUBLICACIÓN
============================================================
Total procesados: 5
✅ Exitosos: 5
❌ Errores: 0
⚠️  Saltados: 0
============================================================

✅ PRODUCTOS PUBLICADOS:
  - Camiseta Barcelona 2025 → 17969335175963394
  - Camiseta Bayern Munich 2025 → 17969335175963395
  - Camiseta PSG 2025 → 17969335175963396
  - Camiseta Juventus 2025 → 17969335175963397
  - Camiseta Milan 2025 → 17969335175963398

✨ Proceso completado
```

Si todos los productos ya están publicados:

```
🔍 Buscando productos faltantes en Instagram...

✅ ¡Todos los productos ya están publicados en Instagram!
   No hay nada que hacer.
```

---

## 3. Publicar todos los productos existentes

Este script te permite publicar todos los productos que ya tienes en la base de datos a Instagram.

### Requisitos

1. Variables de entorno configuradas en `.env`:
   ```env
   INSTAGRAM_ACCESS_TOKEN=tu_token_aqui
   INSTAGRAM_ACCOUNT_ID=tu_account_id_aqui
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

### Uso

#### Opción 1: Usando npm script (recomendado)

```bash
npm run instagram:publish-all
```

#### Opción 2: Usando tsx directamente

```bash
npx tsx scripts/publish-all-to-instagram.ts
```

#### Opción 3: Usando el endpoint API

Hacer una petición POST autenticada a:
```
POST /api/admin/instagram/publish-all
Authorization: Bearer <tu_token_jwt>
```

### Comportamiento

- Procesa todos los productos de la base de datos
- Publica automáticamente:
  - **Post simple** si el producto tiene 1 imagen
  - **Carrusel** si el producto tiene múltiples imágenes
- Espera 3 segundos entre cada publicación exitosa
- Espera 5 segundos después de un error
- Salta productos sin imágenes
- Muestra un resumen al final con estadísticas

### Output esperado

```
🚀 Iniciando publicación masiva en Instagram...

📦 Total de productos encontrados: 15

[1/15] Procesando: Camiseta Manchester United 2024/25
✅ Publicado con éxito → Post ID: 17969335175963394

⏳ Esperando 3 segundos antes de continuar...

[2/15] Procesando: Camiseta Real Madrid Retro 2010
✅ Publicado con éxito → Post ID: 17969335175963395

...

============================================================
📊 RESUMEN DE PUBLICACIÓN
============================================================
Total procesados: 15
✅ Exitosos: 14
❌ Errores: 0
⚠️  Saltados: 1
============================================================

✨ Proceso completado
```

### Consideraciones

- **Rate limits**: Instagram tiene límites de publicación. Si publicas muchos productos, es recomendable hacerlo en lotes
- **Tiempo de procesamiento**: Los videos (Reels) pueden tardar varios minutos en procesarse
- **Imágenes requeridas**: Productos sin imágenes serán saltados automáticamente
- **Errores**: Los errores en un producto no detienen el proceso, continúa con el siguiente

### Troubleshooting

#### Error: "INSTAGRAM_NOT_CONFIGURED"
Asegúrate de tener las variables de entorno correctamente configuradas en `.env`

#### Error: "Media ID is not available"
El script ya incluye lógica de espera automática. Si persiste, puede que las imágenes no sean accesibles públicamente.

#### Error de autenticación
Verifica que tu `INSTAGRAM_ACCESS_TOKEN` no haya expirado. Los tokens de Instagram tienen una duración limitada.
