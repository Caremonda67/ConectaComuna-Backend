import { Router } from "express";
import claveSupabase from "../config/supabase.js";

const ruta = Router();

// Crear una reseña (público, clientes/navegantes)
ruta.post("/", async (req, res) => {
  const { perfil_id, autor, calificacion, comentario } = req.body;

  if (!perfil_id || !autor || calificacion == null) {
    return res.status(400).json({ error: "perfil_id, autor y calificacion son requeridos" });
  }
  const nota = Number(calificacion);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    return res.status(400).json({ error: "calificacion debe ser entero entre 1 y 5" });
  }

  const { data: existe } = await claveSupabase
    .from("perfiles")
    .select("id")
    .eq("id", perfil_id)
    .single();
  if (!existe) return res.status(404).json({ error: "Perfil no encontrado" });

  const { data, error } = await claveSupabase
    .from("resenas")
    .insert({ perfil_id, autor, calificacion: nota, comentario: comentario ?? null })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

export default ruta;
