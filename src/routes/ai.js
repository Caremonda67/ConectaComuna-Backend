import { Router } from "express";
import claveSupabase from "../config/supabase.js";

const ruta = Router();

// Centro de referencia de la comuna (Cali) si el usuario no tiene ubicación definida
const CENTRO_COMUNA_DEFAULT = {
  lat: 3.4215,
  lng: -76.5120,
  barrio: "Antonio Nariño",
};

/**
 * Normaliza y describe la ubicación de forma humana para evitar frases como "en Mi ubicación".
 */
function describirUbicacion(barrio) {
  if (!barrio || barrio.toLowerCase().includes("ubicación") || barrio.toLowerCase().includes("ubicacion")) {
    return {
      cercaDe: "cerca de tu ubicación actual en la comuna",
      enBarrio: "tu zona en la comuna",
      etiquetaCorta: "Cerca de ti",
    };
  }
  return {
    cercaDe: `cerca del barrio ${barrio}`,
    enBarrio: `el barrio ${barrio}`,
    etiquetaCorta: `Barrio ${barrio}`,
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
 * Motor local inteligente y con memoria de contexto multi-turno.
 * Garantiza respuestas naturales y útiles para todas las sugerencias y flujos del sistema.
 */
function motorRespaldoLocal(mensaje, ubicacionUsuario, negocios, historial = []) {
  const texto = mensaje.toLowerCase().trim();
  const barrio = ubicacionUsuario?.barrio || CENTRO_COMUNA_DEFAULT.barrio;
  const lat = ubicacionUsuario?.lat || CENTRO_COMUNA_DEFAULT.lat;
  const lng = ubicacionUsuario?.lng || CENTRO_COMUNA_DEFAULT.lng;
  const descUbi = describirUbicacion(barrio);

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

  // 4. Registro de nuevo negocio / Crear perfil
  if (
    texto.includes("crear perfil") ||
    texto.includes("crear negocio") ||
    texto.includes("cómo me registro") ||
    texto.includes("como me registro") ||
    texto.includes("registrar mi negocio") ||
    texto.includes("cómo publicar") ||
    texto.includes("como publicar")
  ) {
    return {
      mensaje: `¡Publicar tu oficio es 100% gratuito y toma menos de 2 minutos! Así tus vecinos podrán encontrarte en el mapa y pedirte servicios por WhatsApp sin comisiones ni intermediarios.`,
      tipo: "navegacion",
      rutaNavegacion: "/registro?tipo=business",
      sugerencias: ["¿Qué necesito para registrarme?", "🎙️ Dictar mi servicio para el catálogo", "¿Qué es el facilitador?"],
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

  // 10. Trato Seguro / Anticipo
  if (
    texto.includes("trato seguro") ||
    texto.includes("anticipo") ||
    texto.includes("garantia") ||
    texto.includes("garantía") ||
    texto.includes("50%")
  ) {
    return {
      mensaje: `¡Hola vecino! El Trato Seguro Comunal es el pacto de confianza de nuestro barrio:\n1. Ningún anticipo para compra de materiales puede superar el 50% del total acordado.\n2. Todo queda registrado por escrito con código de verificación oficial.\n3. Si surge algún desacuerdo, cuentas con mediación vecinal comunitaria antes de cualquier conflicto.`,
      tipo: "conversacion",
      sugerencias: ["¿Cómo pedir un servicio?", "¿Qué pasa si hay un desacuerdo?", "Ver en el mapa"],
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

    return {
      mensaje: `¡Qué buen oficio! He estructurado tu servicio para los vecinos de ${descUbi.enBarrio}. Revisa los datos y puedes guardarlo en tu catálogo con un solo toque:`,
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
function construirPromptSistema(negocios, barrioUsuario, lat, lng) {
  const descUbi = describirUbicacion(barrioUsuario);
  const listaNegocios = negocios
    .map(
      (n) =>
        `- [ID: ${n.id}] ${n.name} | Cat: ${n.category} | Barrio: ${n.neighborhood} | Wsp: ${n.whatsapp || "No"} | Verificado: ${n.verification_status === "verified" ? "Sí" : "No"}`
    )
    .join("\n");

  return `Eres el "Asistente Comunal de ConectaComuna", un copiloto barrial para los habitantes y micro-emprendedores de la Comuna en Cali, Colombia.
Tu tono es humano, cálido, respetuoso, solidario y sin tecnicismos ("vecino", "vecina", trato amable colombiano/caleño).

INFORMACIÓN DEL USUARIO ACTUAL:
- Ubicación activa del usuario: ${descUbi.enBarrio} (Coordenadas aprox: ${lat}, ${lng}).
- REGLA ESTRICTA DE REDACCIÓN DE UBICACIÓN: NUNCA digas "en Mi ubicación" ni "en tu ubicación". En su lugar, di siempre "${descUbi.cercaDe}" o "${descUbi.enBarrio}".

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
  const { mensaje, historial = [], ubicacion } = req.body;

  if (!mensaje || typeof mensaje !== "string" || !mensaje.trim()) {
    return res.status(400).json({ error: "El mensaje es obligatorio." });
  }

  const barrioUsuario = ubicacion?.barrio || CENTRO_COMUNA_DEFAULT.barrio;
  const lat = ubicacion?.lat || CENTRO_COMUNA_DEFAULT.lat;
  const lng = ubicacion?.lng || CENTRO_COMUNA_DEFAULT.lng;

  // Consultar negocios reales
  const negocios = await obtenerNegociosComuna();

  const apiKey = process.env.GEMINI_API_KEY;
  const textoLimpio = mensaje.toLowerCase().trim();

  // Intenciones de acción directa (botones y navegación)
  // Se atienden con el motor local para respuesta inmediata (<5ms) y cero errores
  const esIntencionDirecta =
    textoLimpio === "ver en el mapa" ||
    textoLimpio.includes("en el mapa") ||
    textoLimpio === "buscar otro oficio" ||
    textoLimpio === "explorar oficios" ||
    textoLimpio === "crear perfil" ||
    textoLimpio === "crear negocio" ||
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
      { barrio: barrioUsuario, lat, lng },
      negocios,
      historial
    );
    return res.json(respuestaLocal);
  }

  // Para consultas abiertas o conversación natural, usar Gemini 3.5 Flash
  try {
    const promptSistema = construirPromptSistema(negocios, barrioUsuario, lat, lng);

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
        historial
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
        historial
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
