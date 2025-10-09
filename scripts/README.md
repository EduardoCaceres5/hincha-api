# Scripts de publicación en Instagram

## Publicar todos los productos existentes

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
