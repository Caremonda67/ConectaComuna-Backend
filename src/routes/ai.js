import { Router } from "express";
import claveSupabase from "../config/supabase.js";

const ruta = Router();

// Centro de referencia de la comuna (Cali) si el usuario no tiene ubicación definida
const CENTRO_COMUNA_DEFAULT = {
  lat: 3.4372,
  lng: -76.5225,
  barrio: "Comuna",
};

const BARRIOS_COORDENADAS = {
  "antonio nariño": { barrio: "Antonio Nariño", lat: 3.4365, lng: -76.5255 },
  "antonio narino": { barrio: "Antonio Nariño", lat: 3.4365, lng: -76.5255 },
  "el rodeo": { barrio: "El Rodeo", lat: 3.4401, lng: -76.5209 },
  "nueva floresta": { barrio: "Nueva Floresta", lat: 3.4342, lng: -76.5281 },
  "vallado": { barrio: "Vallado", lat: 3.4140, lng: -76.5050 },
  "san judas": { barrio: "San Judas", lat: 3.4215, lng: -76.5120 },
  "ciudad córdoba": { barrio: "Ciudad Córdoba", lat: 3.4180, lng: -76.5080 },
  "ciudad cordoba": { barrio: "Ciudad Córdoba", lat: 3.4180, lng: -76.5080 },
  "mariano ramos": { barrio: "Mariano Ramos", lat: 3.4130, lng: -76.5160 },
  "república de israel": { barrio: "República de Israel", lat: 3.4240, lng: -76.5170 },
  "republica de israel": { barrio: "República de Israel", lat: 3.4240, lng: -76.5170 },
};

function detectarBarrioEnTexto(texto) {
  if (!texto || typeof texto !== "string") return null;
  const t = texto.toLowerCase();
  for (const [clave, datos] of Object.entries(BARRIOS_COORDENADAS)) {
    if (t.includes(clave)) {
      return datos;
    }
  }
  return null;
}

/**
 * Normaliza y describe la ubicación de forma humana para evitar frases como "en Mi ubicación".
 */
function describirUbicacion(barrio, esDefinida = true) {
  if (!esDefinida || !barrio || barrio === "Comuna" || barrio === "Cali" || barrio.toLowerCase().includes("mi ubicación") || barrio.toLowerCase().includes("mi ubicacion")) {
    return {
      cercaDe: "en nuestra comuna",
      enBarrio: "toda nuestra comuna",
      etiquetaCorta: "Comuna",
      esDefinida: false,
    };
  }
  return {
    cercaDe: `cerca del barrio ${barrio}`,
    enBarrio: `el barrio ${barrio}`,
    etiquetaCorta: `Barrio ${barrio}`,
    esDefinida: true,
  };
}

/**
 * Calcula distancia aproximada en metros entre dos coordenadas (Haversine simple).
 */
function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  const R = 6371e3; // Radio de la tierra en metros
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Consulta negocios activos en la comuna para nutrir el contexto del asistente.
 */
async function obtenerNegociosComuna() {
  try {
    const { data, error } = await claveSupabase
      .from("businesses")
      .select("id, name, description, category, neighborhood, address, phone, whatsapp, lat, lng, rating_avg, verification_status, wholesale_enabled, services_catalog")
      .eq("is_active", true)
      .limit(25);

    if (error) {
      console.warn("No se pudieron cargar negocios para el asistente:", error.message);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn("Excepción al consultar negocios para IA:", err.message);
    return [];
  }
}

/**
 * Consulta pedidos y pactos de Trato Seguro activos del usuario para nutrir el contexto del asistente.
 */
async function obtenerPedidosUsuario(userId, businessId) {
  if (!userId && !businessId) return [];
  try {
    let query = claveSupabase
      .from("orders")
      .select("id, title, status, price_estimate, final_price, advance_payment, business:businesses(name), client:profiles!orders_client_id_fkey(full_name)")
      .order("created_at", { ascending: false })
      .limit(6);

    if (businessId && userId) {
      query = query.or(`client_id.eq.${userId},business_id.eq.${businessId}`);
    } else if (businessId) {
      query = query.eq("business_id", businessId);
    } else {
      query = query.eq("client_id", userId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn("No se pudieron cargar pedidos para el asistente:", error.message);
      return [];
    }

    return (data || []).map((o) => ({
      id: o.id,
      codigo: `CC-${o.id.slice(0, 8).toUpperCase()}`,
      titulo: o.title,
      estado: o.status,
      monto: o.final_price || o.price_estimate || 0,
      anticipo: o.advance_payment || 0,
      contraparte: o.business?.name || o.client?.full_name || "Vecino",
      rol: businessId ? "comerciante" : "cliente",
    }));
  } catch (err) {
    console.warn("Excepción al consultar pedidos para IA:", err.message);
    return [];
  }
}

/**
 * Motor local inteligente y con memoria de contexto multi-turno.
 * Garantiza respuestas naturales y útiles para todas las sugerencias y flujos del sistema.
 */
function motorRespaldoLocal(mensaje, ubicacionUsuario, negocios, historial = [], contexto = {}) {
  const texto = mensaje.toLowerCase().trim();
  const barrioDetectado = detectarBarrioEnTexto(texto);
  const tieneUbicacionExplicita = !!(
    barrioDetectado ||
    (ubicacionUsuario?.esDefinida && ubicacionUsuario?.barrio && ubicacionUsuario.barrio !== "Comuna" && ubicacionUsuario.barrio !== "Cali")
  );

  const barrio = barrioDetectado?.barrio || (tieneUbicacionExplicita ? ubicacionUsuario?.barrio : null);
  const lat = barrioDetectado?.lat || (tieneUbicacionExplicita ? ubicacionUsuario?.lat : null);
  const lng = barrioDetectado?.lng || (tieneUbicacionExplicita ? ubicacionUsuario?.lng : null);
  const descUbi = describirUbicacion(barrio, tieneUbicacionExplicita);

  // 0a. Detección y confirmación explícita al indicar barrio por texto o botón
  if (barrioDetectado && (texto.includes("estoy") || texto.includes("vivo") || texto.includes("barrio") || texto.startsWith("en ") || texto === barrioDetectado.barrio.toLowerCase())) {
    const ordenados = negocios.map((n) => ({
      ...n,
      distanciaMetros: calcularDistanciaMetros(barrioDetectado.lat, barrioDetectado.lng, n.lat, n.lng),
    })).sort((a, b) => (a.distanciaMetros || 999999) - (b.distanciaMetros || 999999));

    return {
      mensaje: `¡Listo vecino! He fijado tu ubicación en el barrio ${barrioDetectado.barrio}. Estos son los oficios más cercanos a tu zona:`,
      tipo: "negocios",
      ubicacionDetectada: {
        barrio: barrioDetectado.barrio,
        lat: barrioDetectado.lat,
        lng: barrioDetectado.lng,
      },
      negociosSugeridos: ordenados.slice(0, 3).map((n) => ({
        id: n.id,
        nombre: n.name,
        categoria: n.category,
        barrio: n.neighborhood,
        whatsapp: n.whatsapp,
        distanciaMetros: n.distanciaMetros,
        verificado: n.verification_status === "verified",
      })),
      sugerencias: ["Ver en el mapa", "¿Cómo funciona el Trato Seguro?", "Buscar otro oficio"],
    };
  }

  // 0b. Pregunta por cercanía ("cuál es el comercio más cercano") cuando la ubicación aún no está definida
  const esPreguntaCercania =
    texto.includes("más cercano") ||
    texto.includes("mas cercano") ||
    texto.includes("cerca de mí") ||
    texto.includes("cerca de mi") ||
    texto.includes("más cerca") ||
    texto.includes("mas cerca") ||
    texto === "oficios cerca" ||
    texto === "oficios cercanos" ||
    texto.includes("comercio más cercano") ||
    texto.includes("comercio mas cercano");

  if (esPreguntaCercania && !tieneUbicacionExplicita) {
    return {
      mensaje: `Vecino, aún no conozco tu barrio o ubicación exacta en la comuna para calcularte distancias precisas. Puedes activar tu ubicación con el botón de GPS o indicarme en qué barrio te encuentras (por ejemplo: Antonio Nariño, El Rodeo, Nueva Floresta, Vallado).\n\nMientras tanto, aquí tienes algunos de los oficios y talleres más recomendados de la comuna:`,
      tipo: "negocios",
      negociosSugeridos: negocios.slice(0, 3).map((n) => ({
        id: n.id,
        nombre: n.name,
        categoria: n.category,
        barrio: n.neighborhood,
        whatsapp: n.whatsapp,
        distanciaMetros: null,
        verificado: n.verification_status === "verified",
      })),
      sugerencias: [
        "📍 Usar mi ubicación actual",
        "Estoy en El Rodeo",
        "Estoy en Antonio Nariño",
        "Estoy en Nueva Floresta",
      ],
    };
  }

  const esAutenticado = !!contexto?.autenticado;
  const tipoCuenta = contexto?.tipoCuenta || (esAutenticado ? 'client' : 'anonimo');
  const esCliente = tipoCuenta === 'client';
  const esEmprendedor = tipoCuenta === 'business' || contexto?.rolActivo === 'business';
  const tieneNegocio = !!contexto?.negocioPropio?.tieneNegocio;
  const nombreUsuario = contexto?.nombre ? contexto.nombre.split(' ')[0] : 'vecino';
  const nombreNegocio = contexto?.negocioPropio?.nombre || 'tu negocio';

  // 0. Confirmación explícita para activar perfil de negocio
  if (
    texto === 'sí, activar mi negocio' ||
    texto === 'si, activar mi negocio' ||
    texto === 'activar mi negocio' ||
    texto === 'confirmar activar negocio'
  ) {
    return {
      mensaje: `¡Excelente decisión, ${nombreUsuario}! He preparado la activación de tu perfil de Emprendedor. Toca el botón para completar los datos de tu taller (nombre, categoría y fotos):`,
      tipo: 'navegacion',
      rutaNavegacion: '/panel/negocio',
      sugerencias: ['🎙️ Dictar mi servicio para el catálogo', 'Ver en el mapa'],
    };
  }

  if (
    texto === 'no por ahora' ||
    texto === 'no, mantener como cliente' ||
    texto === 'cancelar activación'
  ) {
    return {
      mensaje: `Entendido, ${nombreUsuario}. Tu cuenta continúa en rol de Cliente para buscar, consultar y contactar los mejores oficios de la comuna. ¿En qué te colaboro hoy?`,
      tipo: 'conversacion',
      sugerencias: ['Oficios cerca de mí', 'Ver en el mapa', '¿Cómo funciona el Trato Seguro?'],
    };
  }

  // 0b. Detección directa de código oficial de Trato Seguro (ej: CC-93E416, CC-ORD-1)
  const matchCodigo = texto.match(/\b(CC-[A-Z0-9]{4,10})\b/i);
  if (matchCodigo) {
    const cod = matchCodigo[1].toUpperCase();
    const pedidoRelacionado = (contexto?.pedidosActivos || []).find(
      (p) => p.codigo.toUpperCase() === cod || (p.id && p.id.toUpperCase().startsWith(cod.replace('CC-', '')))
    );

    let detalle = `¡He ubicado el acuerdo ${cod} en el registro comunal!`;
    if (pedidoRelacionado) {
      const est =
        pedidoRelacionado.estado === 'pending'
          ? 'Pendiente de inicio'
          : pedidoRelacionado.estado === 'accepted'
          ? 'Pacto aceptado por el taller'
          : pedidoRelacionado.estado === 'in_progress'
          ? 'Trabajo en ejecución'
          : pedidoRelacionado.estado === 'completed'
          ? 'Finalizado y entregado'
          : pedidoRelacionado.estado;
      const contra = pedidoRelacionado.rol === 'comerciante' ? `Cliente: ${pedidoRelacionado.contraparte}` : `Taller: ${pedidoRelacionado.contraparte}`;
      detalle += `\n• Trabajo: ${pedidoRelacionado.titulo}\n• ${contra}\n• Estado: ${est}\n• Valor: $ ${Number(pedidoRelacionado.monto).toLocaleString('es-CO')} COP`;
    }

    return {
      mensaje: `${detalle}\n\nToca el botón para consultar el comprobante oficial con código QR y verificación en tiempo real:`,
      tipo: 'navegacion',
      rutaNavegacion: `/trato-seguro/verificar/${cod}`,
      sugerencias: ['¿Cómo funciona el Trato Seguro?', 'Ver mis pedidos activos', 'Ver oficios cercanos'],
    };
  }

  // 0c. Consulta de pedidos o acuerdos del usuario ("mis pedidos", "cómo va mi pedido", etc.)
  const esConsultaMisPedidos =
    texto.includes('mis pedidos') ||
    texto.includes('mi pedido') ||
    texto.includes('mis acuerdos') ||
    texto.includes('mis tratos') ||
    texto.includes('mis pactos') ||
    texto.includes('cómo va mi') ||
    texto.includes('como va mi') ||
    texto.includes('estado de mi') ||
    texto.includes('trabajos en curso');

  if (esConsultaMisPedidos) {
    if (!esAutenticado) {
      return {
        mensaje: `Para consultar el estado de tus pedidos y acuerdos de Trato Seguro, por favor ingresa a tu cuenta vecinal:`,
        tipo: 'navegacion',
        rutaNavegacion: '/entrar',
        sugerencias: ['Ingresar a mi cuenta', '¿Cómo funciona el Trato Seguro?', 'Ver oficios cercanos'],
      };
    }

    const pedidos = Array.isArray(contexto?.pedidosActivos) ? contexto.pedidosActivos : [];
    if (pedidos.length > 0) {
      const primerPedido = pedidos[0];
      const detallePedidos = pedidos
        .map((p, idx) => {
          const est =
            p.estado === 'pending'
              ? 'Pendiente de inicio'
              : p.estado === 'accepted'
              ? 'Aceptado por el taller'
              : p.estado === 'in_progress'
              ? 'En curso'
              : p.estado === 'completed'
              ? 'Finalizado'
              : p.estado;
          const contra = p.rol === 'comerciante' ? `Cliente: ${p.contraparte}` : `Taller: ${p.contraparte}`;
          return `${idx + 1}. #${p.codigo} — "${p.titulo}" (${contra}) • Estado: ${est} • Valor: $ ${Number(p.monto).toLocaleString('es-CO')} COP`;
        })
        .join('\n');

      return {
        mensaje: `¡Hola ${nombreUsuario}! Tienes ${pedidos.length} acuerdo(s) en la comuna:\n\n${detallePedidos}\n\nPuedes consultar el comprobante oficial con código QR o ir a tu panel:`,
        tipo: 'navegacion',
        rutaNavegacion: `/trato-seguro/verificar/${primerPedido.codigo}`,
        sugerencias: [
          `Verificar ${primerPedido.codigo}`,
          esEmprendedor ? 'Ir al panel de mi negocio' : 'Ver mis pedidos en el panel',
          '¿Cómo funciona el Trato Seguro?',
        ],
      };
    }

    return {
      mensaje: `Vecino ${nombreUsuario}, en este momento no tienes pedidos ni pactos activos registrados. Cuando solicites un servicio a un taller del barrio o recibas un encargo, aparecerá aquí con código verificable y tope de anticipo protegido.`,
      tipo: 'conversacion',
      sugerencias: ['Oficios cerca de mí', 'Ver en el mapa', '¿Cómo funciona el Trato Seguro?'],
    };
  }

  // Filtrado de negocios con cálculo de distancia
  const negociosConDistancia = negocios.map((n) => ({
    ...n,
    distanciaMetros: calcularDistanciaMetros(lat, lng, n.lat, n.lng),
  })).sort((a, b) => (a.distanciaMetros || 999999) - (b.distanciaMetros || 999999));

  // Último mensaje del asistente para contexto
  const mensajesBot = historial.filter((h) => h.rol === "model");
  const ultimoMensajeBot = mensajesBot.length > 0 ? mensajesBot[mensajesBot.length - 1].texto.toLowerCase() : "";

  // 1. Navegación al mapa comunal
  if (
    texto === "ver en el mapa" ||
    texto.includes("en el mapa") ||
    texto.includes("ver mapa") ||
    texto.includes("abrir mapa") ||
    texto === "mapa"
  ) {
    let ruta = "/mapa";
    let catNombre = "";
    if (ultimoMensajeBot.includes("costura") || ultimoMensajeBot.includes("modista") || ultimoMensajeBot.includes("marta")) {
      ruta = "/mapa?categoria=costura";
      catNombre = "de costura y modistería";
    } else if (ultimoMensajeBot.includes("cerraj")) {
      ruta = "/mapa?categoria=cerrajeria";
      catNombre = "de cerrajería";
    } else if (ultimoMensajeBot.includes("barber") || ultimoMensajeBot.includes("belleza") || ultimoMensajeBot.includes("peluquer")) {
      ruta = "/mapa?categoria=belleza";
      catNombre = "de estética y barbería";
    } else if (ultimoMensajeBot.includes("comida") || ultimoMensajeBot.includes("almuerzo")) {
      ruta = "/mapa?categoria=comida";
      catNombre = "de comida casera";
    } else if (ultimoMensajeBot.includes("celular") || ultimoMensajeBot.includes("tecnolog")) {
      ruta = "/mapa?categoria=tecnologia";
      catNombre = "de reparación técnica";
    }

    const detalle = catNombre ? `los talleres ${catNombre}` : "los talleres, modisterías y cerrajerías";

    return {
      mensaje: `¡Con gusto, vecino! En el mapa comunal interactivo puedes ubicar ${detalle} geolocalizados cerca de tu barrio. Toca el botón para abrir el mapa directamente:`,
      tipo: "navegacion",
      rutaNavegacion: ruta,
      sugerencias: ["Oficios cerca de mí", "🔑 Cerrajería urgente", "Buscar otro oficio"],
    };
  }

  // 2. Navegación a explorar oficios / buscar otro oficio
  if (
    texto.includes("buscar otro oficio") ||
    texto.includes("explorar oficios") ||
    texto.includes("ver categorías") ||
    texto.includes("ver categorias") ||
    texto.includes("otro oficio")
  ) {
    return {
      mensaje: `En nuestra comuna encuentras modistas, cerrajeros, zapateros, técnicos de celular, barberías y comida casera. Puedes tocar una categoría o explorar el directorio completo:`,
      tipo: "navegacion",
      rutaNavegacion: "/explorar",
      sugerencias: ["👗 Costura y modistería", "🔑 Cerrajería", "💇 Barbería y estética", "📱 Reparación de celulares"],
    };
  }

  // 3. ¿Cómo pedir un servicio?
  if (
    texto.includes("cómo pedir") ||
    texto.includes("como pedir") ||
    texto.includes("cómo contratar") ||
    texto.includes("como contratar") ||
    texto.includes("pedir un servicio")
  ) {
    return {
      mensaje: `Pedir un servicio en ConectaComuna es directo y seguro:\n1. 🔍 Buscas el oficio que necesitas (por cercanía o categoría).\n2. 💬 Tocas el botón verde de WhatsApp para acordar directamente con el emprendedor.\n3. 🛡️ Si el trabajo requiere compra previa de repuestos o materiales, recuerden pactar el Trato Seguro: anticipo máximo del 50% con comprobante oficial.`,
      tipo: "conversacion",
      sugerencias: ["¿Cómo funciona el Trato Seguro?", "Ver oficios cercanos", "Ver en el mapa"],
    };
  }

  // 4. Registro de nuevo negocio / Crear perfil (Con puerta lógica de confirmación)
  if (
    texto.includes("crear perfil") ||
    texto.includes("crear negocio") ||
    texto.includes("cómo me registro") ||
    texto.includes("como me registro") ||
    texto.includes("registrar mi negocio") ||
    texto.includes("cómo publicar") ||
    texto.includes("como publicar") ||
    texto.includes("publicar mi servicio") ||
    texto.includes("publicar servicio") ||
    texto.includes("quiero vender") ||
    texto.includes("quiero ofrecer")
  ) {
    if (esAutenticado && tieneNegocio) {
      return {
        mensaje: `¡Hola ${nombreUsuario}! Ya tienes registrado tu taller "${nombreNegocio}". Puedes dictarme un nuevo servicio para agregarlo a tu catálogo o ir a tu panel para editar tus datos:`,
        tipo: "conversacion",
        sugerencias: ["🎙️ Dictar mi servicio para el catálogo", "Ir al panel de mi negocio", "Ver en el mapa"],
      };
    }

    if (esAutenticado && esEmprendedor && !tieneNegocio) {
      return {
        mensaje: `¡Hola ${nombreUsuario}! Tu cuenta ya está en modo Emprendedor. Solo te falta completar la ficha de tu taller (nombre, oficio y contacto) para que aparezcas en el directorio comunal.`,
        tipo: "navegacion",
        rutaNavegacion: "/panel/negocio",
        sugerencias: ["Completar ficha de mi taller", "🎙️ Dictar mi servicio para el catálogo"],
      };
    }

    if (esAutenticado && esCliente) {
      return {
        mensaje: `Hola ${nombreUsuario}, actualmente tu cuenta está registrada como **Cliente**. Para publicar tus servicios y tener tu taller visible en el mapa barrial, activaremos tu perfil como **Emprendedor** (podrás seguir pidiendo servicios a otros vecinos normalmente).\n\n¿Deseas activar tu perfil de negocio ahora?`,
        tipo: "confirmacion_accion",
        accionPendiente: {
          tipo: "activar_negocio",
          titulo: "Activar perfil de Emprendedor",
          descripcion: "Permite publicar tu oficio, definir tarifas y recibir pedidos de la comuna.",
          botonConfirmar: "✅ Sí, activar mi negocio",
          botonCancelar: "❌ No por ahora",
        },
        sugerencias: ["✅ Sí, activar mi negocio", "❌ No por ahora"],
      };
    }

    return {
      mensaje: `¡Publicar tu oficio es 100% gratuito y toma menos de 2 minutos! Como aún no has iniciado sesión en ConectaComuna, toca el botón para crear tu cuenta vecinal:`,
      tipo: "navegacion",
      rutaNavegacion: "/registro?tipo=business",
      sugerencias: ["¿Qué necesito para registrarme?", "🎙️ Dictar mi servicio para el catálogo", "¿Qué es el facilitador?"],
    };
  }

  // 4b. Navegación al panel del negocio
  if (
    texto === "ir al panel de mi negocio" ||
    texto === "ver mi panel de negocio" ||
    texto === "mi panel" ||
    texto === "ver mi negocio"
  ) {
    return {
      mensaje: `¡Con gusto, ${nombreUsuario}! Aquí puedes gestionar tus pedidos, ver tus calificaciones, vincular a tu facilitador y editar la información de tu taller:`,
      tipo: "navegacion",
      rutaNavegacion: "/panel",
      sugerencias: ["🎙️ Dictar mi servicio para el catálogo", "Ver en el mapa", "¿Cómo funciona el Trato Seguro?"],
    };
  }

  // 5. ¿Qué necesito para registrarme?
  if (texto.includes("qué necesito") || texto.includes("que necesito") || texto.includes("requisitos")) {
    return {
      mensaje: `Para publicar tu oficio solo necesitas:\n• El nombre de tu taller u oficio.\n• Tu número de WhatsApp de contacto.\n• Tu barrio en la comuna (o dirección aproximada).\n• Si tienes fotos de tus trabajos, ¡mucho mejor! Y si no sabes cómo subirlas, un Facilitador Comunitario te apoya en persona.`,
      tipo: "conversacion",
      sugerencias: ["Crear negocio para publicar", "¿Qué es el facilitador?", "Ver en el mapa"],
    };
  }

  // 6. Petición para aprender a dictar o iniciar el dictado (NO crea servicio falso)
  const esPeticionDictado =
    texto.includes("dictar mi servicio") ||
    texto.includes("cómo dicto") ||
    texto.includes("como dicto") ||
    texto.includes("quiero dictar") ||
    texto.includes("dictar un servicio") ||
    texto.includes("dictar servicio");

  if (esPeticionDictado) {
    return {
      mensaje: `¡Listo vecino! Estoy listo para escucharte. Puedes tocar el botón del micrófono 🎙️ que está aquí abajo o escribirme en una sola frase qué haces y cuánto cobras.\n\nPor ejemplo:\n• "Hago confección de vestidos y arreglos de costura a 25 mil pesos"\n• "Cambio guardas, chapas y candados a domicilio a 30 mil"\n• "Corte de cabello para caballero y barbería a 18 mil"\n\n¿Qué oficio o servicio quieres registrar hoy?`,
      tipo: "conversacion",
      sugerencias: [
        "Hago arreglos de ropa a $15.000",
        "Cambio cerraduras a $30.000",
        "Corte de cabello a $18.000",
      ],
    };
  }

  // 7. Intención de cambiar el precio
  const esPeticionCambiarPrecio =
    texto === "cambiar el precio" ||
    texto.includes("cambiar el precio") ||
    texto.includes("cambiar precio") ||
    texto.includes("modificar precio") ||
    texto.includes("ajustar precio") ||
    texto.includes("otro precio") ||
    texto.includes("cambiar valor");

  if (esPeticionCambiarPrecio) {
    return {
      mensaje: `¿A qué valor deseas cambiar el precio de tu servicio? Dime el nuevo monto (por ejemplo: "30 mil pesos") o toca uno de los valores rápidos:`,
      tipo: "conversacion",
      sugerencias: ["$15.000", "$20.000", "$30.000", "$40.000"],
    };
  }

  // 8. Respuesta con un nuevo monto tras pedir cambio de precio
  const precioSoloMatch = texto.match(/\b(\d{1,3}(?:\.\d{3})*|\d+)\s*(?:mil|pesos|\$)?\b/);
  const contextoPrevioPidePrecio =
    ultimoMensajeBot.includes("precio") ||
    ultimoMensajeBot.includes("monto") ||
    ultimoMensajeBot.includes("valor") ||
    ultimoMensajeBot.includes("servicio identificado");

  if (precioSoloMatch && contextoPrevioPidePrecio && !texto.includes("vendo") && !texto.includes("hago")) {
    const num = parseInt(precioSoloMatch[1].replace(/\./g, ""), 10);
    const nuevoPrecio = num < 1000 ? num * 1000 : num;

    return {
      mensaje: `¡Precio actualizado a $${nuevoPrecio.toLocaleString("es-CO")} COP! He guardado este cambio en la ficha. Cuando quieras puedes guardarlo en tu catálogo:`,
      tipo: "servicio_catalogo",
      servicio: {
        titulo: "Servicio de oficio comunal",
        descripcion: "Tarifa ajustada según solicitud",
        precioSugerido: nuevoPrecio,
        categoria: "costura",
      },
      sugerencias: ["Guardar en mi catálogo", "Cambiar el precio", "¿Cómo funciona el anticipo?"],
    };
  }

  // 9. Guardar en catálogo
  const esPeticionGuardar =
    texto === "guardar en mi catálogo" ||
    texto === "guardar en mi catalogo" ||
    texto.includes("cómo guardo") ||
    texto.includes("como guardo") ||
    texto.includes("guardar en catalogo") ||
    texto.includes("guardar en catálogo");

  if (esPeticionGuardar) {
    return {
      mensaje: `Para publicar este servicio en la plataforma:\n1. Si ya tienes tu cuenta de negocio, solo toca el botón verde "Guardar directamente en mi catálogo" en la tarjeta superior y se registrará al instante.\n2. Si aún no te has registrado como emprendedor, toca el botón para crear tu perfil gratis en 1 minuto. Así tu taller quedará visible para todos los vecinos.`,
      tipo: "conversacion",
      sugerencias: ["Crear negocio para publicar", "Ver oficios cercanos", "¿Cómo funciona el Trato Seguro?"],
    };
  }

  // 10. Trato Seguro / Anticipo con validación lógica del 50% y generación de acuerdos
  if (
    texto.includes("trato seguro") ||
    texto.includes("anticipo") ||
    texto.includes("garantia") ||
    texto.includes("garantía") ||
    texto.includes("50%") ||
    texto.includes("pactar") ||
    texto.includes("acuerdo") ||
    texto.includes("comprobante")
  ) {
    if (texto.includes("verificar") || texto.includes("código") || texto.includes("codigo")) {
      return {
        mensaje: `Puedes verificar la autenticidad de cualquier acuerdo vecinal escaneando su código QR o buscando su código oficial (por ejemplo CC-ORD-1). Aquí puedes consultar el comprobante en tiempo real:`,
        tipo: "navegacion",
        rutaNavegacion: "/trato-seguro/verificar",
        sugerencias: ["Verificar CC-ORD-1", "¿Cómo funciona el Trato Seguro?", "Ver oficios cercanos"],
      };
    }

    if (texto.includes("pactar") || texto.includes("hacer acuerdo") || texto.includes("crear acuerdo")) {
      const precioBase = 45000;
      const anticipoMax = 22500;
      return {
        mensaje: `¡Excelente iniciativa, ${nombreUsuario}! He estructurado la ficha de Pacto de Trato Seguro. Cumple con la regla comunal: máximo 50% de anticipo para materiales y saldo contra entrega a entera satisfacción:`,
        tipo: "acuerdo_trato_seguro",
        acuerdo: {
          codigo: "CC-ORD-1",
          servicio: "Servicio de oficio comunal acordado",
          negocioNombre: "Taller Comunitario",
          precioEstimado: precioBase,
          anticipoMaximo: anticipoMax,
          saldoContraEntrega: precioBase - anticipoMax,
          modalidad: "workshop",
        },
        sugerencias: ["Verificar comprobante oficial", "¿Qué pasa si hay un desacuerdo?", "Ver en el mapa"],
      };
    }

    const matchPorcentaje = texto.match(/(\d{2,3})\s*%/);
    if (matchPorcentaje && parseInt(matchPorcentaje[1], 10) > 50) {
      const pct = matchPorcentaje[1];
      return {
        mensaje: `Vecino, por las reglas de Trato Seguro Comunal, ningún anticipo para compra de repuestos o materiales puede superar el 50% (pediste un ${pct}%). Este límite protege tu dinero y garantiza el cumplimiento del artesano.\n\n¿Deseas que preparemos el acuerdo con el 50% máximo permitido?`,
        tipo: "conversacion",
        sugerencias: ["Sí, con el 50%", "¿Cómo funciona el Trato Seguro?", "Ver oficios cercanos"],
      };
    }

    return {
      mensaje: `¡Hola vecino! El Trato Seguro Comunal es el pacto de confianza de nuestro barrio:\n1. 🛡️ Ningún anticipo para compra de materiales puede superar el 50% del total acordado.\n2. 🧾 Todo queda registrado por escrito con código de verificación oficial y código QR escaneable.\n3. 🤝 Si surge algún desacuerdo, cuentas con el respaldo de mediación comunitaria de la Junta de Acción Comunal (JAC) antes de cualquier conflicto.`,
      tipo: "acuerdo_trato_seguro",
      acuerdo: {
        codigo: "CC-ORD-1",
        servicio: "Servicio de mantenimiento y arreglo",
        negocioNombre: "Taller Comunal",
        precioEstimado: 45000,
        anticipoMaximo: 22500,
        saldoContraEntrega: 22500,
        modalidad: "workshop",
      },
      sugerencias: ["Verificar comprobante oficial", "¿Qué pasa si hay un desacuerdo?", "Ver en el mapa"],
    };
  }

  // 11. Desacuerdos / Mediación
  if (
    texto.includes("desacuerdo") ||
    texto.includes("problema") ||
    texto.includes("mediación") ||
    texto.includes("mediacion")
  ) {
    return {
      mensaje: `Si surge algún inconveniente o retraso con un trabajo, ConectaComuna promueve la mediación comunitaria a través de los líderes de la Junta de Acción Comunal (JAC) y los facilitadores del barrio, buscando siempre un acuerdo amistoso y justo.`,
      tipo: "conversacion",
      sugerencias: ["¿Cómo funciona el Trato Seguro?", "¿Qué es el facilitador?", "Ver oficios cercanos"],
    };
  }

  // 12. Facilitador Comunitario
  if (
    texto.includes("facilitador") ||
    texto.includes("apadrinar") ||
    texto.includes("nieto") ||
    texto.includes("ayuda digital") ||
    texto.includes("adulto mayor")
  ) {
    return {
      mensaje: `El Facilitador Comunitario es un familiar o vecino joven de confianza que apoya a los adultos mayores o artesanos a gestionar su catálogo y fotos. En el panel de negocio encuentras un código de 6 letras para vincularlo de inmediato.`,
      tipo: "conversacion",
      sugerencias: ["Crear negocio para publicar", "¿Cómo funciona el Trato Seguro?", "Ver oficios cercanos"],
    };
  }

  // 13. Dictado real de un oficio
  const contieneAccionOficio =
    texto.includes("vendo") ||
    texto.includes("hago") ||
    texto.includes("ofrezco") ||
    texto.includes("cobro") ||
    texto.includes("arreglo") ||
    texto.includes("reparo") ||
    texto.includes("confecciono") ||
    texto.includes("cambio chapas") ||
    texto.includes("corte de");

  const contieneOficioOMonto =
    texto.includes("vestido") ||
    texto.includes("pantalon") ||
    texto.includes("ropa") ||
    texto.includes("chapa") ||
    texto.includes("llave") ||
    texto.includes("celular") ||
    texto.includes("corte") ||
    texto.includes("comida") ||
    texto.includes("pesos") ||
    texto.includes("mil") ||
    texto.includes("$");

  if (contieneAccionOficio && contieneOficioOMonto && !esPeticionDictado) {
    let precio = 20000;
    if (precioSoloMatch) {
      const num = parseInt(precioSoloMatch[1].replace(/\./g, ""), 10);
      precio = num < 1000 ? num * 1000 : num;
    }

    let categoria = "otros";
    let titulo = "Servicio de oficio comunal";

    if (
      texto.includes("vestido") ||
      texto.includes("ropa") ||
      texto.includes("pantalon") ||
      texto.includes("confecci") ||
      texto.includes("costura") ||
      texto.includes("dobladillo")
    ) {
      categoria = "costura";
      titulo = "Confección y arreglo de prendas";
    } else if (texto.includes("chapa") || texto.includes("llave") || texto.includes("candado") || texto.includes("cerradura")) {
      categoria = "cerrajeria";
      titulo = "Servicio de cerrajería y aperturas";
    } else if (texto.includes("celular") || texto.includes("pantalla") || texto.includes("computador") || texto.includes("tecnolog")) {
      categoria = "tecnologia";
      titulo = "Mantenimiento y arreglo técnico";
    } else if (texto.includes("barber") || texto.includes("corte") || texto.includes("unas") || texto.includes("uñas") || texto.includes("manicure")) {
      categoria = "belleza";
      titulo = "Cuidado personal y estética barrial";
    } else if (texto.includes("comida") || texto.includes("almuerzo") || texto.includes("empanada")) {
      categoria = "comida";
      titulo = "Preparación de alimentos caseros";
    }

    if (esAutenticado && tieneNegocio) {
      return {
        mensaje: `¡Qué buen oficio! He estructurado este servicio para tu negocio "${nombreNegocio}". Revisa los datos y puedes guardarlo de verdad en tu catálogo con un toque:`,
        tipo: "servicio_catalogo",
        servicio: {
          titulo,
          descripcion: mensaje,
          precioSugerido: precio,
          categoria,
        },
        sugerencias: ["Guardar en mi catálogo", "Cambiar el precio", "¿Cómo funciona el anticipo?"],
      };
    }

    if (esAutenticado && esCliente) {
      return {
        mensaje: `¡Excelente servicio, ${nombreUsuario}! He estructurado tu tarifa a ${precio.toLocaleString("es-CO")} COP. Para poder publicarlo en el catálogo vecinal, primero debemos activar tu perfil de Emprendedor. ¿Deseas activarlo ahora?`,
        tipo: "confirmacion_accion",
        accionPendiente: {
          tipo: "activar_negocio",
          titulo: "Activar perfil de Emprendedor",
          descripcion: `Para publicar "${titulo}" en el directorio comunal.`,
          botonConfirmar: "✅ Sí, activar mi negocio",
          botonCancelar: "❌ No por ahora",
        },
        sugerencias: ["✅ Sí, activar mi negocio", "❌ No por ahora"],
      };
    }

    return {
      mensaje: `¡Qué buen oficio! He estructurado tu servicio para los vecinos de ${descUbi.enBarrio}. Revisa los datos y puedes guardarlo en tu catálogo creando tu negocio:`,
      tipo: "servicio_catalogo",
      servicio: {
        titulo,
        descripcion: mensaje,
        precioSugerido: precio,
        categoria,
      },
      sugerencias: ["Crear negocio para publicar", "Cambiar el precio", "¿Cómo funciona el anticipo?"],
    };
  }

  // 14. Búsqueda explícita de negocios u oficios (o "Oficios cerca de mí")
  const esBusqueda =
    texto.includes("costura") ||
    texto.includes("modista") ||
    texto.includes("falda") ||
    texto.includes("pantalon") ||
    texto.includes("cerrajero") ||
    texto.includes("cerrajeria") ||
    texto.includes("chapa") ||
    texto.includes("llave") ||
    texto.includes("candado") ||
    texto.includes("barber") ||
    texto.includes("peluquer") ||
    texto.includes("corte") ||
    texto.includes("manicure") ||
    texto.includes("unas") ||
    texto.includes("uñas") ||
    texto.includes("comida") ||
    texto.includes("almuerzo") ||
    texto.includes("empanada") ||
    texto.includes("cholado") ||
    texto.includes("celular") ||
    texto.includes("computador") ||
    texto.includes("tecnologia") ||
    texto.includes("cerca") ||
    texto.includes("oficios") ||
    texto.includes("negocios") ||
    texto.includes("buscar") ||
    texto.includes("dónde encuentro") ||
    texto.includes("donde encuentro") ||
    texto.includes("quién arregla") ||
    texto.includes("quien arregla");

  if (esBusqueda) {
    let coincidencias = [];
    if (texto.includes("costura") || texto.includes("modista") || texto.includes("falda") || texto.includes("pantalon") || texto.includes("dobladillo")) {
      coincidencias = negociosConDistancia.filter((n) => n.category === "costura");
    } else if (texto.includes("chapa") || texto.includes("llave") || texto.includes("cerrajero") || texto.includes("candado")) {
      coincidencias = negociosConDistancia.filter((n) => n.category === "cerrajeria");
    } else if (texto.includes("barber") || texto.includes("corte") || texto.includes("peluquer") || texto.includes("unas") || texto.includes("uñas") || texto.includes("manicure")) {
      coincidencias = negociosConDistancia.filter((n) => n.category === "belleza" || n.category === "manicure");
    } else if (texto.includes("comida") || texto.includes("cholado") || texto.includes("almuerzo") || texto.includes("empanada")) {
      coincidencias = negociosConDistancia.filter((n) => n.category === "comida" || n.category === "ambulante");
    } else if (texto.includes("celular") || texto.includes("computador") || texto.includes("tecnologia") || texto.includes("reparaci")) {
      coincidencias = negociosConDistancia.filter((n) => n.category === "tecnologia");
    } else {
      coincidencias = negociosConDistancia.slice(0, 3);
    }

    if (coincidencias.length === 0) {
      coincidencias = negociosConDistancia.slice(0, 3);
    }

    const primerNegocio = coincidencias[0];
    const distTexto = primerNegocio?.distanciaMetros ? `(como ${primerNegocio.name} a unos ${primerNegocio.distanciaMetros} metros)` : "";

    return {
      mensaje: `Vecino, revisando los oficios ${descUbi.cercaDe}, te encontré estas opciones de confianza ${distTexto}:`,
      tipo: "negocios",
      negociosSugeridos: coincidencias.slice(0, 3).map((n) => ({
        id: n.id,
        nombre: n.name,
        categoria: n.category,
        barrio: n.neighborhood,
        whatsapp: n.whatsapp,
        distanciaMetros: n.distanciaMetros,
        verificado: n.verification_status === "verified",
      })),
      sugerencias: ["Ver en el mapa", "¿Cómo funciona el Trato Seguro?", "Buscar otro oficio"],
    };
  }

  // 15. Saludo o mensaje general (Orientación cálida)
  return {
    mensaje: `¡Hola vecino! Soy tu Asistente Comunal para ${descUbi.enBarrio}. Estoy aquí para ayudarte a:\n• 📍 Encontrar oficios de confianza cerca de tu ubicación actual.\n• 🎙️ Dictar y publicar tus servicios con la voz para tu catálogo.\n• 🛡️ Explicarte el Trato Seguro y las garantías vecinales.\n\n¿En qué te colaboro hoy?`,
    tipo: "conversacion",
    sugerencias: ["Oficios cerca de mí", "🎙️ Dictar mi servicio para el catálogo", "Ver en el mapa"],
  };
}

/**
 * Prompt del sistema con toda la base de conocimiento de ConectaComuna para Gemini.
 */
function construirPromptSistema(negocios, barrioUsuario, lat, lng, contexto = {}, tieneUbicacionExplicita = false) {
  const descUbi = describirUbicacion(barrioUsuario, tieneUbicacionExplicita);
  const esAutenticado = !!contexto?.autenticado;
  const nombreUsuario = contexto?.nombre || "vecino";
  const tipoCuenta = contexto?.tipoCuenta || (esAutenticado ? "client" : "anonimo");
  const tieneNegocio = !!contexto?.negocioPropio?.tieneNegocio;
  const nombreNegocio = contexto?.negocioPropio?.nombre || "Sin taller aún";
  const rutaActual = contexto?.pantallaActual?.ruta || "/";

  const pedidosActivos = Array.isArray(contexto?.pedidosActivos) ? contexto.pedidosActivos : [];
  const listaPedidos =
    pedidosActivos.length > 0
      ? pedidosActivos
          .map(
            (p) =>
              `- [Código: #${p.codigo}] Trabajo: "${p.titulo}" | Estado: ${p.estado} | Contraparte: ${p.contraparte} | Monto: $${p.monto} | Anticipo: $${p.anticipo || 0} | Rol: ${p.rol}`
          )
          .join('\n')
      : "No tiene pedidos ni pactos activos en este momento.";

  const listaNegocios = negocios
    .map(
      (n) =>
        `- [ID: ${n.id}] ${n.name} | Cat: ${n.category} | Barrio: ${n.neighborhood} | Wsp: ${n.whatsapp || "No"} | Verificado: ${n.verification_status === "verified" ? "Sí" : "No"}`
    )
    .join("\n");

  return `Eres el "Asistente Comunal de ConectaComuna", un copiloto barrial para los habitantes y micro-emprendedores de la Comuna en Cali, Colombia.
Tu tono es humano, cálido, respetuoso, solidario y sin tecnicismos ("vecino", "vecina", trato amable colombiano/caleño).

INFORMACIÓN DE UBICACIÓN DEL USUARIO:
${tieneUbicacionExplicita
  ? `- Ubicación activa del usuario: ${descUbi.enBarrio} (Coordenadas aprox: ${lat}, ${lng}).
- REGLA DE REDACCIÓN: Di siempre "${descUbi.cercaDe}" o "${descUbi.enBarrio}". Puedes indicar distancias relativas aproximadas.`
  : `- Ubicación activa del usuario: NO DEFINIDA (el usuario aún no ha indicado su barrio ni activado GPS).
- REGLA ESTRICTA DE UBICACIÓN NO DEFINIDA:
  1. JAMÁS asumas por defecto que el usuario está en Antonio Nariño ni en ningún barrio específico.
  2. Si el usuario pregunta "cuál es el comercio más cercano", "qué negocio me queda más cerca", "oficios cerca" o pregunta distancias:
     • Respóndele amablemente que aún no conoces en qué barrio de la comuna se encuentra para calcularle distancias precisas.
     • Invítalo a compartir su GPS o indicarte su barrio (por ejemplo: Antonio Nariño, El Rodeo, Nueva Floresta, Vallado).
     • Ofrécele los oficios recomendados de la comuna sin inventar distancias en metros.
     • En "sugerencias" pon siempre: ["📍 Usar mi ubicación actual", "Estoy en El Rodeo", "Estoy en Antonio Nariño", "Estoy en Nueva Floresta"].
  3. Si el usuario indica su barrio (ej: "Estoy en El Rodeo", "vivo en San Judas", "mi barrio es Nueva Floresta"):
     • Confírmale que has ubicado su zona en ese barrio.
     • Incluye en el JSON: "ubicacionDetectada": { "barrio": "NombreDelBarrio", "lat": 3.4..., "lng": -76.5... }.
     • Prioriza los negocios recomendados según cercanía a ese barrio.`}
- Estado de autenticación: ${esAutenticado ? "Usuario con sesión iniciada" : "Visitante anónimo (sin sesión)"}.
- Nombre del usuario: ${nombreUsuario}.
- Tipo de cuenta / Rol: ${tipoCuenta}.
- Negocio propio: ${tieneNegocio ? `Es dueño de "${nombreNegocio}"` : "No tiene negocio creado"}.
- Pantalla actual: ${rutaActual}.

PEDIDOS Y PACTOS ACTIVOS DEL USUARIO EN LA COMUNA:
${listaPedidos}

REGLAS ESTRICTAS DE CONTEXTO Y SEGURIDAD LÓGICA:
1. SI EL USUARIO YA ESTÁ AUTENTICADO:
   - JAMÁS lo envíes a /registro ni a crear cuenta nueva. Ya tiene cuenta.
   - Si su cuenta es "client" y dice que quiere crear o registrar un negocio o vender algo, NO lo conviertas en secreto: pídele confirmación explícita para activar su perfil como Emprendedor usando tipo: "confirmacion_accion".
   - Si su cuenta es "business" y no tiene ficha de taller, guíalo a /panel/negocio.
   - Si ya tiene negocio ("${nombreNegocio}"), háblale como dueño de ese taller.
2. VISITANTE ANÓNIMO:
   - Solo a quien no ha iniciado sesión se le sugiere ir a /registro?tipo=business o /entrar.
3. TRATO SEGURO Y PACTOS VECINALES:
   - El anticipo máximo legal es del 50%. Si alguien solicita más, corrígelo con amabilidad.
   - Si el usuario pregunta por sus pedidos, acuerdos o cómo va su trabajo, respóndele con los datos REALES de la lista de pedidos de arriba con su código (#CC-...) y estado actual.
   - Si el usuario menciona un código de verificación (como CC-93E416) o pide verificar un pacto, bríndale la información y asigna siempre "tipo": "navegacion" y "rutaNavegacion": "/trato-seguro/verificar/" + codigo.
4. REGLA ESTRICTA DE FORMATO:
   - Redacta siempre en texto limpio, cercano y natural. NO uses asteriscos (** ni *) para resaltar palabras; usa mayúsculas iniciales, comillas o viñetas limpias (•).

REGLAS DE INTERACCIÓN Y COMPORTAMIENTO:
1. NAVEGACIÓN Y MAPA:
   - Si el usuario dice "Ver en el mapa", "abrir mapa" o "mapa", responde con entusiasmo explicando que puede ver los oficios en el mapa comunal interactivo, usa tipo: "navegacion" y rutaNavegacion: "/mapa".
   - Si el usuario dice "Buscar otro oficio" o "Explorar", usa tipo: "navegacion" y rutaNavegacion: "/explorar".
   - Si el usuario dice "Crear perfil" o "Publicar mi servicio", usa tipo: "navegacion" y rutaNavegacion: "/registro?tipo=business".
2. DICTADO DE SERVICIOS:
   - Si el usuario dice "dictar mi servicio" o pregunta cómo dictar, NO crees una tarjeta de servicio falsa. Explícale con entusiasmo que toque el botón del micrófono o escriba qué hace y cuánto cobra, y dale 2 ejemplos claros.
   - Solo genera tipo: "servicio_catalogo" cuando el usuario REALMENTE describa su oficio o producto con detalles y precio.
3. CAMBIO DE PRECIO:
   - Si el usuario dice "Cambiar el precio", NO recomiendes negocios. Pregúntale a qué nuevo valor desea ajustarlo.
   - Si el usuario responde con un número o precio, actualiza el servicio con el nuevo precio y devuelve tipo: "servicio_catalogo".
4. TRATO SEGURO COMUNAL:
   - Los anticipos para materiales o repuestos NUNCA pueden superar el 50% del total acordado. Todo queda registrado con código de comprobante oficial y mediación comunitaria.
5. BÚSQUEDA DE OFICIOS:
   - Recomienda negocios existentes de la lista priorizando cercanía solo cuando el usuario busque un oficio o pregunte qué hay cerca.

NEGOCIOS ACTIVOS EN LA COMUNA:
${listaNegocios}

INSTRUCCIONES DE RESPUESTA:
Debes responder SIEMPRE un único objeto JSON válido con la siguiente estructura exacta:
{
  "mensaje": "Texto de tu respuesta en tono cálido y empático.",
  "tipo": "conversacion" | "negocios" | "servicio_catalogo" | "acuerdo_trato_seguro" | "navegacion",
  "negociosSugeridos": [
    { "id": "uuid-del-negocio", "nombre": "Nombre", "categoria": "cat", "barrio": "Barrio", "whatsapp": "numero" }
  ],
  "servicio": {
    "titulo": "Título claro del servicio",
    "descripcion": "Descripción vendedora y sencilla",
    "precioSugerido": 25000,
    "categoria": "costura"
  },
  "rutaNavegacion": "/mapa" | "/explorar" | "/registro?tipo=business",
  "sugerencias": ["Opción 1 para tocar", "Opción 2"]
}`;
}

/**
 * POST /api/ai/chat
 * Endpoint principal de conversación con el Asistente Comunal
 */
ruta.post("/chat", async (req, res) => {
  const { mensaje, historial = [], ubicacion, contexto } = req.body;

  if (!mensaje || typeof mensaje !== "string" || !mensaje.trim()) {
    return res.status(400).json({ error: "El mensaje es obligatorio." });
  }

  const barrioDetectado = detectarBarrioEnTexto(mensaje);
  const tieneUbicacionExplicita = !!(
    barrioDetectado ||
    (ubicacion && ubicacion.esDefinida !== false && ubicacion.barrio && ubicacion.barrio !== "Comuna" && ubicacion.barrio !== "Cali")
  );

  const barrioUsuario = barrioDetectado?.barrio || (tieneUbicacionExplicita ? ubicacion?.barrio : null);
  const lat = barrioDetectado?.lat || (tieneUbicacionExplicita && ubicacion?.lat ? Number(ubicacion.lat) : null);
  const lng = barrioDetectado?.lng || (tieneUbicacionExplicita && ubicacion?.lng ? Number(ubicacion.lng) : null);

  // Consultar negocios reales
  const negocios = await obtenerNegociosComuna();

  // Si no se proporcionaron pedidos activos y el usuario está autenticado, cargarlos de Supabase
  if (contexto && (contexto.userId || contexto?.negocioPropio?.id) && (!contexto.pedidosActivos || contexto.pedidosActivos.length === 0)) {
    const pedidosCargados = await obtenerPedidosUsuario(contexto.userId, contexto?.negocioPropio?.id);
    contexto.pedidosActivos = pedidosCargados;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const textoLimpio = mensaje.toLowerCase().trim();

  const matchCodigoDirecto = /\b(CC-[A-Z0-9]{4,10})\b/i.test(textoLimpio);
  const esConsultaPedidosDirecta =
    textoLimpio.includes("mis pedidos") ||
    textoLimpio.includes("mi pedido") ||
    textoLimpio.includes("mis acuerdos") ||
    textoLimpio.includes("mis tratos") ||
    textoLimpio.includes("mis pactos") ||
    textoLimpio.includes("cómo va mi") ||
    textoLimpio.includes("como va mi") ||
    textoLimpio.includes("estado de mi") ||
    textoLimpio.includes("trabajos en curso");

  // Intenciones de acción directa (botones y navegación)
  // Se atienden con el motor local para respuesta inmediata (<5ms) y cero errores
  const esPreguntaCercaniaDirecta =
    textoLimpio.includes("más cercano") ||
    textoLimpio.includes("mas cercano") ||
    textoLimpio.includes("cerca de mí") ||
    textoLimpio.includes("cerca de mi") ||
    textoLimpio.includes("más cerca") ||
    textoLimpio.includes("mas cerca") ||
    textoLimpio === "oficios cerca" ||
    textoLimpio === "oficios cercanos" ||
    textoLimpio.includes("comercio más cercano") ||
    textoLimpio.includes("comercio mas cercano");

  const esFijarBarrioDirecto = !!(
    barrioDetectado &&
    (textoLimpio.includes("estoy") || textoLimpio.includes("vivo") || textoLimpio.includes("barrio") || textoLimpio.startsWith("en ") || textoLimpio === barrioDetectado.barrio.toLowerCase())
  );

  const esIntencionDirecta =
    matchCodigoDirecto ||
    esConsultaPedidosDirecta ||
    esFijarBarrioDirecto ||
    (esPreguntaCercaniaDirecta && !tieneUbicacionExplicita) ||
    textoLimpio === "ver en el mapa" ||
    textoLimpio.includes("en el mapa") ||
    textoLimpio === "buscar otro oficio" ||
    textoLimpio === "explorar oficios" ||
    textoLimpio.includes("crear perfil") ||
    textoLimpio.includes("crear negocio") ||
    textoLimpio.includes("publicar mi servicio") ||
    textoLimpio.includes("publicar servicio") ||
    textoLimpio.includes("registrar mi negocio") ||
    textoLimpio.includes("quiero vender") ||
    textoLimpio.includes("quiero ofrecer") ||
    textoLimpio === "sí, activar mi negocio" ||
    textoLimpio === "si, activar mi negocio" ||
    textoLimpio === "no por ahora" ||
    textoLimpio === "no, mantener como cliente" ||
    textoLimpio === "ir al panel de mi negocio" ||
    textoLimpio === "ver mi panel de negocio" ||
    textoLimpio === "mi panel" ||
    textoLimpio.includes("dictar mi servicio") ||
    textoLimpio === "cambiar el precio" ||
    textoLimpio === "guardar en mi catálogo" ||
    textoLimpio === "guardar en mi catalogo" ||
    /^\$?(\d{1,3}(\.\d{3})*|\d+)\s*(?:mil|pesos)?$/i.test(textoLimpio) ||
    textoLimpio.includes("trato seguro") ||
    textoLimpio.includes("facilitador");

  if (!apiKey || esIntencionDirecta) {
    const respuestaLocal = motorRespaldoLocal(
      mensaje,
      { barrio: barrioUsuario, lat, lng, esDefinida: tieneUbicacionExplicita },
      negocios,
      historial,
      contexto
    );
    return res.json(respuestaLocal);
  }

  // Para consultas abiertas o conversación natural, usar Gemini 3.5 Flash
  try {
    const promptSistema = construirPromptSistema(negocios, barrioUsuario, lat, lng, contexto, tieneUbicacionExplicita);

    const contenidos = [];
    const historialFiltrado = historial.slice(-6);
    for (const h of historialFiltrado) {
      contenidos.push({
        role: h.rol === "user" ? "user" : "model",
        parts: [{ text: h.texto }],
      });
    }
    contenidos.push({
      role: "user",
      parts: [{ text: mensaje }],
    });

    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    let respuestaHttp = await fetch(urlGemini, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: promptSistema }],
        },
        contents: contenidos,
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    // Fallback rápido a 3.5-flash-lite si 3.5-flash está sobrecargado
    if (!respuestaHttp.ok) {
      console.warn("Gemini 3.5-flash status:", respuestaHttp.status, "Probando gemini-3.5-flash-lite...");
      const urlLite = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;
      respuestaHttp = await fetch(urlLite, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: promptSistema }],
          },
          contents: contenidos,
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      });
    }

    if (!respuestaHttp.ok) {
      console.warn("Gemini API respondió status:", respuestaHttp.status, "Usando motor de respaldo.");
      const fallback = motorRespaldoLocal(
        mensaje,
        { barrio: barrioUsuario, lat, lng },
        negocios,
        historial,
        contexto
      );
      return res.json(fallback);
    }

    const jsonGemini = await respuestaHttp.json();
    const textoRespuesta = jsonGemini?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textoRespuesta) {
      const fallback = motorRespaldoLocal(
        mensaje,
        { barrio: barrioUsuario, lat, lng },
        negocios,
        historial,
        contexto
      );
      return res.json(fallback);
    }

    const parsed = JSON.parse(textoRespuesta);
    return res.json(parsed);
  } catch (err) {
    console.error("Error al comunicarse con Gemini:", err.message);
    const fallback = motorRespaldoLocal(
      mensaje,
      { barrio: barrioUsuario, lat, lng },
      negocios,
      historial
    );
    return res.json(fallback);
  }
});

export default ruta;
