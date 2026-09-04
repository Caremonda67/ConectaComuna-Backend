import claveSupabase from "./supabase.js";

// Obtiene el usuario autenticado y su rol a partir del token Bearer.
// Usa clienteSupabase.auth.getUser() (valida el JWT contra Supabase Auth)
// y consulta la tabla `usuarios` para saber qué rol tiene.
export async function usuarioDesdePeticion(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "Token requerido" };

  const { data, error } = await claveSupabase.auth.getUser(token);
  if (error || !data?.user) return { error: "Token inválido o expirado" };

  const { data: fila } = await claveSupabase
    .from("usuarios")
    .select("rol, nombre")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    usuario: data.user,
    rol: fila?.rol ?? null,
    nombre: fila?.nombre ?? data.user.user_metadata?.nombre ?? null,
  };
}
