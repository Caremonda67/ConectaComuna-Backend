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

const origenesConfigurados = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((u) => u.trim().replace(/\/$/, ""))
  .filter(Boolean);

const origenesPermitidos = new Set([
  ...origenesConfigurados,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

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
        origenLimpio.includes("vercel.app") ||
        /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(origenLimpio) ||
        process.env.NODE_ENV !== "production"
      ) {
        return callback(null, true);
      }
      return callback(new Error("Origen no permitido por política CORS"));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "128kb" }));

app.use("/api", rutasSalud);
app.use("/api/auth", rutasAuth);
app.use("/api/businesses", rutasBusinesses);
app.use("/api/orders", rutasOrders);
app.use("/api/reviews", rutasReviews);
app.use("/api/reports", rutasReports);
app.use("/api/ai", rutasAi);

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
