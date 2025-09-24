# Hincha API — Backend

API para **Hincha Store**: catálogo, publicaciones, pedidos y administración.  
Construida con **Next.js (App Router)**, **Prisma** y **Zod**, desplegada en **Vercel**.

<p align="left">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-15+-000000?logo=next.js&logoColor=fff" />
  <img alt="Prisma"  src="https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=fff" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=fff" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Supabase-336791?logo=postgresql&logoColor=fff" />
</p>

---

## 🚀 Características

- **API REST** con Next.js (App Router) y manejadores `route.ts`.
- **ORM Prisma** con PostgreSQL (Supabase compatible).
- **Validación** robusta con **Zod** (queries y bodies).
- **Autenticación** JWT y **roles** (`user`, `seller`, `admin`).
- **CORS** configurable por entorno.
- **Uploads** y manejo de imágenes con Cloudinary (opcional).
- **Personalización de pedidos** (opcional): nombre/número y parches.
- Pensada para **Vercel** (build y runtime serverless).


---

## ✅ Requisitos

- **Node.js ≥ 18** (recomendado 20+).
- **pnpm** (o npm/yarn). El repo usa pnpm.
- **PostgreSQL** (recomendado Supabase).
