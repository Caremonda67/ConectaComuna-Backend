import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

// Crear un pedido (requiere login de cliente)
ruta.post("/", async (req, res) => {
  const { usuario, account_type, error: authError } = await usuarioDesdePeticion(req);
  if (authError) return res.status(401).json({ error: authError });

  const {
    business_id,
    title,
    description,
    scheduled_for,
    price_estimate,
    final_price,
    advance_payment,
    service_location_type,
    delivery_address,
    photos,
  } = req.body;

  if (!business_id || !title) {
    return res.status(400).json({ error: "business_id y title son requeridos" });
  }

  const { data: business, error: bizError } = await claveSupabase
    .from("businesses")
    .select("owner_id")
    .eq("id", business_id)
    .maybeSingle();

  if (bizError) return res.status(500).json({ error: bizError.message });
  if (!business) return res.status(404).json({ error: "Negocio no encontrado" });
  if (business.owner_id === usuario.id) {
    return res.status(403).json({ error: "No puedes hacer un pedido a tu propio negocio" });
  }

  // Regla Trato Seguro Comunal: el anticipo no puede superar el 50%
  const anticipo = advance_payment != null ? Number(advance_payment) : 0;
  if (anticipo < 0) {
    return res.status(400).json({ error: "El anticipo no puede ser negativo" });
  }
  const basePrecio = final_price != null ? Number(final_price) : (price_estimate != null ? Number(price_estimate) : null);
  if (basePrecio && anticipo > Math.floor(basePrecio * 0.5)) {
    return res.status(400).json({ error: "El anticipo no puede superar el 50% del valor pactado (Trato Seguro)" });
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
      final_price: final_price ?? null,
      advance_payment: anticipo,
      service_location_type: service_location_type ?? 'workshop',
      delivery_address: delivery_address ?? null,
      photos: Array.isArray(photos) ? photos : [],
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
    const { data: myBusiness, error: myBizErr } = await claveSupabase
      .from("businesses")
      .select("id")
      .eq("owner_id", usuario.id)
      .maybeSingle();

    if (myBizErr) return res.status(500).json({ error: myBizErr.message });
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

  const { data: order, error: orderErr } = await claveSupabase
    .from("orders")
    .select("client_id, final_price, price_estimate, business:business_id(owner_id)")
    .eq("id", req.params.id)
    .maybeSingle();

  if (orderErr) return res.status(500).json({ error: orderErr.message });
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

  const updatePayload = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (req.body.final_price !== undefined) updatePayload.final_price = req.body.final_price;
  if (req.body.advance_payment !== undefined) {
    const adv = Number(req.body.advance_payment);
    if (adv < 0) {
      return res.status(400).json({ error: "El anticipo no puede ser negativo" });
    }
    const precioReferencia = req.body.final_price !== undefined ? Number(req.body.final_price) : Number(order.final_price ?? order.price_estimate ?? 0);
    if (precioReferencia > 0 && adv > Math.floor(precioReferencia * 0.5)) {
      return res.status(400).json({ error: "El anticipo no puede superar el 50% del precio pactado (Trato Seguro)" });
    }
    updatePayload.advance_payment = adv;
  }
  if (req.body.business_notes !== undefined) updatePayload.business_notes = req.body.business_notes;
  if (req.body.cancellation_reason !== undefined) updatePayload.cancellation_reason = req.body.cancellation_reason;

  const { data, error } = await claveSupabase
    .from("orders")
    .update(updatePayload)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default ruta;
