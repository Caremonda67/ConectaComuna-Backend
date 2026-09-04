-- Esquema de Conecta Comuna (PostgreSQL / Supabase).

-- Extensión para identificadores UUID
create extension if not exists "pgcrypto";

-- Tablas del catálogo
-- Comunas del municipio
create table if not exists comunas (
  id          serial primary key,
  nombre      text not null unique
);

-- Categorías de emprendimiento
create table if not exists categorias (
  id      serial primary key,
  nombre  text not null unique,
  icono   text
);

-- Tablas de negocio

-- Perfil de cada emprendimiento
-- Un perfil pertenece a un usuario (auth.users). Un usuario puede tener
-- VARIOS negocios (1 usuario -> N perfiles), por eso auth_user_id no es único.
create table if not exists perfiles (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid references auth.users(id) on delete cascade,
  nombre_comercial   text not null,
  descripcion        text,
  categoria_id       integer references categorias(id),
  comuna_id          integer references comunas(id),
  barrio             text,
  direccion          text,
  whatsapp           text,
  instagram          text,
  facebook           text,
  atiende_pedidos    boolean default true,
  foto_url           text,
  lat                numeric(10,7),
  lng                numeric(10,7),
  verificacion_nivel smallint not null default 0, -- 0=sin verificar, 1=básico, 2=verificado
  creado_en          timestamptz default now(),
  actualizado_en     timestamptz default now()
);

create index if not exists idx_perfiles_auth_user on perfiles (auth_user_id);
create index if not exists idx_perfiles_categoria on perfiles (categoria_id);
create index if not exists idx_perfiles_comuna on perfiles (comuna_id);

-- Productos o servicios que ofrece cada perfil
create table if not exists productos (
  id            uuid primary key default gen_random_uuid(),
  perfil_id     uuid not null references perfiles(id) on delete cascade,
  nombre        text not null,
  descripcion   text,
  es_servicio   boolean default false,
  precio        numeric(12,2) not null default 0,
  precio_mayor  numeric(12,2),
  disponible    boolean default true,
  foto_url      text,
  creado_en     timestamptz default now(),
  actualizado_en timestamptz default now()
);

-- Interacción del cliente
-- Solicitudes de pedido (el cliente pide un producto)
create table if not exists solicitudes (
  id           uuid primary key default gen_random_uuid(),
  producto_id  uuid not null references productos(id) on delete cascade,
  nombre       text,
  telefono     text,
  mensaje      text,
  estado       text default 'nueva', -- nueva | atendida | cerrada
  creado_en    timestamptz default now()
);

-- Reseñas y calificaciones de los clientes
create table if not exists resenas (
  id          uuid primary key default gen_random_uuid(),
  perfil_id   uuid not null references perfiles(id) on delete cascade,
  autor       text,
  calificacion integer not null check (calificacion between 1 and 5),
  comentario  text,
  creado_en   timestamptz default now()
);

-- Roles de usuario

-- Rol de cada usuario de Supabase Auth.
-- El rol define lo que puede hacer: emprendedor (su negocio),
-- facilitador (crea y administra negocios ajenos) y admin (modera).
create table if not exists usuarios (
  id          uuid primary key references auth.users(id) on delete cascade,
  rol         text not null default 'emprendedor'
              check (rol in ('emprendedor', 'facilitador', 'admin')),
  nombre      text,
  creado_en   timestamptz default now()
);

create index if not exists idx_usuarios_rol on usuarios (rol);

-- Datos semilla
insert into comunas (nombre) values
  ('Comuna 1'), ('Comuna 2'), ('Comuna 3')
on conflict (nombre) do nothing;

insert into categorias (nombre, icono) values
  ('Alimentos', '🍞'),
  ('Artesanías', '🧶'),
  ('Ropa y calzado', '👕'),
  ('Servicios del hogar', '🔧'),
  ('Belleza', '💇'),
  ('Tecnología', '📱')
on conflict (nombre) do nothing;