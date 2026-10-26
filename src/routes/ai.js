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
      .limit(20);

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
 * Motor de respaldo local en caso de que no haya API key de Gemini configurada
 * o falle la conexión exterior. Garantiza que la app nunca se rompa.
 */
function motorRespaldoLocal(mensaje, ubicacionUsuario, negocios) {
  const texto = mensaje.toLowerCase().trim();
  const barrio = ubicacionUsuario?.barrio || CENTRO_COMUNA_DEFAULT.barrio;
  const lat = ubicacionUsuario?.lat || CENTRO_COMUNA_DEFAULT.lat;
  const lng = ubicacionUsuario?.lng || CENTRO_COMUNA_DEFAULT.lng;

  // Filtrado de negocios con cálculo de distancia
  const negociosConDistancia = negocios.map((n) => ({
    ...n,
    distanciaMetros: calcularDistanciaMetros(lat, lng, n.lat, n.lng),
  })).sort((a, b) => (a.distanciaMetros || 999999) - (b.distanciaMetros || 999999));

  // 1. Duda de Trato Seguro
  if (texto.includes("trato seguro") || texto.includes("anticipo") || texto.includes("garantia")) {
    return {
      mensaje: `¡Hola vecino! El Trato Seguro Comunal es el pacto de confianza de nuestro barrio:
1. Ningún anticipo para materiales puede superar el 50% del total acordado.
2. Todo queda registrado por escrito con código de verificación.
3. Si surge algún desacuerdo, cuentas con mediación vecinal comunitaria antes de cualquier conflicto.`,
      tipo: "conversacion",
      sugerencias: ["¿Cómo pedir un servicio?", "¿Qué es el facilitador?", "Ver negocios cercanos"],
    };
  }

  // 2. Duda de Facilitador
  if (texto.includes("facilitador") || texto.includes("apadrinar") || texto.includes("nieto") || texto.includes("ayuda digital")) {
    return {
      mensaje: `El Facilitador Comunitario es un familiar o vecino joven de confianza que ayuda a los adultos mayores o artesanos a gestionar su catálogo y fotos. En el panel de negocio encuentras un código de 6 letras para vincularlo de inmediato.`,
      tipo: "conversacion",
      sugerencias: ["¿Cómo registrarme?", "¿Cómo funciona el Trato Seguro?"],
    };
  }

  // 3. Intención de publicar o dictar un servicio (Emprendedor)
  const esDictado =
    texto.includes("vendo") ||
    texto.includes("hago") ||
    texto.includes("ofrezco") ||
    texto.includes("cobro") ||
    texto.includes("publicar") ||
    texto.includes("mi servicio") ||
    texto.includes("mi catalogo") ||
    texto.includes("mi catálogo") ||
    texto.includes("dictar");

  if (esDictado) {
    const precioMatch = texto.match(/\b(\d{1,3}(?:\.\d{3})*|\d+)\s*(?:mil|pesos|\$)?\b/);
    let precio = 20000;
    if (precioMatch) {
      const num = parseInt(precioMatch[1].replace(/\./g, ""), 10);
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
    } else if (texto.includes("chapa") || texto.includes("llave") || texto.includes("candado")) {
      categoria = "cerrajeria";
      titulo = "Servicio de cerrajería y aperturas";
    } else if (texto.includes("celular") || texto.includes("pantalla") || texto.includes("computador") || texto.includes("tecnolog")) {
      categoria = "tecnologia";
      titulo = "Mantenimiento y arreglo técnico";
    } else if (texto.includes("barber") || texto.includes("corte") || texto.includes("unas") || texto.includes("manicure")) {
      categoria = "belleza";
      titulo = "Cuidado personal y estética barrial";
    }

    return {
      mensaje: `¡Qué buen oficio! He estructurado tu servicio para que los vecinos de ${barrio} se enteren de inmediato. Revisa los datos y puedes publicarlo con un solo toque:`,
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

  // 4. Búsqueda de negocios (por palabra clave de categoría)
  let coincidencias = [];
  if (texto.includes("costura") || texto.includes("falda") || texto.includes("pantalon") || texto.includes("dobladillo") || texto.includes("uniforme")) {
    coincidencias = negociosConDistancia.filter((n) => n.category === "costura");
  } else if (texto.includes("chapa") || texto.includes("llave") || texto.includes("cerrajero") || texto.includes("candado")) {
    coincidencias = negociosConDistancia.filter((n) => n.category === "cerrajeria");
  } else if (texto.includes("barber") || texto.includes("corte") || texto.includes("peluquer") || texto.includes("pelo") || texto.includes("unas") || texto.includes("manicure")) {
    coincidencias = negociosConDistancia.filter((n) => n.category === "belleza" || n.category === "manicure");
  } else if (texto.includes("comida") || texto.includes("cholado") || texto.includes("almuerzo") || texto.includes("empanada")) {
    coincidencias = negociosConDistancia.filter((n) => n.category === "comida" || n.category === "ambulante");
  } else if (texto.includes("arreglo") || texto.includes("tecnologia") || texto.includes("celular") || texto.includes("lavadora")) {
    coincidencias = negociosConDistancia.filter((n) => n.category === "tecnologia");
  } else {
    // Si no especifica oficio, sugerimos los más cercanos al barrio activo
    coincidencias = negociosConDistancia.slice(0, 3);
  }

  if (coincidencias.length > 0) {
    const primerNegocio = coincidencias[0];
    const distTexto = primerNegocio.distanciaMetros ? `a unos ${primerNegocio.distanciaMetros} metros` : `en ${primerNegocio.neighborhood || barrio}`;
    return {
      mensaje: `Vecino, tomando en cuenta que te encuentras en ${barrio}, te encontré estas opciones de confianza cerca de ti (como ${primerNegocio.name} ${distTexto}):`,
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

  // Respuesta general de orientación
  return {
    mensaje: `¡Hola vecino de ${barrio}! Soy tu Asistente Comunal. Puedo ayudarte a encontrar oficios de confianza cerca de tu casa, explicarte cómo te protege el Trato Seguro, o ayudarte a publicar tus propios servicios dictándomelos con tu voz. ¿En qué te colaboro hoy?`,
    tipo: "conversacion",
    sugerencias: ["¿Quién arregla ropa?", "¿Cerrajería de confianza?", "¿Cómo funciona el Trato Seguro?"],
  };
}

/**
 * Prompt del sistema con toda la base de conocimiento de ConectaComuna.
 */
function construirPromptSistema(negocios, barrioUsuario, lat, lng) {
  const listaNegocios = negocios
    .map(
      (n) =>
        `- [ID: ${n.id}] ${n.name} | Cat: ${n.category} | Barrio: ${n.neighborhood} | Wsp: ${n.whatsapp || "No"} | Verificado: ${n.verification_status === "verified" ? "Sí" : "No"}`
    )
    .join("\n");

  return `Eres el "Asistente Comunal de ConectaComuna", un copiloto barrial para los habitantes y emprendedores de la Comuna en Cali, Colombia.
Tu tono es humano, cálido, respetuoso, solidario y sin tecnicismos ("vecino", "vecina", trato amable colombiano/caleño).

INFORMACIÓN DEL USUARIO ACTUAL:
- Ubicación activa del usuario: Barrio "${barrioUsuario}" (Coordenadas aprox: ${lat}, ${lng}).
- REGLA DE ORO DE UBICACIÓN: Si el usuario no menciona explícitamente en qué barrio o lugar está, asume automáticamente que está en "${barrioUsuario}" y prioriza los negocios de este barrio o los más cercanos.

CONOCIMIENTO FUNDAMENTAL DE LA PLATAFORMA:
1. ConectaComuna es un directorio web gratuito y solidario de oficios locales (costureras, cerrajeros, mecánicos, artesanos, comida casera, barberías).
2. TRATO SEGURO COMUNAL: Es el acuerdo de palabra respaldado por la comunidad. La regla principal es que los anticipos para materiales o repuestos NUNCA pueden superar el 50% del total. Todo queda registrado con código de comprobante oficial imprimible y mediación vecinal.
3. FACILITADOR COMUNITARIO: Apoyo solidario para adultos mayores o personas con barreras tecnológicas. Un familiar o vecino joven se vincula con un código de 6 letras para ayudarles a subir fotos y actualizar catálogo.
4. GRATUIDAD Y LEY: ConectaComuna opera como portal de contacto comunitario conforme al Art. 53 de la Ley 1480 de 2011 (Estatuto del Consumidor). Publicar no tiene ningún costo.

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
  "rutaNavegacion": "/mapa" | "/explorar" | "/trato-seguro",
  "sugerencias": ["Opción 1 para tocar", "Opción 2"]
}

Si el emprendedor te dicta un oficio o servicio que quiere vender, extrae el precio, dale una redacción bonita y usa tipo: "servicio_catalogo".
Si el vecino busca un servicio, recomiéndale los negocios existentes más cercanos y usa tipo: "negocios".
Si pide ir a alguna sección, usa tipo: "navegacion" y la ruta correspondiente.`;
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

  // Si no hay API key configurada, responder con el motor local inteligente
  if (!apiKey) {
    const respuestaLocal = motorRespaldoLocal(mensaje, { barrio: barrioUsuario, lat, lng }, negocios);
    return res.json(respuestaLocal);
  }

  // Si hay API key de Gemini, invocar Google Gemini v1beta
  try {
    const promptSistema = construirPromptSistema(negocios, barrioUsuario, lat, lng);

    // Formatear historial reciente (máximo 4 mensajes previos para rapidez)
    const contenidos = [];
    const historialFiltrado = historial.slice(-4);
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

    const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const respuestaHttp = await fetch(urlGemini, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: promptSistema }],
        },
        contents: contenidos,
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!respuestaHttp.ok) {
      console.warn("Gemini API respondió status:", respuestaHttp.status, "Usando motor de respaldo.");
      const fallback = motorRespaldoLocal(mensaje, { barrio: barrioUsuario, lat, lng }, negocios);
      return res.json(fallback);
    }

    const jsonGemini = await respuestaHttp.json();
    const textoRespuesta = jsonGemini?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textoRespuesta) {
      const fallback = motorRespaldoLocal(mensaje, { barrio: barrioUsuario, lat, lng }, negocios);
      return res.json(fallback);
    }

    const parsed = JSON.parse(textoRespuesta);
    return res.json(parsed);
  } catch (err) {
    console.error("Error al comunicarse con Gemini:", err.message);
    const fallback = motorRespaldoLocal(mensaje, { barrio: barrioUsuario, lat, lng }, negocios);
    return res.json(fallback);
  }
});

export default ruta;
