import { Router } from "express";
import claveSupabase from "../config/supabase.js";
import { usuarioDesdePeticion } from "../config/auth.js";

const ruta = Router();

const ACCOUNT_TYPES = ["client", "business", "facilitador"];

// Rate limiting simple en memoria por IP para evitar spam de registros
const registroIntentos = new Map();
const VENTANA_REGISTRO_MS = 15 * 60 * 1000; // 15 minutos
const MAX_REGISTROS_POR_IP = 5;

function ipSuperaLimite(ip) {
  const ahora = Date.now();
  const intentos = (registroIntentos.get(ip) || []).filter((t) => ahora - t < VENTANA_REGISTRO_MS);
  if (intentos.length >= MAX_REGISTROS_POR_IP) {
    registroIntentos.set(ip, intentos);
    return true;
  }
  intentos.push(ahora);
  registroIntentos.set(ip, intentos);
  return false;
}

// Registro: crea el usuario en Supabase Auth y delega la creación del perfil al trigger.
ruta.post("/registro", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "desconocido";
  if (ipSuperaLimite(ip)) {
    return res.status(429).json({ error: "Demasiados registros desde esta red. Intenta más tarde." });
  }

  const { email, password, account_type, full_name, phone, neighborhood } = req.body;

  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    return res.status(400).json({ error: "email y password son requeridos" });
  }

  const emailLimpio = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpio)) {
    return res.status(400).json({ error: "Formato de correo electrónico inválido" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });
  }
  
  const typeToSet = ACCOUNT_TYPES.includes(account_type) ? account_type : "client";

  const { data, error } = await claveSupabase.auth.admin.createUser({
    email: emailLimpio,
    password,
    email_confirm: true,
    user_metadata: { 
      account_type: typeToSet, 
      full_name: typeof full_name === "string" && full_name.trim() ? full_name.trim() : "Vecino",
      phone: phone ?? null,
      neighborhood: neighborhood ?? null
    },
  });

  if (error) return res.status(400).json({ error: error.message });

  // No necesitamos insertar en 'profiles' porque el trigger 'handle_new_user' de Supabase lo hace.
  res.status(201).json({ id: data.user.id, email: emailLimpio, account_type: typeToSet });
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
