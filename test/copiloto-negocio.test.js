import test from "node:test";
import assert from "node:assert/strict";

// El módulo arma el cliente de Supabase al importarse.
process.env.SUPABASE_URL = "https://ejemplo.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-prueba";

const { motorRespaldoLocal, construirPromptSistema } = await import("../src/routes/ai.js");

/**
 * El copiloto le decía a una emprendedora que no había finalizado ningún
 * trabajo cuando su propio panel mostraba dos.
 *
 * No calculaba mal: nunca los veía. Tanto el prompt del modelo como el motor
 * de respaldo solo recibían los pedidos ACTIVOS (pendiente, aceptado, en
 * curso); los finalizados quedan fuera por definición. El prompt llegaba a
 * decir "No tiene pedidos ni pactos activos en este momento" y el modelo
 * contestaba lo único que podía contestar.
 */

function contextoNegocio(negocio = {}) {
  return {
    autenticado: true,
    nombre: "Ana Julieth Mosquera",
    tipoCuenta: "business",
    rolActivo: "business",
    negocioPropio: {
      tieneNegocio: true,
      nombre: "MyH Trenzas",
      pedidosFinalizados: 0,
      calificacion: 0,
      resenas: 0,
      ...negocio,
    },
    pedidosActivos: [],
  };
}

test("el motor de respaldo dice cuántos trabajos finalizó", () => {
  const r = motorRespaldoLocal(
    "cuantos pedidos he finalizado?",
    null,
    [],
    [],
    contextoNegocio({ pedidosFinalizados: 2, calificacion: 5, resenas: 2 }),
  );
  assert.match(r.mensaje, /2/);
  assert.match(r.mensaje, /MyH Trenzas/);
  // La frase que daba antes, y que no debe volver.
  assert.doesNotMatch(r.mensaje, /no tienes pedidos ni pactos activos/i);
});

test("con cero finalizados explica cómo se cuenta uno, no solo lo niega", () => {
  const r = motorRespaldoLocal(
    "cuántos trabajos llevo",
    null,
    [],
    [],
    contextoNegocio({ pedidosFinalizados: 0 }),
  );
  assert.match(r.mensaje, /marcas/);
});

test("no promete reseñas que no existen", () => {
  const r = motorRespaldoLocal(
    "mis reseñas",
    null,
    [],
    [],
    contextoNegocio({ pedidosFinalizados: 2, resenas: 0 }),
  );
  assert.match(r.mensaje, /Todavía no tienes reseñas/);
});

test("el prompt del modelo lleva los trabajos finalizados", () => {
  const prompt = construirPromptSistema(
    [],
    "El Retiro",
    3.42,
    -76.52,
    contextoNegocio({ pedidosFinalizados: 2, calificacion: 5, resenas: 2 }),
    true,
  );
  assert.match(prompt, /Trabajos FINALIZADOS en total: 2/);
  assert.match(prompt, /5\.0 de 5/);
  // La advertencia que evita que el modelo confunda activos con finalizados.
  assert.match(prompt, /Los trabajos FINALIZADOS no aparecen ahí/);
  assert.match(prompt, /NUNCA digas que no tiene ninguno/);
});

test("sin negocio el prompt no inventa historial", () => {
  const prompt = construirPromptSistema(
    [],
    "El Retiro",
    3.42,
    -76.52,
    { autenticado: true, nombre: "Carmen", tipoCuenta: "client", negocioPropio: { tieneNegocio: false } },
    true,
  );
  assert.match(prompt, /no tiene negocio/i);
  // Ni la cifra ni la advertencia: sin negocio no hay nada que contar, y la
  // advertencia solo añadiría ruido al prompt.
  assert.doesNotMatch(prompt, /Trabajos FINALIZADOS en total: \d/);
  assert.doesNotMatch(prompt, /NUNCA digas que no tiene ninguno/);
});
