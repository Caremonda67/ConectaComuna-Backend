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

/**
 * El asistente respondio que la plataforma "no cuenta con una opcion para
 * generar codigos de apadrinamiento", con el boton que lo genera visible en
 * el panel de esa misma persona. Inventar una limitacion del producto es peor
 * que no saber: la persona se va creyendo que no se puede.
 */

test("ofrece generar el codigo de apadrinamiento en vez de negar que exista", () => {
  const r = motorRespaldoLocal(
    "generame un codigo de apadrinamiento",
    null,
    [],
    [],
    contextoNegocio({ pedidosFinalizados: 2 }),
  );
  assert.equal(r.tipo, "confirmacion_accion");
  assert.equal(r.accionPendiente.tipo, "generar_codigo_apadrinamiento");
  assert.doesNotMatch(r.mensaje, /no (contamos|tenemos|hay)/i);
  // La advertencia de seguridad no es opcional: quien tenga el codigo puede
  // tomar el control de la ficha.
  assert.match(r.mensaje, /en mano|nunca por grupos/i);
});

test("sin negocio no ofrece el codigo, lleva a crear el negocio", () => {
  const r = motorRespaldoLocal("como genero un codigo de apadrinamiento", null, [], [], {
    autenticado: true,
    nombre: "Carmen",
    tipoCuenta: "client",
    negocioPropio: { tieneNegocio: false },
    pedidosActivos: [],
  });
  assert.equal(r.tipo, "navegacion");
  assert.match(r.rutaNavegacion, /panel\/negocio/);
});

test("el prompt le prohibe al modelo negar que exista el apadrinamiento", () => {
  const prompt = construirPromptSistema([], "El Retiro", 3.42, -76.52, contextoNegocio(), true);
  assert.match(prompt, /NUNCA LA NIEGUES/);
  assert.match(prompt, /NUNCA inventes un código tú/);
});
