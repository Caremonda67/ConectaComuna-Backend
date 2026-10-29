import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { envolver } from "../middleware/errores.js";

const ruta = Router();

// Verificación pública de un pacto de Trato Seguro. La resuelve una función de
// la base, así el QR abre sin sesión y sin exponer la tabla de pedidos. El
// nivel de detalle lo decide esa misma función: las partes ven todo, el resto
// solo la ficha pública.
ruta.get("/verificar/:codigo", envolver(async (req, res) => {
  const codigo = typeof req.params.codigo === "string" ? req.params.codigo.trim() : "";
  const limpio = codigo.replace(/^#?CC[-_]?/i, "").trim().toLowerCase();

  if (!limpio) {
    return res.status(400).json({ error: "El código de verificación es obligatorio." });
  }
  if (limpio.length > 64 || !/^[a-z0-9-]+$/.test(limpio)) {
    return res.status(400).json({ error: "El código de verificación no es válido." });
  }

  try {
    const ejemplo = pactoDeEjemplo(limpio);
    if (ejemplo) return res.json(ejemplo);

    // El código visible son los 8 primeros caracteres del UUID. Con menos no se
    // consulta: permitiría barrer los pedidos de la comuna uno por uno.
    if (limpio.replace(/-/g, "").length < 8) {
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
}));

// Pactos de ejemplo para ferias y ensayos. Van marcados y sin datos de nadie.
function pactoDeEjemplo(codigo) {
  const semillas = {
    demo2026: {
      titulo: "Restauración de comedor de madera y cambio de tapizado",
      descripcion:
        "Lijado fino, barniz mate impermeable y retapizado en lino antifluidos para 4 sillas de comedor.",
      estado: "in_progress",
      precio: 160000,
      anticipo: 80000,
      modalidad: "workshop",
      negocio: { id: "biz-demo-ebanisteria", nombre: "Ebanistería y Restauración Don Carlos", categoria: "arreglos" },
    },
    "ord-1": {
      titulo: "Manicure semipermanente y cuidado de uñas",
      descripcion: "Servicio a domicilio en Antonio Nariño.",
      estado: "pending",
      precio: 45000,
      anticipo: 20000,
      modalidad: "home_delivery",
      negocio: { id: "biz-1", nombre: "Uñas & Belleza Comunal", categoria: "belleza" },
    },
    "ord-2": {
      titulo: "Arreglo de bastas de 3 pantalones",
      descripcion: "Ajuste de 5 cm de basta.",
      estado: "completed",
      precio: 30000,
      anticipo: 15000,
      modalidad: "workshop",
      negocio: { id: "biz-2", nombre: "Costuras Doña Marta", categoria: "costura" },
    },
  };

  const base = semillas[codigo === "demo" ? "demo2026" : codigo];
  if (!base) return null;

  return {
    nivel: "publico",
    ejemplo: true,
    codigo: codigo === "demo" ? "CC-DEMO2026" : `CC-${codigo.toUpperCase()}`,
    status: base.estado,
    created_at: new Date(Date.now() - 86400000).toISOString(),
    scheduled_for: new Date(Date.now() + 172800000).toISOString(),
    title: base.titulo,
    description: base.descripcion,
    service_location_type: base.modalidad,
    business: {
      id: base.negocio.id,
      name: base.negocio.nombre,
      category: base.negocio.categoria,
      phone: "3000000000",
      barrio: "Antonio Nariño",
      is_verified: true,
    },
    precio_total: base.precio,
    anticipo: base.anticipo,
    saldo_contra_entrega: Math.max(0, base.precio - base.anticipo),
    porcentaje_anticipo: base.precio > 0 ? Math.round((base.anticipo / base.precio) * 100) : 0,
    clausula_mediacion:
      "Pacto de ejemplo. En un acuerdo real, el anticipo no puede superar el 50% del precio y el equipo de Conecta Comuna revisa los reportes.",
  };
}

export default ruta;
