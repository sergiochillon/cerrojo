// Ensayo en local del guion de validación: los mismos scripts SQL que se ejecutarán en el
// proyecto Supabase de pruebas se aplican aquí a un PostgreSQL real (PGlite) y el validador
// debe obtener exactamente lo esperado. No hay red: la capa HTTP es la emulación de demo/.
// Esto comprueba que el SQL es válido y que las expectativas son coherentes; lo que no puede
// comprobar es cómo responde el Supabase de verdad, que es justo para lo que sirve el guion.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarDemo, firmarJwt } from '../demo/servidor.js';
import { Cliente } from '../src/http.js';
import { ejecutarValidacion, motivosParaNoEmpezar, limpiarMensaje, FRASE_DE_CONFIRMACION, ESPERADO_AISLAMIENTO, ESPERADO_SIN_SESION } from '../validacion/validar.js';
import { probarAislamiento } from '../src/aislamiento.js';
import { auditarWeb } from '../src/web.js';
import { generarInforme } from '../src/informe.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = (n) => readFileSync(join(RAIZ, 'validacion', n), 'utf8');
const CUENTAS = {
  A: { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', correo: 'cerrojo-a@example.test', contrasena: 'ensayo-local-a' },
  B: { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', correo: 'cerrojo-b@example.test', contrasena: 'ensayo-local-b' },
};
const arrancar = (scripts) => iniciarDemo({ sql: scripts.map(sql), usuarios: CUENTAS, sinPermisosPorDefecto: true });
const validar = (demo, extra = {}) =>
  ejecutarValidacion({ cliente: new Cliente({ pausaMs: 0, permitirLocal: true }), supabaseUrl: demo.url, clave: demo.claveAnon, usuarioA: CUENTAS.A, usuarioB: CUENTAS.B, ...extra });

let demo;
before(async () => {
  demo = await arrancar(['01_esquema.sql', '01b_storage_opcional.sql', '02_datos.sql']);
  // En el proyecto real estos archivos se suben a mano desde el panel.
  await demo.db.exec(`insert into storage.objects (bucket_id, name) values ('cv-listable', 'sintetico.txt'), ('cv-privado', 'sintetico.txt')`);
});
after(() => demo.cerrar());

test('ensayo: con el SQL del guion, todas las comprobaciones dan lo esperado', async () => {
  const r = await validar(demo, { conStorage: true });
  const fallos = r.comprobaciones.filter((c) => !c.ok);
  assert.deepEqual(fallos, [], JSON.stringify(fallos, null, 2));
  assert.equal(r.comprobaciones.length, Object.keys(ESPERADO_SIN_SESION).length + Object.keys(ESPERADO_AISLAMIENTO).length + 7);
});

test('ensayo: la validación solo lee; ni un PATCH, PUT o DELETE, y los datos quedan intactos', async () => {
  const huella = async () => (await demo.db.query(`select md5(string_agg(t::text, '|' order by t::text)) as h from (select 'a', id::text, user_id::text from cv_sin_rls union all select 'b', id::text, user_id::text from cv_solo_sesion union all select 'c', id::text, user_id::text from cv_por_dueno) t`)).rows[0].h;
  const antes = await huella();
  const r = await validar(demo);
  assert.deepEqual([...new Set(r.peticiones.map((p) => p.metodo))].sort(), ['GET', 'POST']);
  for (const p of r.peticiones.filter((x) => x.metodo === 'POST')) assert.match(p.ruta, /^\/auth\/v1\/token\?grant_type=password$|^\/storage\/v1\/object\/list\//, p.ruta);
  assert.equal(await huella(), antes);
  const fuente = sql('validar.js');
  assert.doesNotMatch(fuente, /probarEscritura\s*:|actualizarSinCambios|baseDesechable|permitirLocal/);
});

test('ensayo: el resultado no contiene claves, tokens, contraseñas ni valores de filas', async () => {
  const r = await validar(demo, { conStorage: true });
  const volcado = JSON.stringify(r);
  for (const prohibido of [demo.claveAnon, CUENTAS.A.contrasena, CUENTAS.B.contrasena, CUENTAS.A.correo, CUENTAS.A.id, CUENTAS.B.id, 'sintetico-a-1', 'sintetico-de-a-para-b', 'access_token']) {
    assert.ok(!volcado.includes(prohibido), `no debería aparecer: ${prohibido}`);
  }
});

test('ensayo: sin la marca de validación se detiene tras una sola petición', async () => {
  const otro = await iniciarDemo(); // la app ficticia: un proyecto que NO es el de validación
  try {
    const cliente = new Cliente({ pausaMs: 0, permitirLocal: true });
    await assert.rejects(ejecutarValidacion({ cliente, supabaseUrl: otro.url, clave: otro.claveAnon, usuarioA: CUENTAS.A, usuarioB: CUENTAS.B }), /No encuentro la marca de validación/);
    assert.equal(cliente.hechas, 1);
  } finally {
    await otro.cerrar();
  }
});

// Un script que falla dentro de "begin … commit" deja la transacción abortada; en una misma
// conexión hay que cerrarla con "rollback" antes de seguir (el guion lo menciona).
async function rechazado(db, script, patron) {
  await assert.rejects(db.exec(script), patron);
  await db.exec('rollback');
}

test('ensayo: los scripts se niegan a ejecutarse donde no deben', async () => {
  // 01 y 03 en un proyecto que tiene tablas propias: no crean ni borran nada.
  const ocupado = await iniciarDemo();
  try {
    await rechazado(ocupado.db, sql('01_esquema.sql'), /no parece un proyecto de pruebas vacío/);
    await rechazado(ocupado.db, sql('03_limpieza.sql'), /este no es el proyecto de validación/);
    assert.equal((await ocupado.db.query(`select count(*)::int as n from pg_tables where schemaname = 'public' and tablename like 'cv\\_%'`)).rows[0].n, 0);
    assert.equal((await ocupado.db.query('select count(*)::int as n from public.clients')).rows[0].n, 6, 'no se ha tocado nada');
  } finally {
    await ocupado.cerrar();
  }
  // 03 en un proyecto que mezcla la validación con otras tablas: tampoco borra.
  const mezclado = await arrancar(['01_esquema.sql']);
  try {
    await mezclado.db.exec('create table public.pedidos_reales (id int)');
    await rechazado(mezclado.db, sql('03_limpieza.sql'), /tablas o vistas que no son de la validación/);
    assert.equal((await mezclado.db.query(`select count(*)::int as n from pg_tables where schemaname = 'public'`)).rows[0].n, 9, 'las 8 tablas cv_ y la ajena siguen ahí');
  } finally {
    await mezclado.cerrar();
  }
  // 01 y 02 por segunda vez; 02 sin cuentas de prueba.
  await rechazado(demo.db, sql('01_esquema.sql'), /ya existen/);
  await rechazado(demo.db, sql('02_datos.sql'), /ya estaban cargados/);
  const sinCuentas = await iniciarDemo({ sql: [sql('01_esquema.sql')], usuarios: {}, sinPermisosPorDefecto: true });
  try {
    await rechazado(sinCuentas.db, sql('02_datos.sql'), /No encuentro las dos cuentas de prueba/);
    assert.equal((await sinCuentas.db.query('select count(*)::int as n from public.cv_sin_rls')).rows[0].n, 0);
  } finally {
    await sinCuentas.cerrar();
  }
});

test('ensayo: la limpieza deja el proyecto sin objetos cv_ y se puede volver a empezar', async () => {
  const d = await arrancar(['01_esquema.sql', '01b_storage_opcional.sql', '02_datos.sql']);
  try {
    await d.db.exec(sql('03_limpieza.sql'));
    const restos = await d.db.query(`select (select count(*) from pg_tables where schemaname = 'public')::int as tablas, (select count(*) from pg_views where schemaname = 'public')::int as vistas, (select count(*) from pg_policies where policyname like 'cv %')::int as politicas`);
    assert.deepEqual(restos.rows[0], { tablas: 0, vistas: 0, politicas: 0 });
    await d.db.exec(sql('01_esquema.sql'));
    await d.db.exec(sql('02_datos.sql'));
  } finally {
    await d.cerrar();
  }
});

test('validador: comprobaciones previas a cualquier petición', () => {
  const bueno = {
    CERROJO_VALIDACION_CONFIRMO: FRASE_DE_CONFIRMACION,
    CERROJO_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    CERROJO_CLAVE: `sb_publishable_${'a'.repeat(24)}`,
    CERROJO_A_CORREO: 'cerrojo-a@example.test', CERROJO_A_CONTRASENA: 'x',
    CERROJO_B_CORREO: 'yo+cerrojo-b@example.test', CERROJO_B_CONTRASENA: 'x',
  };
  assert.deepEqual(motivosParaNoEmpezar(bueno), []);
  assert.deepEqual(motivosParaNoEmpezar({ ...bueno, CERROJO_CLAVE: firmarJwt({ role: 'anon' }, 's') }), []);
  const rechaza = (cambio, patron) => assert.match(motivosParaNoEmpezar({ ...bueno, ...cambio }).join('\n'), patron, JSON.stringify(cambio));
  rechaza({ CERROJO_VALIDACION_CONFIRMO: 'si' }, /Falta la confirmación/);
  for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'https://abcdefghijklmnopqrst.supabase.co.evil.example', 'http://abcdefghijklmnopqrst.supabase.co', 'https://api.midominio.example', 'https://192.168.1.10', '']) {
    rechaza({ CERROJO_SUPABASE_URL: url }, /debe tener la forma/);
  }
  rechaza({ CERROJO_CLAVE: `sb_secret_${'a'.repeat(24)}` }, /clave SECRETA/);
  rechaza({ CERROJO_CLAVE: firmarJwt({ role: 'service_role' }, 's') }, /clave SECRETA/);
  rechaza({ CERROJO_CLAVE: 'cualquier-cosa' }, /debe ser la clave pública/);
  for (const correo of ['cliente.real@empresa.example', 'ana@cerrojo-a@empresa.example', 'ana@cerrojo-a.example', 'xcerrojo-a@example.test', 'cerrojo-a@', 'cerrojo-b@example.test']) {
    rechaza({ CERROJO_A_CORREO: correo }, /cuenta de prueba cerrojo-a@/);
  }
  rechaza({ CERROJO_B_CONTRASENA: '' }, /Falta CERROJO_B_CONTRASENA/);
});

test('validador: ejecutado sin configurar no hace ninguna petición y lo dice', () => {
  const limpio = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CERROJO_')));
  const r = spawnSync(process.execPath, [join(RAIZ, 'validacion', 'validar.js')], { encoding: 'utf8', env: limpio });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No se ha hecho ninguna petición/);
  assert.match(r.stderr, /Falta la confirmación/);
});

test('plantilla .env.example: solo nombres y valores ficticios', () => {
  const texto = sql('.env.example');
  const valores = Object.fromEntries(texto.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  for (const k of ['CERROJO_SUPABASE_URL', 'CERROJO_CLAVE', 'CERROJO_A_CORREO', 'CERROJO_A_CONTRASENA', 'CERROJO_B_CORREO', 'CERROJO_B_CONTRASENA', 'CERROJO_VALIDACION_CONFIRMO']) assert.ok(k in valores, k);
  // Tal cual está, la plantilla no debe servir para ejecutar nada.
  assert.notDeepEqual(motivosParaNoEmpezar(valores), []);
  assert.doesNotMatch(texto, /eyJ[A-Za-z0-9_-]{10,}\.|sb_secret_[A-Za-z0-9]|service_role\s*=/);
  assert.equal(valores.CERROJO_VALIDACION_CONFIRMO, '');
});

test('ensayo: "cerrojo web" sobre la página de validación da los hallazgos que anuncia el guion', async () => {
  const { crearPagina } = await import('../validacion/pagina.js');
  const { auditarWeb } = await import('../src/web.js');
  const pagina = crearPagina({ supabaseUrl: demo.url, clave: demo.claveAnon });
  await new Promise((ok) => pagina.listen(0, '127.0.0.1', ok));
  try {
    const r = await auditarWeb(`http://127.0.0.1:${pagina.address().port}/`, { cliente: new Cliente({ pausaMs: 0, permitirLocal: true }) });
    const legibles = Object.fromEntries(r.hallazgos.filter((h) => h.id === 'S-TABLA-LEGIBLE-ANON').map((h) => [h.datos.tabla, h.gravedad]));
    assert.deepEqual(legibles, { cv_marca: 'media', cv_sin_rls: 'critica', cv_vista_sin_invoker: 'alta' });
    assert.deepEqual(r.hallazgos.filter((h) => h.id === 'S-BUCKET-LISTABLE').map((h) => h.donde), ['storage/cv-listable']);
    assert.ok(!r.hallazgos.some((h) => h.id === 'S-ESQUEMA-PUBLICO' || h.id.startsWith('W-CLAVE') || h.id.startsWith('W-SECRETO')));
    // La tabla que no existe no figura; la que no tiene permisos sí, como "cerrada".
    assert.ok(!r.superficie.tablas.includes('cv_no_existe'));
    assert.equal(r.tablasEstado.cv_sin_permisos, 'denegado');
    assert.equal(r.tablasEstado.cv_no_existe, 'no_existe');
    // Sin la opción, la página local se rechaza.
    await assert.rejects(auditarWeb(`http://127.0.0.1:${pagina.address().port}/`, { cliente: new Cliente({ pausaMs: 0 }) }), /destino_bloqueado/);
  } finally {
    await new Promise((ok) => pagina.close(ok));
  }
});

// ───────────── Correcciones derivadas de la revisión independiente ─────────────

test('clave secreta: la herramienta la rechaza antes de hacer ninguna petición', async () => {
  let llamadas = 0;
  const cliente = () => new Cliente({ pausaMs: 0, fetch: async () => (llamadas++, new Response('[]')) });
  for (const clave of [`sb_secret_${'a'.repeat(24)}`, firmarJwt({ role: 'service_role' }, 's'), firmarJwt({ role: 'supabase_admin' }, 's')]) {
    await assert.rejects(probarAislamiento({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', clave, tablas: ['t'], usuarioA: CUENTAS.A, usuarioB: CUENTAS.B, cliente: cliente() }), /clave indicada es SECRETA/);
    await assert.rejects(auditarWeb('https://app.example/', { clave, cliente: cliente() }), /clave indicada es SECRETA/);
  }
  assert.equal(llamadas, 0);
  // Y por la línea de comandos, con las mismas variables que usa el guion.
  const r = spawnSync(process.execPath, [join(RAIZ, 'bin', 'cerrojo.js'), 'aislamiento', '--autorizo', '--tablas', 'cv_marca'], {
    encoding: 'utf8',
    env: { ...process.env, CERROJO_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', CERROJO_CLAVE: `sb_secret_${'a'.repeat(24)}`, CERROJO_A_CORREO: 'a@x.test', CERROJO_A_CONTRASENA: 'x', CERROJO_B_CORREO: 'b@x.test', CERROJO_B_CONTRASENA: 'x' },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /clave indicada es SECRETA/);
});

test('salvaguardas SQL: 01 no se ejecuta si hay vistas, cuentas ajenas o buckets; 03 exige la marca', async () => {
  const casos = [
    ['create view public.informe_ventas as select 1 as n', /tablas o vistas en "public"/],
    [`insert into auth.users (id, email) values ('dddddddd-4444-4444-8444-dddddddddddd', 'persona.real@empresa.example')`, /cuentas que no son las de prueba/],
    [`insert into storage.buckets (id, name) values ('documentos', 'documentos')`, /ya tiene buckets de Storage/],
  ];
  for (const [preparacion, patron] of casos) {
    const d = await iniciarDemo({ sql: [preparacion], usuarios: {}, sinPermisosPorDefecto: true });
    try {
      await rechazado(d.db, sql('01_esquema.sql'), patron);
      assert.equal((await d.db.query(`select count(*)::int as n from pg_tables where schemaname = 'public'`)).rows[0].n, 0, preparacion);
    } finally {
      await d.cerrar();
    }
  }
  // Una tabla llamada cv_marca que no contiene la marca no autoriza la limpieza.
  const impostor = await iniciarDemo({ sql: ['create table public.cv_marca (id int primary key, proposito text); create table public.cv_importante (id int)'], usuarios: {}, sinPermisosPorDefecto: true });
  try {
    await rechazado(impostor.db, sql('03_limpieza.sql'), /no está la marca de validación/);
    assert.equal((await impostor.db.query(`select count(*)::int as n from pg_tables where schemaname = 'public'`)).rows[0].n, 2);
  } finally {
    await impostor.cerrar();
  }
});

test('salvaguardas SQL: el paso de Storage se puede repetir tras la limpieza parcial', async () => {
  const d = await arrancar(['01_esquema.sql', '01b_storage_opcional.sql', '02_datos.sql']);
  try {
    await d.db.exec(sql('03_limpieza.sql')); // deja los buckets, como indica el guion
    await d.db.exec(sql('01_esquema.sql'));
    await d.db.exec(sql('01b_storage_opcional.sql'));
    assert.equal((await d.db.query('select count(*)::int as n from storage.buckets')).rows[0].n, 2);
    assert.equal((await d.db.query(`select count(*)::int as n from pg_policies where policyname = 'cv listar sin sesion'`)).rows[0].n, 1);
  } finally {
    await d.cerrar();
  }
});

test('registro de peticiones: los mensajes de error se guardan sin nada con forma de credencial', () => {
  const token = firmarJwt({ role: 'authenticated', sub: CUENTAS.A.id }, 's');
  const limpio = limpiarMensaje(`JWT inválido ${token} de ${CUENTAS.A.correo} (${CUENTAS.A.id}) con sb_publishable_${'k'.repeat(24)}`);
  assert.equal(limpio, 'JWT inválido [token] de [correo] ([uuid]) con [clave]');
  assert.equal(limpiarMensaje('permission denied for table cv_sin_permisos'), 'permission denied for table cv_sin_permisos');
  assert.ok(limpiarMensaje('x'.repeat(500)).length <= 160);
});

test('ensayo: el resultado de aislamiento sirve de entrada al informe', async () => {
  const r = await validar(demo);
  assert.equal(r.aislamiento.tipo, 'aislamiento');
  assert.equal(r.aislamiento.escrituraProbada, false);
  const html = generarInforme([r.aislamiento], { cliente: 'Validación' });
  assert.match(html, /cv_solo_sesion/);
  assert.match(html, /No se probó la escritura cruzada/);
});

test('validador local: solo admite la propia máquina y la clave pública', async () => {
  const { leerEstado, motivosLocales, ESPERADO_ESCRITURA } = await import('../validacion/local.js');
  const estado = leerEstado('API_URL="http://127.0.0.1:54321"\nDB_URL="postgresql://x"\nANON_KEY="clave-publica-local"\nSERVICE_ROLE_KEY="otra"\n');
  assert.deepEqual(estado, { url: 'http://127.0.0.1:54321', clave: 'clave-publica-local' });
  assert.deepEqual(motivosLocales(estado), []);
  assert.equal(leerEstado('API_URL=http://localhost:54321\nPUBLISHABLE_KEY=sb_publishable_local\nANON_KEY=vieja\n').clave, 'sb_publishable_local');
  for (const url of ['https://abcdefghijklmnopqrst.supabase.co', 'http://192.168.1.20:54321', 'http://10.0.0.5:54321', 'https://staging.midominio.example', undefined]) {
    assert.match(motivosLocales({ url, clave: 'x' }).join(' '), /nunca se ejecuta contra un proyecto alojado/, String(url));
  }
  assert.match(motivosLocales({ url: 'http://127.0.0.1:54321', clave: `sb_secret_${'a'.repeat(24)}` }).join(' '), /es la secreta/);
  assert.deepEqual(Object.keys(ESPERADO_ESCRITURA).sort(), ['cv_por_dueno', 'cv_sin_rls', 'cv_solo_sesion']);
  // Ejecutado contra un destino que no es local, no hace nada.
  const r = spawnSync(process.execPath, [join(RAIZ, 'validacion', 'local.js')], { encoding: 'utf8', env: { ...process.env, CERROJO_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', CERROJO_CLAVE: 'sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx' } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No se ha hecho nada/);
});

test('validador local: la prueba de escritura da lo esperado en el ensayo', async () => {
  const { ESPERADO_ESCRITURA } = await import('../validacion/local.js');
  const r = await probarAislamiento({ supabaseUrl: demo.url, clave: demo.claveAnon, tablas: Object.keys(ESPERADO_ESCRITURA), usuarioA: CUENTAS.A, usuarioB: CUENTAS.B, probarEscritura: true, baseDesechable: true, cliente: new Cliente({ pausaMs: 0, permitirLocal: true }) });
  assert.deepEqual(Object.fromEntries(r.matriz.map((m) => [m.tabla, m.escritura])), ESPERADO_ESCRITURA);
});
