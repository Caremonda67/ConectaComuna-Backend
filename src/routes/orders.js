import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

// Verificación pública de un pacto de Trato Seguro (sin requerir autenticación).
// Resuelve la consulta una función de la base, así el QR funciona sin sesión y
// sin exponer la tabla de pedidos a cualquiera que pruebe códigos.
ruta.get("/verificar/:codigo", async (req, res) => {
  const codigo = typeof req.params.codigo === "string" ? req.params.codigo.trim() : "";
  const limpio = codigo.replace(/^#?CC[-_]?/i, "").trim().toLowerCase();

  if (!limpio) {
    return res.status(400).json({ error: "El código de verificación es obligatorio." });
  }
  if (limpio.length > 64 || !/^[a-z0-9-]+$/.test(limpio)) {
    return res.status(400).json({ error: "El código de verificación no es válido." });
  }

  try {
    const semilla = pactoDeDemostracion(limpio);
    if (semilla) return res.json(semilla);

    // El código visible son los 8 primeros caracteres del UUID. Con menos no se
    // consulta: permitiría barrer los pedidos de la comuna uno por uno.
    if (limpio.replace(/-/g, "").length < 6) {
      return res.status(400).json({ error: "El código está incompleto." });
    }

    const { data, error } = await claveSupabase.rpc("verificar_pedido_publico", { p_codigo: limpio });
    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "No se encontró ningún pacto registrado con el código indicado." });
    }

    res.json(data);
  } catch (err) {
    console.error("Error al verificar pacto de Trato Seguro:", err);
    res.status(500).json({ error: "Error al consultar el pacto de Trato Seguro." });
  }
});

// Pactos de muestra para las ferias y las pruebas del jurado.
function pactoDeDemostracion(codigo) {
  const esDemo = codigo === "demo2026" || codigo === "demo";
  const esSemilla = esDemo || ["ord-1", "ord-2", "ord-3"].includes(codigo);
  if (!esSemilla) return null;

  const semillas = {
    "ord-1": {
      titulo: "Manicure semipermanente y cuidado de uñas",
      descripcion: "Servicio a domicilio en Antonio Nariño.",
      estado: "pending",
      precio: 45000,
      anticipo: 20000,
      modalidad: "home_delivery",
      direccion: "Carrera 40 # 42-15",
      negocio: { id: "biz-1", nombre: "Uñas & Belleza Comunal", categoria: "belleza" },
    },
    "ord-2": {
      titulo: "Arreglo de bastas de 3 pantalones",
      descripcion: "Ajuste de 5 cm de basta.",
      estado: "completed",
      precio: 30000,
      anticipo: 15000,
      modalidad: "workshop",
      direccion: null,
      negocio: { id: "biz-2", nombre: "Costuras Doña Marta", categoria: "costura" },
    },
    "ord-3": {
      titulo: "Confección de uniforme escolar",
      descripcion: "Dos jardineras escolares talla 10.",
      estado: "in_progress",
      precio: 120000,
      anticipo: 60000,
      modalidad: "workshop",
      direccion: null,
      negocio: { id: "biz-2", nombre: "Costuras Doña Marta", categoria: "costura" },
    },
  };

  const base = esDemo
    ? {
        titulo: "Restauración de comedor de madera y cambio de tapizado",
        descripcion:
          "Lijado fino, barniz mate impermeable y retapizado en lino antifluidos para 4 sillas de comedor.",
        estado: "in_progress",
        precio: 160000,
        anticipo: 80000,
        modalidad: "workshop",
        direccion: "Calle 44 # 39B-18, Taller La Esperanza",
        negocio: { id: "biz-demo-ebanisteria", nombre: "Ebanistería y Restauración Don Carlos", categoria: "arreglos" },
      }
    : semillas[codigo];

  const id = esDemo ? "demo-2026-acuerdo-comunal" : `${codigo}-demostracion`;
  const saldo = Math.max(0, base.precio - base.anticipo);

  return {
    codigo: esDemo ? "CC-DEMO2026" : `CC-${codigo.toUpperCase()}`,
    order_id: id,
    status: base.estado,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    scheduled_for: new Date(Date.now() + 172800000).toISOString(),
    title: base.titulo,
    description: base.descripcion,
    service_location_type: base.modalidad,
    delivery_address: base.direccion,
    business: {
      id: base.negocio.id,
      name: base.negocio.nombre,
      category: base.negocio.categoria,
      phone: "3187654321",
      barrio: "Antonio Nariño, Comuna 16, Cali",
      is_verified: true,
    },
    client: {
      name: esDemo ? "Esperanza Gómez (Vecina)" : "Vecino de la Comuna",
      phone_masked: "...6543",
    },
    precio_total: base.precio,
    anticipo: base.anticipo,
    saldo_contra_entrega: saldo,
    porcentaje_anticipo: base.precio > 0 ? Math.round((base.anticipo / base.precio) * 100) : 0,
    clausula_mediacion:
      "Pacto respaldado por el Comité de Convivencia y Mediación Comunitaria de la JAC de la Comuna y ConectaComuna.",
  };
}

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
    .select("*, business:businesses(id, name, category, photos, phone), client:profiles!orders_client_id_fkey(id, full_name, avatar_url, phone)")
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
