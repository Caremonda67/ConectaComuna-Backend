import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

const COLUMNAS = ["nombre", "descripcion", "es_servicio", "precio", "precio_mayor", "disponible", "foto_url"];

// Listar productos (query: ?perfil_id=)
ruta.get("/", async (req, res) => {
  let query = claveSupabase
    .from("productos")
    .select("id, perfil_id, nombre, descripcion, es_servicio, precio, precio_mayor, disponible, foto_url, perfil(nombre_comercial)");

  if (req.query.perfil_id) query = query.eq("perfil_id", req.query.perfil_id);
  if (req.query.disponible) query = query.eq("disponible", req.query.disponible === "true");

  const { data, error } = await query.order("nombre");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Crear producto en un perfil propio o gestionado por un facilitador
ruta.post("/", async (req, res) => {
  const { usuario, rol, error } = await usuarioDesdePeticion(req);
  if (error) return res.status(401).json({ error });

  const { perfil_id } = req.body;
  if (!perfil_id) return res.status(400).json({ error: "perfil_id es requerido" });

  const { data: perfil } = await claveSupabase
    .from("perfiles")
    .select("auth_user_id")
    .eq("id", perfil_id)
    .single();

  if (!perfil) return res.status(404).json({ error: "Perfil no encontrado" });
  if (perfil.auth_user_id !== usuario.id && rol !== "facilitador") {
    return res.status(403).json({ error: "No puedes agregar productos a este negocio" });
  }

  const { data, error: errorInsert } = await claveSupabase
    .from("productos")
    .insert({ ...req.body, perfil_id })
    .select()
    .single();

  if (errorInsert) return res.status(500).json({ error: errorInsert.message });
  res.status(201).json(data);
});

// Verifica que el usuario puede operar el producto: es dueño del perfil o facilitador
async function verificarGestion(productoId, usuarioId, rol) {
  const { data: producto } = await claveSupabase
    .from("productos")
    .select("perfil(auth_user_id)")
    .eq("id", productoId)
    .single();
  if (!producto) return null;
  const puede = producto?.perfil?.auth_user_id === usuarioId || rol === "facilitador";
  return puede ? producto : null;
}

// Editar producto propio o gestionado
ruta.patch("/:id", async (req, res) => {
  const { usuario, rol, error } = await usuarioDesdePeticion(req);
  if (error) return res.status(401).json({ error });

  const esGestionable = await verificarGestion(req.params.id, usuario.id, rol);
  if (esGestionable === null) {
    return res.status(404).json({ error: "Producto no encontrado o no tienes permiso" });
  }

  const cambios = {};
  for (const clave of COLUMNAS) {
    if (clave in req.body) cambios[clave] = req.body[clave];
  }
  cambios.actualizado_en = new Date().toISOString();

  const { data, error: errorUpdate } = await claveSupabase
    .from("productos")
    .update(cambios)
    .eq("id", req.params.id)
    .select()
    .single();

  if (errorUpdate) return res.status(500).json({ error: errorUpdate.message });
  res.json(data);
});

// Eliminar producto propio o gestionado
ruta.delete("/:id", async (req, res) => {
  const { usuario, rol, error } = await usuarioDesdePeticion(req);
  if (error) return res.status(401).json({ error });

  const esGestionable = await verificarGestion(req.params.id, usuario.id, rol);
  if (esGestionable === null) {
    return res.status(404).json({ error: "Producto no encontrado o no tienes permiso" });
  }

  const { error: errorDelete } = await claveSupabase
    .from("productos")
    .delete()
    .eq("id", req.params.id);
  if (errorDelete) return res.status(500).json({ error: errorDelete.message });
  res.status(204).end();
});

export default ruta;
