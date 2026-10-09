import "dotenv/config";
import express from "express";
import cors from "cors";

import rutasSalud from "./routes/salud.js";
import rutasAuth from "./routes/auth.js";
import rutasBusinesses from "./routes/businesses.js";
import rutasOrders from "./routes/orders.js";
import rutasReviews from "./routes/reviews.js";
import rutasReports from "./routes/reports.js";

const origenesConfigurados = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((u) => u.trim().replace(/\/$/, ""))
  .filter(Boolean);

const origenesPermitidos = new Set([
  ...origenesConfigurados,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

app.use(
  cors({
    origin: (origin, callback) => {
      // Peticiones sin origin (como apps móviles, curl o pruebas locales)
      if (!origin) return callback(null, true);
      const origenLimpio = origin.replace(/\/$/, "");
      if (origenesPermitidos.has(origenLimpio)) {
        return callback(null, true);
      }
      return callback(new Error("Origen no permitido por política CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());

app.use("/api", rutasSalud);
app.use("/api/auth", rutasAuth);
app.use("/api/businesses", rutasBusinesses);
app.use("/api/orders", rutasOrders);
app.use("/api/reviews", rutasReviews);
app.use("/api/reports", rutasReports);

const puerto = process.env.PORT || 4000;

app.listen(puerto, () => {
  console.log(`API de Conecta Comuna escuchando en el puerto ${puerto}`);
});
