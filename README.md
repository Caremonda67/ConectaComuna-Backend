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
