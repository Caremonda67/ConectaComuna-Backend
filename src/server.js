import "dotenv/config";
import express from "express";
import cors from "cors";

import rutasSalud from "./routes/salud.js";
import rutasAuth from "./routes/auth.js";
import rutasBusinesses from "./routes/businesses.js";
import rutasOrders from "./routes/orders.js";
import rutasReviews from "./routes/reviews.js";
import rutasReports from "./routes/reports.js";
import rutasAi from "./routes/ai.js";
import { limiteAsistente, limiteEscritura, limiteGeneral } from "./config/limites.js";
import { manejadorDeErrores } from "./middleware/errores.js";

const origenesConfigurados = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((u) => u.trim().replace(/\/$/, ""))
  .filter(Boolean);

const origenesPermitidos = new Set([
  ...origenesConfigurados,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

// Los previews de Vercel cambian de subdominio en cada despliegue. El patrón va
// anclado: buscar "vercel.app" suelto también aceptaba vercel.app.atacante.io.
const esPreviewDeVercel = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i;

const app = express();

// Render pone un proxy delante: sin esto todos los visitantes comparten la IP
// del balanceador y los límites por IP se aplicarían al conjunto.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: (origin, callback) => {
      // Peticiones sin origin (como apps móviles, curl o pruebas locales)
      if (!origin) return callback(null, true);
      const origenLimpio = origin.replace(/\/$/, "");
      if (
        origenesPermitidos.has(origenLimpio) ||
        esPreviewDeVercel.test(origenLimpio) ||
        /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origenLimpio) ||
        process.env.NODE_ENV !== "production"
      ) {
        return callback(null, true);
      }
      // Sin cabecera el navegador bloquea la respuesta. Devolver un error aquí
      // convertía un rechazo de CORS en un 500.
      return callback(null, false);
    },
  })
);
app.use(express.json({ limit: "128kb" }));

// La salud queda fuera del límite: la consulta el health check de Render y el
// ping que mantiene el servicio despierto.
app.use("/api", rutasSalud);

app.use("/api", limiteGeneral);
app.use("/api/auth", limiteEscritura, rutasAuth);
app.use("/api/businesses", rutasBusinesses);
app.use("/api/orders", rutasOrders);
app.use("/api/reviews", limiteEscritura, rutasReviews);
app.use("/api/reports", limiteEscritura, rutasReports);
app.use("/api/ai", limiteAsistente, rutasAi);

// Lo que no exista responde JSON. El 404 en HTML de Express confunde a quien
// consume la API desde el navegador.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Esa ruta no existe en la API." });
});

// Último de la cadena. Si una ruta llama next(error), la respuesta sale de aquí.
app.use(manejadorDeErrores);

// Una promesa rechazada no debería tumbar la API a mitad de una demostración.
// Se deja el rastro en el log y el proceso sigue atendiendo.
process.on("unhandledRejection", (motivo) => {
  console.error("Promesa rechazada sin capturar:", motivo);
});

const puerto = process.env.PORT || 4000;

app.listen(puerto, () => {
  console.log(`API de Conecta Comuna escuchando en el puerto ${puerto}`);

  // En el plan gratuito de Render el servicio entra en reposo tras 15 minutos sin tráfico.
  // Render inyecta RENDER_EXTERNAL_URL automáticamente en el servicio web.
  // Enviamos una petición a /api/salud cada 10 minutos para mantener el servicio activo.
  const urlPublica = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
  if (urlPublica) {
    const INTERVALO_MS = 10 * 60 * 1000;
    setInterval(async () => {
      try {
        const resp = await fetch(`${urlPublica.replace(/\/$/, "")}/api/salud`, {
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          console.log("Ping de actividad completado:", new Date().toLocaleTimeString("es-CO"));
        }
      } catch (err) {
        console.warn("No se pudo completar el ping de actividad:", err.message);
      }
    }, INTERVALO_MS);
  }
});
