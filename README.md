# Conecta Comuna - API

API REST del directorio de emprendimientos locales de la comuna.

## Requisitos

- Node.js 18 o superior

## Instalacion

```bash
npm install
```

## Configuracion

Copia `.env.example` a `.env` y completa las variables:

```bash
copy .env.example .env
```

Las variables estan descritas dentro del propio archivo `.env.example`.

El esquema de la base de datos esta en `schema.sql` y se aplica desde la
consola SQL de Supabase.

## Ejecutar

```bash
npm run dev
```

El servidor responde en `http://localhost:4000`.

## Despliegue

El servicio corre en Render con el blueprint `render.yaml`. Al conectar el
repositorio, Render pide los valores de `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` y `FRONTEND_URL`. La ultima es la
URL del frontend en Vercel y sirve para la lista de origenes permitidos por
CORS; se pueden separar varias con comas.

