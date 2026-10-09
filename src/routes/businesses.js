import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

const COLUMNS = [
  "name",
  "description",
  "category",
  "phone",
  "whatsapp",
  "address",
  "neighborhood",
  "lat",
  "lng",
  "photos",
  "hours",
  "is_active",
  "wholesale_enabled",
  "wholesale_min_order",
  "wholesale_terms",
  "services_catalog"
];

// Listado público con filtros
ruta.get("/", async (req, res) => {
  let query = claveSupabase
    .from("businesses")
    .select("id, name, description, category, neighborhood, photos, lat, lng, rating_avg, rating_count, is_active, wholesale_enabled, wholesale_min_order, wholesale_terms, services_catalog, verification_status")
    .eq("is_active", true);

  const { category, q, wholesale, mayor } = req.query;
  if (category && category !== "all") query = query.eq("category", category);
  if (wholesale === "true" || mayor === "1") query = query.eq("wholesale_enabled", true);
  if (q && q.trim()) {
    const tokens = q
      .replace(/[,()%"'\\]/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (tokens.length > 0) {
      const orConditions = tokens
        .flatMap((t) => [`name.ilike.%${t}%`, `description.ilike.%${t}%`, `neighborhood.ilike.%${t}%`])
        .join(",");
      query = query.or(orConditions);
    }
  }

  const { data, error } = await query.order("name");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Detalle de un negocio: datos + reseñas
ruta.get("/:id", async (req, res) => {
  const { id } = req.params;

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!isUuid) {
    return res.status(404).json({ error: "Negocio no encontrado" });
  }

  const { data: business, error } = await claveSupabase
    .from("businesses")
    .select(
      "*, reviews(id, rating, comment, created_at, client:client_id(full_name, avatar_url))"
    )
    .eq("id", id)
    .single();

  if (error) {
    if (error.code === "22P02" || error.code === "PGRST116") {
      return res.status(404).json({ error: "Negocio no encontrado" });
    }
    return res.status(500).json({ error: error.message });
  }
  if (!business) return res.status(404).json({ error: "Negocio no encontrado" });

  res.json(business);
});

// Crear negocio
ruta.post("/", async (req, res) => {
  const { usuario, account_type, error } = await usuarioDesdePeticion(req);
  if (error) return res.status(401).json({ error });

  if (account_type !== 'business') {
    return res.status(403).json({ error: "Solo cuentas de tipo business pueden crear negocios" });
  }

  const campos = {
    owner_id: usuario.id,
    name: req.body.name,
    description: req.body.description ?? '',
    category: req.body.category,
    phone: req.body.phone ?? null,
    whatsapp: req.body.whatsapp ?? null,
    address: req.body.address ?? null,
    neighborhood: req.body.neighborhood ?? null,
    lat: req.body.lat,
    lng: req.body.lng,
    photos: req.body.photos ?? [],
    hours: req.body.hours ?? [],
    wholesale_enabled: Boolean(req.body.wholesale_enabled),
    wholesale_min_order: req.body.wholesale_min_order ?? null,
    wholesale_terms: req.body.wholesale_terms ?? null,
    services_catalog: req.body.services_catalog ?? [],
  };

  if (!campos.name || !campos.category || campos.lat == null || campos.lng == null) {
    return res.status(400).json({ error: "name, category, lat, lng son requeridos" });
  }

  const { data, error: errorInsert } = await claveSupabase
    .from("businesses")
    .insert(campos)
    .select()
    .single();

  if (errorInsert) return res.status(500).json({ error: errorInsert.message });
  res.status(201).json(data);
});

// Editar el propio negocio
ruta.patch("/:id", async (req, res) => {
  const { usuario, error } = await usuarioDesdePeticion(req);
  if (error) return res.status(401).json({ error });

  const { data: existente, error: errExistente } = await claveSupabase
    .from("businesses")
    .select("owner_id")
    .eq("id", req.params.id)
    .single();

  if (errExistente && errExistente.code !== 'PGRST116') {
    return res.status(500).json({ error: errExistente.message });
  }
  if (!existente) return res.status(404).json({ error: "Negocio no encontrado" });

  let autorizado = existente.owner_id === usuario.id;
  if (!autorizado) {
    const { data: vinculo, error: errVinculo } = await claveSupabase
      .from("facilitadores_negocio")
      .select("id")
      .eq("negocio_id", req.params.id)
      .eq("facilitador_id", usuario.id)
      .eq("estado_vinculacion", "aprobado")
      .maybeSingle();

    if (errVinculo) {
      return res.status(500).json({ error: "Error comprobando permisos de facilitador" });
    }
    if (vinculo) autorizado = true;
  }

  if (!autorizado) {
    return res.status(403).json({ error: "No tienes permiso para editar este negocio" });
  }

  const cambios = {};
  for (const clave of COLUMNS) {
    if (clave in req.body) cambios[clave] = req.body[clave];
  }

  const { data, error: errorUpdate } = await claveSupabase
    .from("businesses")
    .update(cambios)
    .eq("id", req.params.id)
    .select()
    .single();

  if (errorUpdate) return res.status(500).json({ error: errorUpdate.message });
  res.json(data);
});

export default ruta;
