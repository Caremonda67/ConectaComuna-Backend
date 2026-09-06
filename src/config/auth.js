import claveSupabase from "./supabase.js";

// Obtiene el usuario autenticado y su tipo de cuenta a partir del token Bearer.
// Usa clienteSupabase.auth.getUser() (valida el JWT contra Supabase Auth)
// y consulta la tabla `profiles` para saber qué account_type tiene.
export async function usuarioDesdePeticion(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { error: "Token requerido" };

  const { data, error } = await claveSupabase.auth.getUser(token);
  if (error || !data?.user) return { error: "Token inválido o expirado" };

  const { data: fila } = await claveSupabase
    .from("profiles")
    .select("account_type, full_name")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    usuario: data.user,
    account_type: fila?.account_type ?? null,
    nombre: fila?.full_name ?? data.user.user_metadata?.full_name ?? null,
  };
}
