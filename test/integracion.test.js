// Pruebas de integración contra la app ficticia: un PostgreSQL real (PGlite) con las
// políticas RLS de su migración, primero vulnerable y después con los arreglos aplicados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { iniciarDemo, firmarJwt } from '../demo/servidor.js';
import { auditarWeb } from '../src/web.js';
import { probarAislamiento } from '../src/aislamiento.js';
import { auditarRepo } from '../src/repo.js';
import { generarInforme } from '../src/informe.js';
import { Cliente } from '../src/http.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(RAIZ, 'demo', 'app-vulnerable');
const cliente = () => new Cliente({ pausaMs: 0 });
const ids = (r) => r.hallazgos.map((h) => `${h.id} ${h.donde}`).sort();
const tiene = (r, id, donde) => r.hallazgos.some((h) => h.id === id && (!donde || h.donde === donde));
const graves = (r) => r.hallazgos.filter((h) => h.gravedad === 'critica' || h.gravedad === 'alta');

let vulnerable;
let corregida;
const temporales = [];
before(async () => {
  vulnerable = await iniciarDemo();
  corregida = await iniciarDemo({ corregida: true });
});
after(async () => {
  await vulnerable.cerrar();
  await corregida.cerrar();
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

const aislar = (demo, web, extra = {}) =>
  probarAislamiento({
    supabaseUrl: web.supabase.url,
    clave: web.supabase.clavePublica,
    tablas: web.superficie.tablas,
    usuarioA: demo.usuarios.A,
    usuarioB: demo.usuarios.B,
    cliente: cliente(),
    ...extra,
  });

test('web (vulnerable): encuentra lo expuesto a un visitante sin sesión', async () => {
  const r = await auditarWeb(vulnerable.url, { cliente: cliente() });
  assert.equal(r.supabase.url, vulnerable.url);
  assert.ok(tiene(r, 'S-TABLA-LEGIBLE-ANON', 'public.integration_tokens'));
  assert.ok(tiene(r, 'S-TABLA-LEGIBLE-ANON', 'public.profiles'));
  assert.ok(tiene(r, 'S-TABLA-LEGIBLE-ANON', 'public.client_directory'), 'la vista sin security_invoker filtra datos');
  assert.ok(tiene(r, 'S-BUCKET-LISTABLE', 'storage/invoices-pdf'));
  assert.ok(tiene(r, 'W-SECRETO-TERCERO'));
  assert.ok(tiene(r, 'S-REGISTRO-SIN-VERIFICAR'));
  assert.ok(tiene(r, 'W-MAPAS-FUENTE'));
  assert.equal(r.hallazgos.find((h) => h.donde === 'public.integration_tokens').gravedad, 'critica');
});

test('web (vulnerable): no da falsos positivos', async () => {
  const r = await auditarWeb(vulnerable.url, { cliente: cliente() });
  // La app responde 200 con index.html a /.env, como cualquier SPA: no es un .env expuesto.
  assert.ok(!tiene(r, 'W-ENV-EXPUESTO'));
  assert.ok(!tiene(r, 'W-GIT-EXPUESTO'));
  assert.ok(!tiene(r, 'W-CLAVE-SERVICIO'), 'la clave anónima no es una clave de servicio');
  // Tablas protegidas frente a visitantes sin sesión.
  for (const t of ['clients', 'invoices', 'waitlist', 'audit_log']) assert.ok(!tiene(r, 'S-TABLA-LEGIBLE-ANON', `public.${t}`), t);
  // Una tabla que el código menciona pero no existe no aparece en la superficie.
  assert.ok(!r.superficie.tablas.includes('legacy_orders'));
  assert.deepEqual(r.superficie.rpc, ['is_admin']);
  assert.deepEqual(r.superficie.funciones, ['delete-account']);
});

test('aislamiento (vulnerable): RLS "activado" no impide leer ni modificar datos ajenos', async () => {
  const web = await auditarWeb(vulnerable.url, { cliente: cliente() });
  // "clients" pasa la comprobación sin sesión…
  assert.ok(!tiene(web, 'S-TABLA-LEGIBLE-ANON', 'public.clients'));
  const r = await aislar(vulnerable, web, { probarEscritura: true });
  // …pero un usuario registrado ve y modifica los clientes de otro.
  assert.ok(tiene(r, 'A-LECTURA-CRUZADA', 'public.clients'));
  assert.ok(tiene(r, 'A-ESCRITURA-CRUZADA', 'public.clients'));
  assert.ok(tiene(r, 'A-LECTURA-CRUZADA', 'public.profiles'));
  const clientes = r.hallazgos.find((h) => h.id === 'A-LECTURA-CRUZADA' && h.donde === 'public.clients');
  // Ana tiene 2 clientes, Bruno 3 y Carla 1: A ve 4 ajenos (3 de B); B ve 3 ajenos (2 de A).
  assert.deepEqual(clientes.datos.lecturas, [
    { quien: 'A', ajenas: 4, delOtro: 3 },
    { quien: 'B', ajenas: 3, delOtro: 2 },
  ]);
  // Las facturas tienen políticas correctas: se declaran aisladas, sin hallazgo.
  const facturas = r.matriz.find((m) => m.tabla === 'invoices');
  assert.equal(facturas.resultado, 'aislada');
  assert.equal(facturas.escritura, 'aislada');
  assert.ok(!r.hallazgos.some((h) => h.donde === 'public.invoices'));
});

test('aislamiento: la prueba de escritura no altera ningún dato', async () => {
  const antes = (await vulnerable.db.query('select md5(string_agg(c::text, \'|\' order by id)) as h from public.clients c')).rows[0].h;
  const web = await auditarWeb(vulnerable.url, { cliente: cliente() });
  await aislar(vulnerable, web, { probarEscritura: true });
  const despues = (await vulnerable.db.query('select md5(string_agg(c::text, \'|\' order by id)) as h from public.clients c')).rows[0].h;
  assert.equal(antes, despues);
});

test('privacidad: los resultados no contienen valores de las filas leídas', async () => {
  const web = await auditarWeb(vulnerable.url, { cliente: cliente() });
  const aislamiento = await aislar(vulnerable, web, { probarEscritura: true });
  const volcado = JSON.stringify([web, aislamiento]) + generarInforme([web, aislamiento]);
  for (const valor of ['token-ficticio', '600000003', 'clinica1@example.test', 'Bruno Ejemplo', 'ES0000000000000000000002', vulnerable.usuarios.B.id, vulnerable.usuarios.A.contrasena]) {
    assert.ok(!volcado.includes(valor), `no debería aparecer: ${valor}`);
  }
});

test('con los arreglos aplicados desaparecen los hallazgos graves (web y aislamiento)', async () => {
  const web = await auditarWeb(corregida.url, { cliente: cliente() });
  assert.deepEqual(graves(web), [], JSON.stringify(ids(web)));
  // Lo que queda es lo intencionadamente público.
  assert.ok(tiene(web, 'S-TABLA-LEGIBLE-ANON', 'public.plans'));
  assert.equal(web.hallazgos.find((h) => h.donde === 'public.plans').gravedad, 'media');
  assert.ok(!tiene(web, 'S-BUCKET-LISTABLE'));

  const r = await probarAislamiento({
    supabaseUrl: corregida.url,
    clave: corregida.claveAnon,
    tablas: ['profiles', 'clients', 'invoices', 'integration_tokens', 'client_directory'],
    usuarioA: corregida.usuarios.A,
    usuarioB: corregida.usuarios.B,
    probarEscritura: true,
    cliente: cliente(),
  });
  assert.deepEqual(r.hallazgos, [], JSON.stringify(ids(r)));
  for (const t of ['profiles', 'clients', 'invoices']) assert.equal(r.matriz.find((m) => m.tabla === t).resultado, 'aislada', t);
});

test('aislamiento: credenciales incorrectas dan un error claro', async () => {
  await assert.rejects(
    probarAislamiento({ supabaseUrl: vulnerable.url, clave: vulnerable.claveAnon, tablas: ['clients'], usuarioA: { correo: 'nadie@x.test', contrasena: 'mal' }, usuarioB: vulnerable.usuarios.B, cliente: cliente() }),
    /usuario A/,
  );
});

test('repo (vulnerable): encuentra los fallos de las migraciones y del código', () => {
  const r = auditarRepo(APP);
  for (const [id, donde] of [
    ['R-SIN-RLS', 'public.integration_tokens'],
    ['R-POLITICA-LECTURA-ABIERTA', 'public.profiles'],
    ['R-POLITICA-SOLO-AUTENTICADO', 'public.clients'],
    ['R-POLITICA-METADATOS-USUARIO', 'public.invoices'],
    ['R-COLUMNA-PRIVILEGIO-EDITABLE', 'public.profiles'],
    ['R-VISTA-SIN-INVOKER', 'public.client_directory'],
    ['R-FUNCION-DEFINER', 'public.is_admin'],
    ['R-BUCKET-PUBLICO', 'storage/invoices-pdf'],
    ['R-RLS-SIN-POLITICAS', 'public.audit_log'],
    ['C-ENV-PUBLICA-SECRETA', 'src/integrations/supabase/client.ts'],
    ['C-FUNCION-SERVICIO-SIN-AUTH', 'supabase/functions/delete-account/index.ts'],
    ['C-ADMIN-EN-CLIENTE', 'src/hooks/useAdmin.ts'],
    ['C-HTML-SIN-SANEAR', 'src/pages/ClientNotes.tsx'],
  ]) {
    assert.ok(tiene(r, id, donde), `${id} ${donde}\n${ids(r).join('\n')}`);
  }
  // Sin falsos positivos: facturas bien protegidas y el webhook que valida su firma.
  assert.ok(!tiene(r, 'R-SIN-RLS', 'public.invoices'));
  assert.ok(!tiene(r, 'R-POLITICA-SOLO-AUTENTICADO', 'public.invoices'));
  assert.ok(!tiene(r, 'C-FUNCION-SERVICIO-SIN-AUTH', 'supabase/functions/stripe-webhook/index.ts'));
  const webhooks = r.hallazgos.filter((h) => h.id === 'C-FUNCION-SIN-JWT');
  assert.equal(webhooks.find((h) => h.datos.funcion === 'stripe-webhook').gravedad, 'info');
  assert.equal(webhooks.find((h) => h.datos.funcion === 'delete-account').gravedad, 'media');
  assert.equal(r.inventario.length, 7);
});

test('repo: con la migración de arreglos desaparecen los hallazgos de RLS', () => {
  const copia = mkdtempSync(join(tmpdir(), 'cerrojo-'));
  temporales.push(copia);
  cpSync(APP, copia, { recursive: true });
  copyFileSync(join(RAIZ, 'demo', 'arreglos.sql'), join(copia, 'supabase', 'migrations', '20260915100000_arreglos.sql'));
  const r = auditarRepo(copia);
  for (const id of ['R-SIN-RLS', 'R-POLITICA-SOLO-AUTENTICADO', 'R-POLITICA-METADATOS-USUARIO', 'R-COLUMNA-PRIVILEGIO-EDITABLE', 'R-VISTA-SIN-INVOKER', 'R-FUNCION-DEFINER']) {
    assert.ok(!tiene(r, id), `${id} debería haber desaparecido\n${ids(r).join('\n')}`);
  }
  assert.ok(!tiene(r, 'R-POLITICA-LECTURA-ABIERTA', 'public.profiles'));
  assert.ok(!tiene(r, 'R-BUCKET-PUBLICO', 'storage/invoices-pdf'));
  // Lo intencionadamente público sigue señalándose para que alguien lo confirme.
  assert.ok(tiene(r, 'R-POLITICA-LECTURA-ABIERTA', 'public.plans'));
});

test('repo: secretos escritos en el código y .env versionado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cerrojo-'));
  temporales.push(dir);
  const servicio = firmarJwt({ iss: 'supabase', role: 'service_role', exp: 2000000000 }, 'x');
  writeFileSync(join(dir, 'admin.ts'), `// arriba\n\nexport const admin = createClient(url, "${servicio}");\n`);
  writeFileSync(join(dir, '.env'), 'VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\nRESEND_TOKEN=valor-inventado\n');
  writeFileSync(join(dir, '.env.example'), 'RESEND_TOKEN=\n');
  const r = auditarRepo(dir);
  const secreto = r.hallazgos.find((h) => h.id === 'C-SECRETO-EN-REPO');
  assert.equal(secreto.datos.linea, 3);
  assert.ok(!JSON.stringify(r).includes(servicio));
  const env = r.hallazgos.filter((h) => h.id === 'C-ENV-EN-GIT');
  assert.equal(env.length, 1, 'el .env.example no cuenta');
  assert.equal(env[0].gravedad, 'alta');
  assert.ok(r.notas.some((n) => /No hay archivos .sql/.test(n.es)));

  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.env\n');
  assert.ok(!tiene(auditarRepo(dir), 'C-ENV-EN-GIT'), 'si está en .gitignore no se señala');
});

test('CLI: sin --autorizo no se hace ninguna petición', () => {
  const r = spawnSync(process.execPath, [join(RAIZ, 'bin', 'cerrojo.js'), 'web', vulnerable.url], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /autorización escrita/);
});

// El servidor de la demo vive en este mismo proceso: la CLI debe lanzarse de forma asíncrona
// (spawnSync bloquearía el bucle de eventos y el servidor no podría responder).
function ejecutar(args, env = {}) {
  return new Promise((resolver) => {
    const hijo = spawn(process.execPath, [join(RAIZ, 'bin', 'cerrojo.js'), ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    hijo.stdout.on('data', (d) => (stdout += d));
    hijo.stderr.on('data', (d) => (stderr += d));
    hijo.on('close', (status) => resolver({ status, stdout, stderr }));
  });
}

test('CLI: flujo completo web → aislamiento → repo → informe', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cerrojo-'));
  temporales.push(dir);
  const { A, B } = vulnerable.usuarios;

  const web = await ejecutar(['web', vulnerable.url, '--autorizo', '--ci', '--salida', join(dir, 'web.json')]);
  assert.equal(web.status, 1, web.stderr); // --ci: hay hallazgos graves
  assert.equal(JSON.parse(readFileSync(join(dir, 'web.json'), 'utf8')).autorizacion.declarada, true);
  const aislamiento = await ejecutar(['aislamiento', '--autorizo', '--desde', join(dir, 'web.json'), '--probar-escritura', '--salida', join(dir, 'aislamiento.json')], {
    CERROJO_A_CORREO: A.correo, CERROJO_A_CONTRASENA: A.contrasena, CERROJO_B_CORREO: B.correo, CERROJO_B_CONTRASENA: B.contrasena,
  });
  assert.equal(aislamiento.status, 0, aislamiento.stderr);
  assert.match(aislamiento.stdout, /modificar filas de otros usuarios/);
  const repo = await ejecutar(['repo', APP, '--salida', join(dir, 'repo.json')]);
  assert.equal(repo.status, 0, repo.stderr);
  const informe = await ejecutar(['informe', join(dir, 'web.json'), join(dir, 'aislamiento.json'), join(dir, 'repo.json'), '--idioma', 'en', '--cliente', 'ACME', '--salida', join(dir, 'informe.html')]);
  assert.equal(informe.status, 0, informe.stderr);
  const html = readFileSync(join(dir, 'informe.html'), 'utf8');
  assert.match(html, /Security audit report/);
  assert.match(html, /ACME/);
});
