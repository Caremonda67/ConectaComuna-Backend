import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

const ROLES = ["emprendedor", "facilitador"];

// Registro: crea el usuario en Supabase Auth y le asigna un rol.
ruta.post("/registro", async (req, res) => {
  const { email, password, rol, nombre } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email y password son requeridos" });
  }
  if (!ROLES.includes(rol)) {
    return res.status(400).json({ error: `rol debe ser uno de: ${ROLES.join(", ")}` });
  }

  const { data, error } = await claveSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { rol, nombre: nombre ?? null },
  });

  if (error) return res.status(400).json({ error: error.message });

  const { error: errorRol } = await claveSupabase.from("usuarios").insert({
    id: data.user.id,
    rol,
    nombre: nombre ?? null,
  });

  if (errorRol) {
    return res.status(500).json({ error: errorRol.message });
  }

  res.status(201).json({ id: data.user.id, email, rol });
});

// Devuelve la cuenta del usuario autenticado (quién es y qué rol tiene).
ruta.get("/mi-cuenta", async (req, res) => {
  const { usuario, rol, nombre, error } = await usuarioDesdePeticion(req);
  if (error) return res.status(401).json({ error });

  res.json({
    id: usuario.id,
    email: usuario.email,
    rol,
    nombre,
  });
});

export default ruta;
