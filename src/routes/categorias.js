import { Router } from "express";
import claveSupabase from "../config/supabase.js";

const ruta = Router();

ruta.get("/", async (_req, res) => {
  const { data, error } = await claveSupabase
    .from("categorias")
    .select("id, nombre, icono")
    .order("nombre");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default ruta;
