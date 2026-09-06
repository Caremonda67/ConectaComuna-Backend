import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

// Crear un pedido (requiere login de cliente)
ruta.post("/", async (req, res) => {
  const { usuario, account_type, error: authError } = await usuarioDesdePeticion(req);
  if (authError) return res.status(401).json({ error: authError });

  const { business_id, title, description, scheduled_for, price_estimate } = req.body;

  if (!business_id || !title) {
    return res.status(400).json({ error: "business_id y title son requeridos" });
  }

  const { data: business } = await claveSupabase
    .from("businesses")
    .select("owner_id")
    .eq("id", business_id)
    .single();

  if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
  if (business.owner_id === usuario.id) {
    return res.status(403).json({ error: "No puedes hacer un pedido a tu propio negocio" });
  }

  const { data, error } = await claveSupabase
    .from("orders")
    .insert({
      business_id,
      client_id: usuario.id,
      title,
      description: description ?? '',
      scheduled_for: scheduled_for ?? null,
      price_estimate: price_estimate ?? null,
      status: 'pending'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Listar pedidos involucrados (como cliente o como negocio)
ruta.get("/", async (req, res) => {
  const { usuario, account_type, error: authError } = await usuarioDesdePeticion(req);
  if (authError) return res.status(401).json({ error: authError });

  let query = claveSupabase.from("orders").select("*, business:business_id(name), client:client_id(full_name, phone)");

  if (account_type === 'business') {
    // Buscar el negocio del usuario actual
    const { data: myBusiness } = await claveSupabase.from("businesses").select("id").eq("owner_id", usuario.id).single();
    if (!myBusiness) return res.json([]);
    query = query.eq("business_id", myBusiness.id);
  } else {
    query = query.eq("client_id", usuario.id);
  }

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Actualizar estado de un pedido
ruta.patch("/:id/status", async (req, res) => {
  const { usuario, error: authError } = await usuarioDesdePeticion(req);
  if (authError) return res.status(401).json({ error: authError });

  const { status } = req.body;
  const validStatuses = ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Estado inválido" });
  }

  const { data: order } = await claveSupabase
    .from("orders")
    .select("client_id, business:business_id(owner_id)")
    .eq("id", req.params.id)
    .single();

  if (!order) return res.status(404).json({ error: "Pedido no encontrado" });

  const isClient = order.client_id === usuario.id;
  const isBusinessOwner = order.business?.owner_id === usuario.id;

  if (!isClient && !isBusinessOwner) {
    return res.status(403).json({ error: "No tienes permiso para modificar este pedido" });
  }

  // Si es cliente, solo puede cancelar (por simplificar)
  if (isClient && status !== 'cancelled') {
    return res.status(403).json({ error: "El cliente solo puede cancelar el pedido" });
  }

  const { data, error } = await claveSupabase
    .from("orders")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default ruta;
