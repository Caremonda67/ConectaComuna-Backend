import { Router } from "express";

const ruta = Router();

ruta.get("/salud", (_req, res) => {
  res.json({ estado: "ok", servicio: "conecta-comuna-api" });
});

export default ruta;