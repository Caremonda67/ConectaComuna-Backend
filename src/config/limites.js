import rateLimit from "express-rate-limit";

/**
 * Límites por IP. El servicio queda público para que el jurado lo pruebe, y
 * detrás hay una cuota de Gemini que se paga: sin esto, un bucle en una
 * pestaña abierta o alguien curioso la agota en minutos.
 *
 * Render pone un proxy delante, así que `trust proxy` tiene que estar activo
 * en el servidor para que la IP que se cuenta sea la del visitante.
 */

const respuesta = (mensaje) => (req, res) => {
  res.status(429).json({ error: mensaje });
};

/** Techo general. Holgado: un recorrido normal no pasa de unas decenas. */
export const limiteGeneral = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: respuesta("Demasiadas peticiones seguidas. Espera un momento y vuelve a intentar."),
});

/**
 * El asistente es lo caro. Veinte mensajes en cinco minutos alcanzan de sobra
 * para una demostración y cortan el abuso.
 */
export const limiteAsistente = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: respuesta(
    "El Asistente Comunal recibió muchos mensajes seguidos desde tu conexión. Espera unos minutos."
  ),
});

/** Crear cuentas y publicar negocios o reseñas no debería ir en ráfaga. */
export const limiteEscritura = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: respuesta("Demasiados envíos seguidos. Espera unos minutos antes de volver a intentar."),
});
