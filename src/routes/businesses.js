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
  "services_catalog",
  "verification_status"
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
    query = query.or(`name.ilike.%${q.trim()}%,neighborhood.ilike.%${q.trim()}%`);
  }

  const { data, error } = await query.order("name");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Detalle de un negocio: datos + reseñas
ruta.get("/:id", async (req, res) => {
  const { id } = req.params;

  const { data: business, error } = await claveSupabase
    .from("businesses")
    .select(
      "*, reviews(id, rating, comment, created_at, client:client_id(full_name, avatar_url))"
    )
    .eq("id", id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
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

  const { data: existente } = await claveSupabase
    .from("businesses")
    .select("owner_id")
    .eq("id", req.params.id)
    .single();

  if (!existente) return res.status(404).json({ error: "Negocio no encontrado" });

  if (existente.owner_id !== usuario.id) {
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
