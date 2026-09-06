import "dotenv/config";
import express from "express";
import cors from "cors";

import rutasSalud from "./routes/salud.js";
import rutasAuth from "./routes/auth.js";
import rutasBusinesses from "./routes/businesses.js";
import rutasOrders from "./routes/orders.js";
import rutasReviews from "./routes/reviews.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api", rutasSalud);
app.use("/api/auth", rutasAuth);
app.use("/api/businesses", rutasBusinesses);
app.use("/api/orders", rutasOrders);
app.use("/api/reviews", rutasReviews);

const puerto = process.env.PORT || 4000;

app.listen(puerto, () => {
  console.log(`API de Conecta Comuna escuchando en el puerto ${puerto}`);
});
