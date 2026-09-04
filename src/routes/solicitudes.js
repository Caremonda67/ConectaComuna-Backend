import { Router } from "express";
import claveSupabase from "../config/supabase.js";

const ruta = Router();

// Crear una solicitud/pedido (cliente no necesita login)
ruta.post("/", async (req, res) => {
  const { producto_id, nombre, telefono, mensaje } = req.body;

  if (!producto_id || !nombre || !telefono) {
    return res.status(400).json({ error: "producto_id, nombre y telefono son requeridos" });
  }

  const { data: existe } = await claveSupabase
    .from("productos")
    .select("id")
    .eq("id", producto_id)
    .single();
  if (!existe) return res.status(404).json({ error: "Producto no encontrado" });

  const { data, error } = await claveSupabase
    .from("solicitudes")
    .insert({ producto_id, nombre, telefono, mensaje: mensaje ?? null, estado: "nueva" })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

export default ruta;
