import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

// Crear una reseña (requiere login de cliente y un pedido completado)
ruta.post("/", async (req, res) => {
  const { usuario, error: authError } = await usuarioDesdePeticion(req);
  if (authError) return res.status(401).json({ error: authError });

  const { order_id, business_id, rating, comment } = req.body;

  if (!order_id || !business_id || rating == null) {
    return res.status(400).json({ error: "order_id, business_id y rating son requeridos" });
  }
  const nota = Number(rating);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    return res.status(400).json({ error: "rating debe ser entero entre 1 y 5" });
  }

  // Como usamos service_role_key, debemos validar la regla manualmente:
  // La orden debe existir, pertenecer al cliente, ser para este negocio y estar completada.
  const { data: order } = await claveSupabase
    .from("orders")
    .select("id")
    .eq("id", order_id)
    .eq("client_id", usuario.id)
    .eq("business_id", business_id)
    .eq("status", "completed")
    .single();

  if (!order) {
    return res.status(403).json({ error: "No puedes calificar este pedido. Debe estar completado y ser tuyo." });
  }

  const { data, error } = await claveSupabase
    .from("reviews")
    .insert({
      order_id,
      business_id,
      client_id: usuario.id,
      rating: nota,
      comment: comment ?? null
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') { // unique violation
      return res.status(400).json({ error: "Ya existe una reseña para este pedido" });
    }
    return res.status(500).json({ error: error.message });
  }
  
  res.status(201).json(data);
});

export default ruta;
