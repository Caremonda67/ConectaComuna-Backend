import test from "node:test";
import assert from "node:assert/strict";

// El módulo arma el cliente de Supabase al importarse.
process.env.SUPABASE_URL = "https://ejemplo.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-prueba";

const { motorRespaldoLocal, construirPromptSistema, leerMonto } = await import("../src/routes/ai.js");

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

/**
 * Para ACTUAR, el modelo necesita identificadores. Sin el servicioId no puede
 * cambiar un precio y sin el id del pedido no puede aceptarlo ni dejarle una
 * nota al cliente: sabria que existen, pero no sobre cual obrar. Una accion
 * sin identificador es una accion que adivina, y adivinar aqui significa
 * cambiarle el precio al servicio equivocado.
 */

test("el prompt lleva el catalogo con sus servicioId", () => {
  const prompt = construirPromptSistema(
    [],
    "El Retiro",
    3.42,
    -76.52,
    contextoNegocio({
      servicios: [
        { id: "svc-1", nombre: "Trenzas africanas", precio: 45000 },
        { id: "svc-2", nombre: "Corte de cabello", precio: null },
      ],
    }),
    true,
  );
  assert.match(prompt, /servicioId: svc-1/);
  assert.match(prompt, /Trenzas africanas/);
  assert.match(prompt, /\$45000/);
  // Un servicio sin precio no debe salir como "$null".
  assert.match(prompt, /sin precio/);
  assert.doesNotMatch(prompt, /\$null/);
});

test("el prompt lleva el id de cada pedido, no solo su codigo", () => {
  const contexto = contextoNegocio();
  contexto.pedidosActivos = [
    {
      id: "ord-abc",
      codigo: "CC-ABC123",
      titulo: "Trenzas para quinceañera",
      estado: "pending",
      monto: 60000,
      anticipo: 0,
      contraparte: "Carmen",
      rol: "comerciante",
    },
  ];
  const prompt = construirPromptSistema([], "El Retiro", 3.42, -76.52, contexto, true);
  assert.match(prompt, /id: ord-abc/);
  assert.match(prompt, /CC-ABC123/);
});

test("el prompt declara las cuatro acciones ejecutables", () => {
  const prompt = construirPromptSistema([], "El Retiro", 3.42, -76.52, contextoNegocio(), true);
  for (const accion of [
    "cambiar_precio_servicio",
    "aceptar_pedido",
    "nota_avance_pedido",
    "actualizar_horario",
  ]) {
    assert.match(prompt, new RegExp(accion));
  }
  // El tope del anticipo se le recuerda al modelo aunque la base lo imponga.
  assert.match(prompt, /NUNCA puede pasar del 50%/);
  assert.match(prompt, /nunca inventes uno|Nunca inventes un id/);
});

test("sin catalogo el prompt lo dice en vez de dejar el bloque vacio", () => {
  const prompt = construirPromptSistema(
    [],
    "El Retiro",
    3.42,
    -76.52,
    contextoNegocio({ servicios: [] }),
    true,
  );
  assert.match(prompt, /Todavía no tiene servicios en el catálogo/);
});

/**
 * Con varios pedidos activos el copiloto no puede elegir por su cuenta: si
 * acepta el equivocado, fija un precio real en el pedido de otra persona.
 * Y la lista que recibe viene recortada, asi que tampoco puede presentarla
 * como si fuera todo lo que hay.
 */

function pedido(id, titulo, contraparte, monto) {
  return {
    id,
    codigo: `CC-${id.toUpperCase()}`,
    titulo,
    estado: "pending",
    monto,
    anticipo: 0,
    contraparte,
    rol: "comerciante",
  };
}

test("el prompt obliga a listar y preguntar cuando hay varios pedidos", () => {
  const contexto = contextoNegocio();
  contexto.pedidosActivos = [
    pedido("ord-1", "Trenzas para quinceañera", "Carmen", 60000),
    pedido("ord-2", "Trenzas africanas", "Luz Mery", 45000),
  ];
  contexto.totalPedidosActivos = 2;
  const prompt = construirPromptSistema([], "El Retiro", 3.42, -76.52, contexto, true);

  assert.match(prompt, /id: ord-1/);
  assert.match(prompt, /id: ord-2/);
  assert.match(prompt, /Si hay VARIOS, NO elijas tú/);
  // Una opcion por pedido para poder tocar en vez de teclear.
  assert.match(prompt, /UNA opción por pedido/);
  // Sin recorte no debe aparecer la advertencia.
  assert.doesNotMatch(prompt, /ATENCION: el usuario tiene/);
});

test("avisa cuando la lista de pedidos viene recortada", () => {
  const contexto = contextoNegocio();
  contexto.pedidosActivos = [pedido("ord-1", "Trenzas", "Carmen", 60000)];
  contexto.totalPedidosActivos = 7;
  const prompt = construirPromptSistema([], "El Retiro", 3.42, -76.52, contexto, true);

  assert.match(prompt, /tiene 7 pedidos activos en total/);
  assert.match(prompt, /NUNCA digas que esos son todos/);
});

test("prohibe elegir el pedido por su posicion en la lista", () => {
  const prompt = construirPromptSistema([], "El Retiro", 3.42, -76.52, contextoNegocio(), true);
  assert.match(prompt, /Nunca uses "el último", "el primero"/);
});

/**
 * El modelo decia "ya acepte el pedido" sin aceptarlo.
 *
 * La causa no era el modelo: era el esquema de salida. Le deciamos "responde
 * SIEMPRE con esta estructura exacta" y esa estructura no incluia
 * `confirmacion_accion` ni el campo `accionPendiente`. Con las reglas
 * pidiendole una accion que el esquema no admitia, obedecio al esquema,
 * no pudo pedirla, y narro un exito que no ocurrio.
 *
 * Afirmar que se hizo algo que no se hizo es peor que negarse: la persona ni
 * siquiera se entera del fallo.
 */

test("el esquema de salida admite pedir una accion", () => {
  const prompt = construirPromptSistema([], "El Retiro", 3.42, -76.52, contextoNegocio(), true);
  assert.match(prompt, /"confirmacion_accion"/);
  assert.match(prompt, /"accionPendiente"/);
  assert.match(prompt, /"botonConfirmar"/);
});

test("el esquema enumera las acciones que de verdad se ejecutan", () => {
  const prompt = construirPromptSistema([], "El Retiro", 3.42, -76.52, contextoNegocio(), true);
  for (const accion of [
    "generar_codigo_apadrinamiento",
    "cambiar_precio_servicio",
    "aceptar_pedido",
    "nota_avance_pedido",
    "actualizar_horario",
  ]) {
    assert.match(prompt, new RegExp(`"${accion}"`));
  }
});

test("le prohibe afirmar que ya ejecuto el cambio", () => {
  const prompt = construirPromptSistema([], "El Retiro", 3.42, -76.52, contextoNegocio(), true);
  assert.match(prompt, /TÚ NO EJECUTAS NADA AL RESPONDER/);
  assert.match(prompt, /JAMÁS escribas que ya aceptaste un pedido/);
  assert.match(prompt, /Sin ese objeto no se ejecuta nada/);
  // Y que lo pida en futuro, no en pasado.
  assert.match(prompt, /nunca "Ya lo acepté"/);
});

/**
 * Auditoria del cambio de precio.
 *
 * El flujo anterior contestaba "¡Precio actualizado! He guardado este cambio
 * en la ficha" sin guardar nada, y al confirmar creaba un producto NUEVO sin
 * nombre en vez de editar el que ya existia.
 */

const CATALOGO = [
  { id: "svc-1", nombre: "Trenzas africanas", precio: 45000 },
  { id: "svc-2", nombre: "Corte de cabello", precio: 18000 },
];

test("cambiar precio propone la accion real, no un servicio nuevo", () => {
  const r = motorRespaldoLocal(
    "cambiale el precio a las trenzas a 50 mil",
    null,
    [],
    [],
    contextoNegocio({ servicios: CATALOGO }),
  );
  assert.equal(r.tipo, "confirmacion_accion");
  assert.equal(r.accionPendiente.tipo, "cambiar_precio_servicio");
  assert.deepEqual(r.accionPendiente.payload, { servicioId: "svc-1", precioNuevo: 50000 });
  assert.notEqual(r.tipo, "servicio_catalogo");
  assert.doesNotMatch(r.mensaje, /Precio actualizado|He guardado/);
});

test("la tarjeta dice el precio viejo y el nuevo", () => {
  const r = motorRespaldoLocal(
    "sube el corte a 25 mil",
    null,
    [],
    [],
    contextoNegocio({ servicios: CATALOGO }),
  );
  assert.match(r.accionPendiente.descripcion, /18\.000/);
  assert.match(r.accionPendiente.descripcion, /25\.000/);
});

test("con dos servicios y sin decir cual, pregunta en vez de elegir", () => {
  const r = motorRespaldoLocal(
    "cambiar el precio a 30 mil",
    null,
    [],
    [],
    contextoNegocio({ servicios: CATALOGO }),
  );
  assert.equal(r.tipo, "conversacion");
  assert.equal(r.accionPendiente, undefined);
  assert.match(r.mensaje, /Trenzas africanas/);
  assert.match(r.mensaje, /Corte de cabello/);
});

test("sin catalogo no ofrece cambiar nada", () => {
  const r = motorRespaldoLocal(
    "cambiar el precio a 30 mil",
    null,
    [],
    [],
    contextoNegocio({ servicios: [] }),
  );
  assert.equal(r.accionPendiente, undefined);
  assert.match(r.mensaje, /no tienes servicios/);
});

test("el prompt separa cambiar precio de crear servicio", () => {
  const prompt = construirPromptSistema([], "El Retiro", 3.42, -76.52, contextoNegocio(), true);
  assert.match(prompt, /NUNCA devuelvas tipo "servicio_catalogo" para esto/);
  assert.match(prompt, /JAMÁS escribas "precio actualizado"/);
});

test("leerMonto entiende las formas de decir un precio", () => {
  assert.equal(leerMonto("30 mil"), 30000);
  assert.equal(leerMonto("30.000"), 30000);
  assert.equal(leerMonto("a 30"), 30000);
  assert.equal(leerMonto("$45.000"), 45000);
  assert.equal(leerMonto("cambiar el precio"), null);
});

test("responder solo con el monto no pierde el hilo de la conversacion", () => {
  // El backend recibe el historial con `rol`, no con `emisor`: esa es la
  // forma que arma el frontend al llamar a /api/ai/chat.
  const historial = [
    {
      rol: "model",
      texto: '¿A qué valor dejo "Corte de cabello"? Ahora está en $ 18.000.',
    },
  ];
  const r = motorRespaldoLocal(
    "$40.000",
    null,
    [],
    historial,
    contextoNegocio({ servicios: CATALOGO }),
  );
  assert.equal(r.accionPendiente.tipo, "cambiar_precio_servicio");
  assert.deepEqual(r.accionPendiente.payload, { servicioId: "svc-2", precioNuevo: 40000 });
});
