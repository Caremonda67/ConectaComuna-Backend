import "dotenv/config";
import express from "express";
import cors from "cors";

import rutasSalud from "./routes/salud.js";
import rutasCategorias from "./routes/categorias.js";
import rutasComunas from "./routes/comunas.js";
import rutasAuth from "./routes/auth.js";
import rutasPerfiles from "./routes/perfiles.js";
import rutasProductos from "./routes/productos.js";
import rutasSolicitudes from "./routes/solicitudes.js";
import rutasResenas from "./routes/resenas.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api", rutasSalud);
app.use("/api/categorias", rutasCategorias);
app.use("/api/comunas", rutasComunas);
app.use("/api/auth", rutasAuth);
app.use("/api/perfiles", rutasPerfiles);
app.use("/api/productos", rutasProductos);
app.use("/api/solicitudes", rutasSolicitudes);
app.use("/api/resenas", rutasResenas);

const puerto = process.env.PORT || 4000;

app.listen(puerto, () => {
  console.log(`API de Conecta Comuna escuchando en el puerto ${puerto}`);
});
