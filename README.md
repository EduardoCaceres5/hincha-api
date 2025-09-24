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

## Tabla de contenidos

- [Características](#-características)
- [Arquitectura](#-arquitectura)
- [Requisitos](#-requisitos)
- [Variables de entorno](#-variables-de-entorno)
- [Primera ejecución](#-primera-ejecución)
- [Scripts](#-scripts)
- [CORS](#-cors)
- [Base de datos (Prisma)](#-base-de-datos-prisma)
- [Rutas principales](#-rutas-principales)
- [Autenticación y Autorización](#-autenticación-y-autorización)
- [Imágenes (Cloudinary)](#-imágenes-cloudinary)
- [Personalización y Parches (opcional)](#-personalización-y-parches-opcional)
- [Despliegue en Vercel](#-despliegue-en-vercel)
- [Solución de problemas](#-solución-de-problemas)
- [Licencia](#-licencia)
- [Créditos](#-créditos)

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

## 🧱 Arquitectura

