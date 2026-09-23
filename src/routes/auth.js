import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

const ACCOUNT_TYPES = ["client", "business"];

// Registro: crea el usuario en Supabase Auth y delega la creación del perfil al trigger.
ruta.post("/registro", async (req, res) => {
  const { email, password, account_type, full_name, phone, neighborhood } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email y password son requeridos" });
  }
  
  const typeToSet = ACCOUNT_TYPES.includes(account_type) ? account_type : "client";

  const { data, error } = await claveSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { 
      account_type: typeToSet, 
      full_name: full_name ?? "Vecino",
      phone: phone ?? null,
      neighborhood: neighborhood ?? null
    },
  });

  if (error) return res.status(400).json({ error: error.message });

  // No necesitamos insertar en 'profiles' porque el trigger 'handle_new_user' de Supabase lo hace.
  res.status(201).json({ id: data.user.id, email, account_type: typeToSet });
});

// Devuelve la cuenta del usuario autenticado.
ruta.get("/mi-cuenta", async (req, res) => {
  const { usuario, account_type, nombre, error } = await usuarioDesdePeticion(req);
  if (error) return res.status(401).json({ error });

  res.json({
    id: usuario.id,
    email: usuario.email,
    account_type,
    full_name: nombre,
  });
});

export default ruta;
