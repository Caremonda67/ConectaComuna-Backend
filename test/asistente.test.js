import test from "node:test";
import assert from "node:assert/strict";

// El módulo arma el cliente de Supabase al importarse, así que necesita las
// variables puestas antes. Estas pruebas no tocan la base: son funciones puras.
process.env.SUPABASE_URL = "https://ejemplo.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-prueba";

const { calcularDistanciaMetros, extraerJsonValido } = await import("../src/routes/ai.js");

test("la distancia entre el mismo punto es cero", () => {
  assert.equal(calcularDistanciaMetros(3.4516, -76.532, 3.4516, -76.532), 0);
});

test("un grado de latitud ronda los 111 km", () => {
  const metros = calcularDistanciaMetros(3, -76, 4, -76);
  assert.ok(metros > 110000 && metros < 112000, "salió " + metros);
});

test("lee un JSON limpio", () => {
  assert.deepEqual(extraerJsonValido('{"mensaje":"hola"}'), { mensaje: "hola" });
});

test("lee un JSON dentro de un bloque de código", () => {
  const texto = "Claro:\n\`\`\`json\n{\"mensaje\":\"hola\",\"tipo\":\"conversacion\"}\n\`\`\`";
  assert.equal(extraerJsonValido(texto).tipo, "conversacion");
});

test("lee un JSON con texto alrededor", () => {
  const texto = 'Aquí va: {"mensaje":"listo","sugerencias":["a","b"]} y nada más';
  assert.deepEqual(extraerJsonValido(texto).sugerencias, ["a", "b"]);
});

test("devuelve null cuando no hay JSON", () => {
  assert.equal(extraerJsonValido("no tengo nada que ofrecer"), null);
  assert.equal(extraerJsonValido(""), null);
});
