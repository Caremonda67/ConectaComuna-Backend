import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

// Listar reportes comunitarios
ruta.get("/", async (req, res) => {
  const { usuario, account_type, error: authError } = await usuarioDesdePeticion(req);
  if (authError) return res.status(401).json({ error: authError });

  if (account_type !== "facilitador") {
    return res.status(403).json({ error: "Solo los facilitadores pueden revisar reportes" });
  }

  const { estado } = req.query;
  let query = claveSupabase
    .from("reportes_comunitarios")
    .select("*, negocio:negocio_id(id, name, neighborhood, phone, whatsapp), reportado_por:reportado_por_id(full_name, avatar_url)")
    .order("creado_en", { ascending: false });

  if (estado && estado !== "todos") {
    query = query.eq("estado", estado);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Crear reporte comunitario
ruta.post("/", async (req, res) => {
  const { usuario, error: authError } = await usuarioDesdePeticion(req);
  if (authError) return res.status(401).json({ error: authError });

  const { negocio_id, motivo, descripcion } = req.body;
  if (!negocio_id || !motivo) {
    return res.status(400).json({ error: "negocio_id y motivo son requeridos" });
  }

  const { data, error } = await claveSupabase
    .from("reportes_comunitarios")
    .insert({
      negocio_id,
      reportado_por_id: usuario.id,
      motivo,
      descripcion: descripcion ?? null,
      estado: "pendiente",
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// Actualizar estado de resolución de un reporte
ruta.patch("/:id", async (req, res) => {
  const { usuario, account_type, error: authError } = await usuarioDesdePeticion(req);
  if (authError) return res.status(401).json({ error: authError });

  if (account_type !== "facilitador") {
    return res.status(403).json({ error: "Solo los facilitadores pueden moderar reportes" });
  }

  const { estado, notas_moderacion } = req.body;
  const estadosValidos = ["pendiente", "revisado", "descartado"];
  if (estado && !estadosValidos.includes(estado)) {
    return res.status(400).json({ error: "Estado de reporte no válido" });
  }

  const payload = {
    actualizado_en: new Date().toISOString(),
    moderado_por_id: usuario.id,
  };
  if (estado) payload.estado = estado;
  if (notas_moderacion !== undefined) payload.notas_moderacion = notas_moderacion;

  const { data, error } = await claveSupabase
    .from("reportes_comunitarios")
    .update(payload)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

export default ruta;
