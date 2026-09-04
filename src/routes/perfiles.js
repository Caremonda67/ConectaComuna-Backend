import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

const COLUMNAS = [
  "id",
  "auth_user_id",
  "nombre_comercial",
  "descripcion",
  "categoria_id",
  "comuna_id",
  "barrio",
  "direccion",
  "whatsapp",
  "instagram",
  "facebook",
  "atiende_pedidos",
  "foto_url",
  "lat",
  "lng",
  "verificacion_nivel",
  "creado_en",
  "actualizado_en",
];

// Listado público con filtros
ruta.get("/", async (req, res) => {
  let query = claveSupabase
    .from("perfiles")
    .select("id, nombre_comercial, descripcion, categoria_id, comuna_id, barrio, foto_url, lat, lng, verificacion_nivel, categorias(nombre), comunas(nombre)");

  const { categoria, comuna, q } = req.query;
  if (categoria && categoria !== "0") query = query.eq("categoria_id", categoria);
  if (comuna && comuna !== "0") query = query.eq("comuna_id", comuna);
  if (q && q.trim()) {
    query = query.or(`nombre_comercial.ilike.%${q.trim()}%,barrio.ilike.%${q.trim()}%`);
  }

  const { data, error } = await query.order("nombre_comercial");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Detalle de un perfil: datos + productos + reseñas
ruta.get("/:id", async (req, res) => {
  const { id } = req.params;

  const { data: perfil, error: errorPerfil } = await claveSupabase
    .from("perfiles")
    .select(
      "*, categorias(nombre), comunas(nombre), productos(id, nombre, descripcion, es_servicio, precio, precio_mayor, disponible, foto_url), resenas(id, autor, calificacion, comentario, creado_en)"
    )
    .eq("id", id)
    .single();

  if (errorPerfil) return res.status(500).json({ error: errorPerfil.message });
  if (!perfil) return res.status(404).json({ error: "Perfil no encontrado" });

  res.json(perfil);
});

// Crear perfil. El emprendedor crea su negocio; el facilitador lo crea en
// nombre de un emprendedor (con su auth_user_id o, si aún no tiene cuenta,
// sin dueño).
ruta.post("/", async (req, res) => {
  const { usuario, rol, error } = await usuarioDesdePeticion(req);
  if (error) return res.status(401).json({ error });

  const authUserId = rol === "facilitador" ? (req.body.auth_user_id ?? null) : usuario.id;

  const campos = {
    auth_user_id: authUserId,
    nombre_comercial: req.body.nombre_comercial,
    descripcion: req.body.descripcion ?? null,
    categoria_id: req.body.categoria_id ?? null,
    comuna_id: req.body.comuna_id ?? null,
    barrio: req.body.barrio ?? null,
    direccion: req.body.direccion ?? null,
    whatsapp: req.body.whatsapp ?? null,
    instagram: req.body.instagram ?? null,
    facebook: req.body.facebook ?? null,
    atiende_pedidos: req.body.atiende_pedidos ?? true,
    foto_url: req.body.foto_url ?? null,
    lat: req.body.lat ?? null,
    lng: req.body.lng ?? null,
  };

  if (!campos.nombre_comercial) {
    return res.status(400).json({ error: "nombre_comercial es requerido" });
  }

  const { data, error: errorInsert } = await claveSupabase
    .from("perfiles")
    .insert(campos)
    .select()
    .single();

  if (errorInsert) return res.status(500).json({ error: errorInsert.message });
  res.status(201).json(data);
});

// Editar el propio perfil (dueño del negocio) o, si eres facilitador, cualquier negocio
ruta.patch("/:id", async (req, res) => {
  const { usuario, rol, error } = await usuarioDesdePeticion(req);
  if (error) return res.status(401).json({ error });

  const { data: existente } = await claveSupabase
    .from("perfiles")
    .select("auth_user_id")
    .eq("id", req.params.id)
    .single();

  if (!existente) return res.status(404).json({ error: "Perfil no encontrado" });

  const esDueno = existente.auth_user_id === usuario.id;
  if (!esDueno && rol !== "facilitador") {
    return res.status(403).json({ error: "No tienes permiso para editar este perfil" });
  }

  const cambios = {};
  for (const clave of COLUMNAS) {
    if (clave in req.body) cambios[clave] = req.body[clave];
  }
  // No permitir cambiar el dueño por esta vía
  delete cambios.auth_user_id;
  cambios.actualizado_en = new Date().toISOString();

  const { data, error: errorUpdate } = await claveSupabase
    .from("perfiles")
    .update(cambios)
    .eq("id", req.params.id)
    .select()
    .single();

  if (errorUpdate) return res.status(500).json({ error: errorUpdate.message });
  res.json(data);
});

export default ruta;
