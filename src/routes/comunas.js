import { Router } from "express";
import claveSupabase from "../config/supabase.js";

const ruta = Router();

ruta.get("/", async (_req, res) => {
  const { data, error } = await claveSupabase
    .from("comunas")
    .select("id, nombre")
    .order("nombre");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default ruta;
