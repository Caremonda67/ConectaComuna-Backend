import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { envolver } from "../middleware/errores.js";

const ruta = Router();

// Límite por IP para el asistente. Cada mensaje abierto se traduce en una
// llamada a Gemini, así que sin tope una pestaña olvidada quema la cuota del mes.
const mensajesPorIp = new Map();
const VENTANA_CHAT_MS = 10 * 60 * 1000;
const MAX_MENSAJES_VENTANA = 30;
const MAX_TEXTO_MENSAJE = 800;

// Cuando un modelo contesta 429 se queda fuera un rato. Sin esto, cada mensaje
// gasta dos llamadas fallidas antes de llegar al modelo que sí tiene cupo.
const modelosEnEspera = new Map();
const ESPERA_TRAS_429_MS = 10 * 60 * 1000;

function quedaDentroDelLimite(ip) {
  const ahora = Date.now();
  const recientes = (mensajesPorIp.get(ip) || []).filter((t) => ahora - t < VENTANA_CHAT_MS);

  if (recientes.length >= MAX_MENSAJES_VENTANA) {
    mensajesPorIp.set(ip, recientes);
    return false;
  }

  recientes.push(ahora);
  mensajesPorIp.set(ip, recientes);

  if (mensajesPorIp.size > 2000) {
    for (const [clave, marcas] of mensajesPorIp) {
      if (!marcas.some((t) => ahora - t < VENTANA_CHAT_MS)) mensajesPorIp.delete(clave);
    }
  }

  return true;
}

// La ubicación llega resuelta desde el cliente, que la obtiene del GPS o del
// geocodificador. Aquí no se adivina: el diccionario de barrios que había antes
// solo conocía ocho barrios de Cali y pisaba la ubicación real de quien
// escribía desde otra ciudad.

/**
 * Normaliza y describe la ubicación de forma humana para evitar frases como "en Mi ubicación".
 */
function describirUbicacion(barrio, esDefinida = true) {
  if (
    !esDefinida ||
    !barrio ||
    barrio === "Comuna" ||
    barrio.toLowerCase().includes("mi ubicación") ||
    barrio.toLowerCase().includes("mi ubicacion")
  ) {
    return {
      cercaDe: "en la zona",
      enBarrio: "tu zona",
      etiquetaCorta: "Comuna",
      esDefinida: false,
    };
  }

  const b = String(barrio).trim();
  const limpio = b.replace(/^barrio\s+/i, "");

  // Si es un punto en el mapa o coordenadas
  if (/^punto\s+/i.test(limpio) || /^\(?-?\d+\.\d+/.test(limpio)) {
    return {
      cercaDe: "cerca de este punto",
      enBarrio: "el punto marcado",
      etiquetaCorta: "Punto en el mapa",
      esDefinida: true,
    };
  }

  // Si tiene ciudad o coma (ej: "Quinta Paredes, Bogotá", "Junín, Cali", "El Poblado, Medellín")
  if (limpio.includes(",")) {
    return {
      cercaDe: `cerca de ${limpio}`,
      enBarrio: limpio,
      etiquetaCorta: limpio,
      esDefinida: true,
    };
  }

  // Si es un barrio tradicional
  return {
    cercaDe: `cerca del barrio ${limpio}`,
    enBarrio: `el barrio ${limpio}`,
    etiquetaCorta: limpio,
    esDefinida: true,
  };
}

/**
 * Calcula distancia aproximada en metros entre dos coordenadas (Haversine simple).
 */
export function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
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
      .order("created_at", { ascending: false })
      .limit(50);

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
 * Motor local inteligente y con memoria de contexto multi-turno.
 * Garantiza respuestas naturales y útiles para todas las sugerencias y flujos del sistema.
 */
function motorRespaldoLocal(mensaje, ubicacionUsuario, negocios, historial = [], contexto = {}) {
  const texto = mensaje.toLowerCase().trim();
  const tieneUbicacionExplicita = !!(
    ubicacionUsuario?.esDefinida && ubicacionUsuario?.barrio && ubicacionUsuario.barrio !== "Comuna"
  );

  const barrio = tieneUbicacionExplicita ? ubicacionUsuario?.barrio : null;
  const lat = tieneUbicacionExplicita ? ubicacionUsuario?.lat : null;
  const lng = tieneUbicacionExplicita ? ubicacionUsuario?.lng : null;
  const descUbi = describirUbicacion(barrio, tieneUbicacionExplicita);

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
      mensaje: `Vecino, todavía no sé dónde estás para calcularte distancias precisas. Puedes tocar el botón de ubicación o escribirme tu barrio con la ciudad, como "Estoy en El Rodeo, Cali" o "Estoy en Chapinero, Bogotá".\n\nMientras tanto, aquí tienes algunos de los oficios y talleres más recomendados de la comuna:`,
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
        "Estoy en El Rodeo, Cali",
        "Estoy en Chapinero, Bogotá",
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
        mensaje: `Cada acuerdo registrado tiene un código y un QR. Escanéalo o escríbelo en el verificador y te muestra el negocio, el estado del trabajo y cuánto quedó de anticipo:`,
        tipo: "navegacion",
        rutaNavegacion: "/trato-seguro/verificar",
        sugerencias: ["Ver un comprobante", "¿Cómo funciona el Trato Seguro?", "Ver oficios cercanos"],
      };
    }

    if (texto.includes("pactar") || texto.includes("hacer acuerdo") || texto.includes("crear acuerdo")) {
      return {
        mensaje: `El pacto se arma desde la ficha del negocio: eliges el oficio, acuerdan el precio y el anticipo no puede pasar del 50%. Cuando el negocio acepta, el pedido queda con su código y su QR.`,
        tipo: "navegacion",
        rutaNavegacion: "/trato-seguro",
        sugerencias: ["¿Cómo funciona el Trato Seguro?", "Ver oficios cercanos", "¿Qué pasa si hay un desacuerdo?"],
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
      mensaje: `El Trato Seguro Comunal es el pacto de confianza del barrio:\n1. Ningún anticipo para materiales pasa del 50% del total acordado.\n2. Todo queda por escrito, con código de verificación y QR.\n3. Si algo sale mal, reportas el caso desde la ficha del negocio y el equipo de Conecta Comuna lo revisa con las dos partes.\n\nEl pacto se crea desde la ficha del negocio, no desde este chat.`,
      tipo: "navegacion",
      rutaNavegacion: "/trato-seguro",
      sugerencias: ["Ver oficios cercanos", "¿Qué pasa si hay un desacuerdo?", "Ver en el mapa"],
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
      mensaje: `Si surge algún inconveniente o retraso con un trabajo, repórtalo desde la ficha del negocio. El equipo de Conecta Comuna revisa el caso con las dos partes y, si hace falta, pide a un facilitador del barrio que acompañe la conversación.`,
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
      mensaje: `El Facilitador Comunitario es un familiar o vecino de confianza que apoya a los adultos mayores o artesanos a gestionar su catálogo y fotos. En el panel de negocio encuentras un código de 8 caracteres para vincularlo.`,
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

  // 13b. Consulta directa de los talleres del piloto territorial en Cali
  const esPeticionPiloto =
    texto.includes("comercios del piloto") ||
    texto.includes("oficios del piloto") ||
    texto.includes("negocios del piloto") ||
    texto.includes("talleres del piloto") ||
    texto.includes("talleres piloto") ||
    texto.includes("piloto en cali") ||
    texto.includes("piloto de cali");

  if (esPeticionPiloto) {
    const destacados = negocios.slice(0, 3);
    return {
      mensaje: `¡Claro que sí, vecino! Aquí tienes los talleres de la fase piloto territorial en la Comuna de Cali. Puedes consultar sus oficios, coordinar directamente por WhatsApp o pactar con Trato Seguro:`,
      tipo: "negocios",
      negociosSugeridos: destacados.map((n) => ({
        id: n.id,
        nombre: n.name,
        categoria: n.category,
        barrio: n.neighborhood,
        whatsapp: n.whatsapp,
        distanciaMetros: null,
        verificado: n.verification_status === "verified",
      })),
      sugerencias: ["Ver en el mapa", "¿Cómo funciona el Trato Seguro?", "🎙️ Dictar mi servicio para el catálogo"],
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
    const estaLejos = primerNegocio?.distanciaMetros && primerNegocio.distanciaMetros > 35000;

    if (estaLejos) {
      return {
        mensaje: `Vecino, actualmente estás ubicado en ${descUbi.enBarrio}. Los talleres que tenemos registrados en la plataforma forman parte del piloto territorial en la Comuna de Cali (a unos ${Math.round(primerNegocio.distanciaMetros / 1000)} km de aquí). Puedes explorar los comercios del piloto de Cali para conocer el catálogo y probar el Trato Seguro, o dictarme un oficio para registrar tu taller en esta zona.`,
        tipo: "conversacion",
        sugerencias: ["Ver comercios del piloto (Cali)", "🎙️ Dictar mi servicio para el catálogo", "¿Cómo funciona el Trato Seguro?", "Ver en el mapa"],
      };
    }

    const distTexto =
      primerNegocio?.distanciaMetros !== null && primerNegocio?.distanciaMetros !== undefined
        ? primerNegocio.distanciaMetros < 1000
          ? `(como ${primerNegocio.name} a unos ${primerNegocio.distanciaMetros} metros)`
          : `(como ${primerNegocio.name} a unos ${(primerNegocio.distanciaMetros / 1000).toFixed(1)} km)`
        : "";

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

  // 15. Saludos o preguntas de cortesía
  const esSaludo =
    /^(hola|buen[ao]s? (d[ií]as?|tardes?|noches?)|qu[eé] tal|c[oó]mo est[aá]s?|saludos)/i.test(texto) ||
    texto === "hola" ||
    texto.startsWith("hola ") ||
    texto.includes("cómo estás") ||
    texto.includes("como estas");

  if (esSaludo) {
    return {
      mensaje: `¡Hola, vecino! Qué gusto saludarte. Por acá todo muy bien en la comuna, listos para colaborarte en lo que necesites hoy. ¿Buscas algún oficio de confianza o te ayudo con tu negocio?`,
      tipo: "conversacion",
      sugerencias: ["Oficios cerca de mí", "🎙️ Dictar mi servicio para el catálogo", "Ver en el mapa"],
    };
  }

  // 16. Capacidades y qué puede hacer
  const esPreguntaCapacidades =
    /qu[eé] puedes hacer|para qu[eé] sirves|c[oó]mo me puedes ayudar|qu[eé] funciones tienes|qu[eé] haces|en qu[eé] me puedes colaborar/i.test(texto);

  if (esPreguntaCapacidades) {
    return {
      mensaje: `¡Con mucho gusto, vecino! Como copiloto comunal de ConectaComuna, puedo colaborarte con:\n\n• 📍 Encontrar oficios de confianza: modistas, cerrajeros, barberías, comidas y arreglos cerca de ${descUbi.enBarrio}.\n• 🎙️ Dictar tus servicios por voz: si tienes un oficio y no tienes tiempo de escribir, me dices qué haces y cuánto cobras para armar tu catálogo.\n• 🛡️ Trato Seguro: acordar trabajos con la regla comunal del 50% de anticipo para compra de repuestos y saldo contra entrega.\n• 🗺️ Mapa de talleres: ubicar los emprendedores de la comuna en el mapa interactivo.\n\n¿Por cuál te gustaría empezar?`,
      tipo: "conversacion",
      sugerencias: ["Oficios cerca de mí", "🎙️ Dictar mi servicio para el catálogo", "🛡️ ¿Cómo funciona el Trato Seguro?", "Ver en el mapa"],
    };
  }

  // 17. Solicitud de ayuda general
  const esPedidoAyuda =
    /^(necesito ayuda|ayuda|ay[uú]dame|auxilio|no s[eé] qu[eé] hacer|no entiendo|orientaci[oó]n)/i.test(texto) ||
    texto === "necesito ayuda" ||
    texto === "ayuda";

  if (esPedidoAyuda) {
    return {
      mensaje: `¡Tranquilo, vecino! Aquí estamos para darte una mano. Cuéntame qué necesitas o elige una de estas opciones:\n\n1. 🔍 Buscar a alguien de confianza (costura, arreglo, cerrajería, comida).\n2. 🎙️ Publicar tu propio oficio o negocio en el catálogo comunal.\n3. 🛡️ Consultar el estado de tus pedidos o cómo funciona el Trato Seguro.\n\n¿Cuál de estas necesitas?`,
      tipo: "conversacion",
      sugerencias: ["Oficios cerca de mí", "🎙️ Dictar mi servicio para el catálogo", "¿Cómo funciona el Trato Seguro?"],
    };
  }

  // 18. Agradecimiento
  const esAgradecimiento =
    /^(gracias|muchas gracias|mil gracias|vale gracias|te lo agradezco|listo gracias|ok gracias)/i.test(texto) ||
    texto === "gracias" ||
    texto.startsWith("gracias ");

  if (esAgradecimiento) {
    return {
      mensaje: `¡Con el mayor de los gustos, vecino! Para eso estamos en la comuna: apoyarnos entre vecinos y mover los oficios de nuestro barrio. Si necesitas algo más, aquí estaré.`,
      tipo: "conversacion",
      sugerencias: ["Buscar otro oficio", "Ver en el mapa", "¿Cómo funciona el Trato Seguro?"],
    };
  }

  // 19. Pregunta de identidad
  const esPreguntaIdentidad =
    /qui[eé]n eres|quien eres|eres un robot|eres una ia|eres un bot/i.test(texto);

  if (esPreguntaIdentidad) {
    return {
      mensaje: `Soy el Asistente Comunal de ConectaComuna, tu copiloto barrial para los habitantes y artesanos de la comuna en Cali. Te ayudo a encontrar oficios cercanos, pactar trabajos seguros con el 50% de anticipo y publicar tus servicios con la voz.`,
      tipo: "conversacion",
      sugerencias: ["Oficios cerca de mí", "🎙️ Dictar mi servicio para el catálogo", "Ver en el mapa"],
    };
  }

  // 20. Mensaje conversacional de seguimiento (cuando ya hay historial)
  if (historial && historial.length > 0) {
    return {
      mensaje: `Te escucho con atención, vecino. Cuéntame un poco más de lo que necesitas (por ejemplo: el tipo de arreglo, oficio o duda que tengas) y con gusto te oriento de inmediato.`,
      tipo: "conversacion",
      sugerencias: ["Oficios cerca de mí", "🎙️ Dictar mi servicio para el catálogo", "Ver en el mapa"],
    };
  }

  // 21. Saludo inicial de bienvenida (solo cuando se inicia la conversación)
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
Tu tono es humano, cálido, respetuoso, solidario y sin tecnicismos (trato amable colombiano/caleño).
No conoces el género de quien escribe, así que nunca lo supongas: di "vecino" como trato neutro, o mejor el nombre de la persona si lo tienes en el contexto. Nada de "vecina", "bienvenido", "estás listo" ni adjetivos en femenino o masculino referidos a quien escribe.

INFORMACIÓN DE UBICACIÓN DEL USUARIO:
${tieneUbicacionExplicita
  ? `- Ubicación activa del usuario: ${descUbi.enBarrio} (Coordenadas aprox: ${lat}, ${lng}).
- REGLA DE REDACCIÓN: Di siempre "${descUbi.cercaDe}" o "${descUbi.enBarrio}". Puedes indicar distancias relativas aproximadas.`
  : `- Ubicación activa del usuario: NO DEFINIDA (el usuario aún no ha indicado su barrio ni activado GPS).
- REGLA ESTRICTA DE UBICACIÓN NO DEFINIDA:
  1. JAMÁS asumas por defecto que el usuario está en Antonio Nariño ni en ningún barrio específico.
  2. Si el usuario pregunta "cuál es el comercio más cercano", "qué negocio me queda más cerca", "oficios cerca" o pregunta distancias:
     • Respóndele amablemente que aún no sabes dónde está para calcularle distancias precisas.
     • Invítalo a compartir su GPS o a escribirle su barrio con la ciudad, porque la aplicación atiende cualquier lugar de Colombia. Da ejemplos de ciudades distintas (por ejemplo "Estoy en Chapinero, Bogotá" o "Estoy en El Rodeo, Cali"), nunca una lista de barrios de una sola ciudad.
     • Ofrécele los oficios recomendados de la comuna sin inventar distancias en metros.
     • En "sugerencias" pon: ["📍 Usar mi ubicación actual", "Escribir mi barrio y ciudad"].
  3. Si el usuario indica dónde está (ej: "Estoy en El Rodeo", "vivo en Chapinero, Bogotá", "mi barrio es Laureles"):
     • Confírmale que has ubicado su zona, repitiendo el lugar tal como él lo escribió.
     • JAMÁS inventes coordenadas ni devuelvas "ubicacionDetectada": la aplicación resuelve el lugar contra el mapa antes de llegar aquí. Inventar lat/lng movía a la persona de ciudad sin que lo pidiera.
     • Prioriza los negocios recomendados según cercanía a ese lugar.`}
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
   - El anticipo máximo que permite el Trato Seguro es del 50%. Si alguien solicita más, corrígelo con amabilidad.
   - Si el usuario pregunta por sus pedidos, acuerdos o cómo va su trabajo, respóndele con los datos REALES de la lista de pedidos de arriba con su código (#CC-...) y estado actual.
   - Si el usuario menciona un código de verificación, NO inventes su contenido: no tienes acceso a la tabla de pedidos. Dile que lo consulte en el verificador y ofrece el enlace con tipo "navegacion" y rutaNavegacion: "/trato-seguro/verificar/" + codigo, sin afirmar si el pacto existe.
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
   - NUNCA digas que ya guardaste, registraste o publicaste el servicio, ni que los vecinos ya pueden encontrarlo. La tarjeta es un borrador y solo queda publicado cuando la persona toca el botón. Di que así entendiste el oficio y el precio, y pídele que confirme.
   - Revisa "Negocio propio" en el contexto: si no tiene negocio creado, explícale en una frase sencilla que para publicarlo primero hay que crear su negocio, y que el botón de abajo lo lleva. Si ya tiene negocio, dile que confirme para agregarlo a su catálogo.
3. CAMBIO DE PRECIO:
   - Si el usuario dice "Cambiar el precio", NO recomiendes negocios. Pregúntale a qué nuevo valor desea ajustarlo.
   - Si el usuario responde con un número o precio, actualiza el servicio con el nuevo precio y devuelve tipo: "servicio_catalogo".
4. TRATO SEGURO COMUNAL:
   - Los anticipos para materiales o repuestos NUNCA pueden superar el 50% del total acordado. Todo queda registrado con un código de comprobante que cualquiera puede verificar. Si algo sale mal, el equipo de Conecta Comuna revisa el caso.
5. BÚSQUEDA DE OFICIOS:
   - Recomienda negocios existentes de la lista priorizando cercanía solo cuando el usuario busque un oficio o pregunte qué hay cerca.
6. CONTEXTO TERRITORIAL Y CIUDADES (CALI vs BOGOTÁ / OTRAS REGIONES):
   - ConectaComuna es un proyecto de inclusión y bienestar social cuyo piloto territorial inicial opera en la Comuna de Cali (barrios Nueva Floresta, El Rodeo, Antonio Nariño, Vallado, etc.).
   - Si la ubicación del usuario (${descUbi.enBarrio}) está fuera de Cali (por ejemplo en Bogotá, Medellín, Barranquilla, o si el usuario o jurado menciona Bogotá o Fedesoft):
     • Reconoce su ubicación real (${descUbi.enBarrio}) con respeto, calidez y naturalidad.
     • Explícale con amabilidad y orgullo que la plataforma está operando en su fase piloto territorial en la Comuna de Cali con talleres y artesanos reales comunitarios, por lo que en ${descUbi.enBarrio} aún no tenemos talleres en base de datos.
     • Resalta que la plataforma está diseñada para escalar modularmente a Bogotá y cualquier otra comuna de Colombia.
     • Invítalo a explorar los oficios del piloto de Cali con el botón "Ver comercios del piloto (Cali)" para comprobar cómo funciona el directorio y el Trato Seguro, o a dictar su propio oficio para registrarlo en su zona.
     • JAMÁS digas que un taller de Cali queda a 300 km "cerca de Bogotá" ni inventes talleres falsos en Bogotá.

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
 * Extrae y parsea un objeto JSON válido desde el texto generado por Gemini,
 * limpiando bloques markdown (```json ... ```) si es necesario.
 */
export function extraerJsonValido(texto) {
  if (!texto || typeof texto !== "string") return null;
  const textoLimpio = texto.trim();

  // Intento 1: Parseo directo
  try {
    return JSON.parse(textoLimpio);
  } catch {
    // Continuar
  }

  // Intento 2: Extraer contenido dentro de bloques ```json ... ``` o ``` ... ```
  const matchBloque = textoLimpio.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (matchBloque && matchBloque[1]) {
    try {
      return JSON.parse(matchBloque[1].trim());
    } catch {
      // Continuar
    }
  }

  // Intento 3: Encontrar llaves de objeto { ... }
  const inicio = textoLimpio.indexOf("{");
  const fin = textoLimpio.lastIndexOf("}");
  if (inicio !== -1 && fin > inicio) {
    try {
      return JSON.parse(textoLimpio.slice(inicio, fin + 1));
    } catch {
      // Continuar
    }
  }

  return null;
}

/**
 * POST /api/ai/chat
 * Endpoint principal de conversación con el Asistente Comunal
 */
ruta.post("/chat", envolver(async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "desconocido";
  if (!quedaDentroDelLimite(ip)) {
    return res.status(429).json({
      error: "Vas muy rápido. Descansa un momento y seguimos conversando.",
    });
  }

  const { mensaje, ubicacion, contexto } = req.body || {};
  const historial = (Array.isArray(req.body?.historial) ? req.body.historial : [])
    .slice(-10)
    .map((h) => ({
      rol: h?.rol === "user" ? "user" : "model",
      texto: typeof h?.texto === "string" ? h.texto.slice(0, 600) : "",
    }))
    .filter((h) => h.texto);

  if (!mensaje || typeof mensaje !== "string" || !mensaje.trim()) {
    return res.status(400).json({ error: "El mensaje es obligatorio." });
  }

  if (mensaje.length > MAX_TEXTO_MENSAJE) {
    return res.status(400).json({
      error: `El mensaje es muy largo. Cuéntame en menos de ${MAX_TEXTO_MENSAJE} caracteres.`,
    });
  }

  const tieneUbicacionExplicita = !!(
    ubicacion && ubicacion.esDefinida !== false && ubicacion.barrio && ubicacion.barrio !== "Comuna"
  );

  const barrioUsuario = tieneUbicacionExplicita ? ubicacion.barrio : null;
  const lat = tieneUbicacionExplicita && ubicacion.lat ? Number(ubicacion.lat) : null;
  const lng = tieneUbicacionExplicita && ubicacion.lng ? Number(ubicacion.lng) : null;

  // Consultar negocios reales
  const negocios = await obtenerNegociosComuna();

  const apiKey = process.env.GEMINI_API_KEY;
  const textoLimpio = mensaje.toLowerCase().trim();

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

  // Un saludo solo, sin pedido detrás, no merece gastar una llamada a Gemini.
  // "hola, busco un cerrajero" no entra aquí: ahí sí hay algo que entender.
  const esSaludoSuelto =
    /^(hola|holi|buen[ao]s|buenos d[ií]as|buenas tardes|buenas noches|qu[eé] tal|saludos|hey)[\s!.¡?¿]*$/i.test(
      textoLimpio
    );

  const esIntencionDirecta =
    esSaludoSuelto ||
    esConsultaPedidosDirecta ||
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

  // Para consultas abiertas o conversación natural, usar cascada de modelos Gemini (3.6 Flash -> 3.5 Flash -> 3.5 Flash Lite)
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

    const modelosCandidatos = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
    let parsedResultado = null;

    for (const modelo of modelosCandidatos) {
      if ((modelosEnEspera.get(modelo) || 0) > Date.now()) continue;

      try {
        const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${apiKey}`;
        const respuestaHttp = await fetch(urlGemini, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Tres modelos a 6 s caben en los 20 s que aguanta el navegador.
          // Antes eran 8 s y el cliente se rendía mientras el servidor seguía.
          signal: AbortSignal.timeout(6000),
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: promptSistema }],
            },
            contents: contenidos,
            generationConfig: {
              temperature: 0.25,
              responseMimeType: "application/json",
            },
          }),
        });

        if (!respuestaHttp.ok) {
          if (respuestaHttp.status === 429) {
            modelosEnEspera.set(modelo, Date.now() + ESPERA_TRAS_429_MS);
          }
          console.warn(`Gemini modelo ${modelo} respondió status: ${respuestaHttp.status}. Intentando siguiente...`);
          continue;
        }

        modelosEnEspera.delete(modelo);

        const jsonGemini = await respuestaHttp.json();
        const partConTexto = jsonGemini?.candidates?.[0]?.content?.parts?.find(
          (p) => typeof p.text === "string" && p.text.trim().length > 0
        );
        const textoRespuesta = partConTexto?.text || jsonGemini?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textoRespuesta) {
          continue;
        }

        const jsonExtraido = extraerJsonValido(textoRespuesta);
        if (jsonExtraido && jsonExtraido.mensaje) {
          parsedResultado = jsonExtraido;
          break;
        } else if (textoRespuesta.trim().length > 0) {
          // Gemini respondió texto plano conversacional
          parsedResultado = {
            mensaje: textoRespuesta.replace(/```(?:json)?/g, "").replace(/```/g, "").trim(),
            tipo: "conversacion",
            sugerencias: ["Oficios cerca de mí", "Ver en el mapa", "¿Cómo funciona el Trato Seguro?"],
          };
          break;
        }
      } catch (errModelo) {
        console.warn(`Error llamando a ${modelo}: ${errModelo.message}. Probando modelo de respaldo...`);
      }
    }

    if (parsedResultado) {
      return res.json(parsedResultado);
    }

    console.warn("Ningún modelo de Gemini respondió con éxito. Usando motor de respaldo local.");
    const fallback = motorRespaldoLocal(
      mensaje,
      { barrio: barrioUsuario, lat, lng, esDefinida: tieneUbicacionExplicita },
      negocios,
      historial,
      contexto
    );
    return res.json(fallback);
  } catch (err) {
    console.error("Error general al comunicarse con Gemini:", err.message);
    const fallback = motorRespaldoLocal(
      mensaje,
      { barrio: barrioUsuario, lat, lng, esDefinida: tieneUbicacionExplicita },
      negocios,
      historial,
      contexto
    );
    return res.json(fallback);
  }
}));

export default ruta;
