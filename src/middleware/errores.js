/**
 * Un manejador async que falla deja la promesa rechazada y Express 4 no la
 * recoge. En Node 20 eso termina el proceso entero, no solo la petición.
 * envolver() la manda a next() para que caiga en el manejador de abajo.
 */
export const envolver = (manejador) => (req, res, next) =>
  Promise.resolve(manejador(req, res, next)).catch(next);

export function manejadorDeErrores(error, _req, res, _next) {
  console.error("Error sin manejar:", error);

  if (res.headersSent) return;
  res.status(500).json({ error: "Algo falló de nuestro lado. Vuelve a intentar en un momento." });
}
