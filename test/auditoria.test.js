// Pruebas que reproducen los hallazgos de la auditoría crítica del código (revisión
// independiente con Antigravity) y comprueban que quedan corregidos. Los más graves eran
// falsos negativos: situaciones en las que el informe salía limpio habiendo una fuga.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { extraer } from '../src/extraer.js';
import { dividirSentencias, modeloVacio, aplicarMigracion, normalizar, clasificarCondicion, esSiempreCierta, soloExigeSesion } from '../src/sql.js';
import { auditarRepo } from '../src/repo.js';
import { auditarWeb, atributosDeEtiquetas } from '../src/web.js';
import { probarAislamiento } from '../src/aislamiento.js';
import { generarInforme, resumenTexto } from '../src/informe.js';
import { Cliente } from '../src/http.js';
import { categoriasSensibles, gravedadPorCategorias, sinControl } from '../src/util.js';
import { iniciarDemo, firmarJwt } from '../demo/servidor.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const temporales = [];
const servidores = [];
after(async () => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
  for (const s of servidores) await new Promise((ok) => (s.closeAllConnections?.(), s.close(ok)));
});

/** Repositorio temporal con una migración y, si se quiere, más archivos. */
function repoCon(sql, archivos = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cerrojo-'));
  temporales.push(dir);
  mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true });
  if (sql != null) writeFileSync(join(dir, 'supabase', 'migrations', '1.sql'), sql);
  for (const [ruta, texto] of Object.entries(archivos)) {
    mkdirSync(dirname(join(dir, ruta)), { recursive: true });
    writeFileSync(join(dir, ruta), texto);
  }
  return dir;
}
const ids = (r) => r.hallazgos.map((h) => `${h.id} ${h.donde}`);
const tiene = (r, id, donde) => r.hallazgos.some((h) => h.id === id && (!donde || h.donde === donde));
// En integración continua las máquinas son más lentas: lo que se comprueba es que el coste no
// sea cuadrático (segundos frente a minutos), no una cifra exacta.
const HOLGURA = process.env.CI ? 5 : 1;
const rapido = (nombre, fn, maxMs = 2000) => {
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  assert.ok(ms < maxMs * HOLGURA, `${nombre}: ${Math.round(ms)} ms (máximo ${maxMs * HOLGURA})`);
};
const TABLA = 'create table public.t (id uuid, user_id uuid, nota text); alter table public.t enable row level security;';

// ───────────── Falsos negativos en políticas ─────────────

test('política: USING correcto con WITH CHECK (true) se detecta', () => {
  const r = auditarRepo(repoCon(`${TABLA} create policy p on public.t for all using (auth.uid() = user_id) with check (true);`));
  const h = r.hallazgos.find((x) => x.id === 'R-POLITICA-ESCRITURA-ABIERTA');
  assert.ok(h, ids(r).join('\n'));
  assert.match(h.datos.expresion, /with check \(true\)/);
  // Y con UPDATE limitado a usuarios registrados.
  const r2 = auditarRepo(repoCon(`${TABLA} create policy p on public.t for update to authenticated using (auth.uid() = user_id) with check (true);`));
  assert.ok(tiene(r2, 'R-POLITICA-SOLO-AUTENTICADO', 'public.t'), ids(r2).join('\n'));
  // Sin WITH CHECK, UPDATE hereda el USING: no hay hallazgo.
  const r3 = auditarRepo(repoCon(`${TABLA} create policy p on public.t for update to authenticated using (auth.uid() = user_id);`));
  assert.deepEqual(ids(r3).filter((x) => x.startsWith('R-POLITICA')), []);
});

test('política: formas equivalentes de "true" y de "solo sesión"', () => {
  for (const e of ['true', '(true)', '( (TRUE) )', '1 = 1', '(select true)', '(true)::boolean', 'true::bool', 'auth.uid() = user_id OR true', 'NOT false']) {
    assert.ok(esSiempreCierta(e), `debería ser siempre cierta: ${e}`);
  }
  for (const e of [
    'auth.uid() is not null',
    '(select auth.uid()) IS NOT NULL',
    'auth.uid() IS NOT NULL OR false',
    "(auth.jwt() ->> 'sub') IS NOT NULL",
    "(select auth.jwt() ->> 'role') = 'authenticated'",
    "auth.role() = 'authenticated'",
    'user_id = auth.uid() or auth.uid() is not null',
    'true and auth.uid() is not null',
  ]) {
    assert.ok(soloExigeSesion(e), `debería contar como "solo sesión": ${e}`);
  }
  for (const e of ['auth.uid() = user_id', '(select auth.uid()) = user_id', 'auth.uid() is not null and auth.uid() = user_id', "status similar to 'a%' and assigned_to = auth.uid()", 'false', 'user_id = auth.uid() or false']) {
    assert.ok(!esSiempreCierta(e) && !soloExigeSesion(e), `no debería marcarse: ${e}`);
  }
  assert.equal(clasificarCondicion(null), 'cierta', 'sin condición equivale a true');
});

test('política: las tautologías se detectan en una migración real', () => {
  const r = auditarRepo(
    repoCon(`${TABLA}
      create policy p1 on public.t for select using ((select true));
      create policy p2 on public.t for all to authenticated using ((auth.jwt() ->> 'sub') is not null);`),
  );
  assert.ok(tiene(r, 'R-POLITICA-LECTURA-ABIERTA', 'public.t'), ids(r).join('\n'));
  assert.ok(tiene(r, 'R-POLITICA-SOLO-AUTENTICADO', 'public.t'), ids(r).join('\n'));
});

test('migraciones: RLS desactivado o políticas sobre tablas creadas desde el panel', () => {
  const r = auditarRepo(repoCon(`alter table public.users disable row level security; create policy abierta on public.orders for select using (true);`));
  assert.ok(tiene(r, 'R-RLS-DESACTIVADO', 'public.users'), ids(r).join('\n'));
  assert.ok(tiene(r, 'R-POLITICA-LECTURA-ABIERTA', 'public.orders'), ids(r).join('\n'));
  assert.ok(r.avisos.some((a) => /no crean \(.*users.*\)/.test(a.es) || /no crean \(.*orders.*\)/.test(a.es)), JSON.stringify(r.avisos));
});

test('migraciones: CREATE TABLE AS, particiones, vistas materializadas y comentarios anidados', () => {
  const r = auditarRepo(
    repoCon(`
      create table public.copia as select * from auth.users;
      create table public.eventos_2026 partition of public.eventos for values from ('2026-01-01') to ('2027-01-01');
      create materialized view public.resumen as select * from auth.users;
      /* fuera /* dentro */ sigue siendo comentario */ create table public.tras_comentario (id int);
      create temp table borrador (id int);`),
  );
  for (const t of ['public.copia', 'public.eventos_2026', 'public.tras_comentario']) assert.ok(tiene(r, 'R-SIN-RLS', t), `${t}\n${ids(r).join('\n')}`);
  assert.ok(tiene(r, 'R-VISTA-SIN-INVOKER', 'public.resumen'));
  assert.ok(!ids(r).some((x) => x.includes('borrador')), 'las tablas temporales no se exponen');
});

test('migraciones: ALTER POLICY, varias acciones en un ALTER TABLE y FORCE sin ENABLE', () => {
  const m = aplicarMigracion(
    modeloVacio(),
    `create table public.a (id int); create table public.b (id int); create table public.c (id int);
     alter table public.a add column x numeric(10, 2), enable row level security, force row level security;
     alter table public.b force row level security;
     alter table public.c enable row level security, disable row level security;
     create policy "p ""uno""" on public.a for select to authenticated using (auth.uid() is not null);
     alter policy "p ""uno""" on public.a to public;
     alter policy "p ""uno""" on public.a rename to dos;`,
    'm.sql',
  );
  assert.equal(m.tablas.get('public.a').rls, true);
  assert.deepEqual(m.tablas.get('public.a').columnas, ['id', 'x']);
  assert.equal(m.tablas.get('public.b').rls, false, 'FORCE no activa RLS por sí solo');
  assert.equal(m.tablas.get('public.c').rls, false, 'la última acción manda');
  assert.deepEqual(m.tablas.get('public.a').politicas.map((p) => [p.nombre, p.roles]), [['dos', ['public']]]);
});

test('columnas de privilegio: un trigger de updated_at o un REVOKE parcial no ocultan el hallazgo', () => {
  const base = `create table public.profiles (id uuid, role text, updated_at timestamptz); alter table public.profiles enable row level security;
    create policy u on public.profiles for update to authenticated using (auth.uid() = id);`;
  const con = (extra) => tiene(auditarRepo(repoCon(base + extra)), 'R-COLUMNA-PRIVILEGIO-EDITABLE', 'public.profiles');
  assert.ok(con(''), 'caso base');
  assert.ok(con('create trigger set_updated_at before update on public.profiles for each row execute function moddatetime(updated_at);'), 'trigger de updated_at');
  assert.ok(con('revoke update on public.profiles from anon;'), 'revocar a anon no protege a authenticated');
  assert.ok(con('grant update (role) on public.profiles to authenticated;'), 'conceder la columna no la protege');
  assert.ok(con('revoke update on public.profiles from authenticated; grant update (role, updated_at) on public.profiles to authenticated;'), 'revocar y devolver role');
  assert.ok(!con('revoke update on public.profiles from authenticated; grant update (updated_at) on public.profiles to authenticated;'), 'revocar y no devolver role sí protege');
  // Un trigger que no es de fechas baja la gravedad y se nombra, pero no se calla.
  const r = auditarRepo(repoCon(`${base} create trigger proteger_rol before update on public.profiles for each row execute function impedir_cambio_de_rol();`));
  const h = r.hallazgos.find((x) => x.id === 'R-COLUMNA-PRIVILEGIO-EDITABLE');
  assert.equal(h.gravedad, 'media');
  assert.deepEqual(h.datos.disparadores, ['proteger_rol']);
});

// ───────────── Errores que parecían "tabla protegida" ─────────────

/** Servidor que imita a Supabase lo justo para provocar respuestas anómalas en una tabla. */
async function supabaseAveriado(responder) {
  const exp = 2_000_000_000;
  const anon = firmarJwt({ role: 'anon', exp }, 's');
  const s = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (estado, cuerpo, cab = {}) => res.writeHead(estado, { 'Content-Type': 'application/json', ...cab }).end(JSON.stringify(cuerpo));
    if (u.pathname === '/auth/v1/settings') return json(200, { disable_signup: false, mailer_autoconfirm: false });
    if (u.pathname === '/auth/v1/token') {
      let d = '';
      req.on('data', (c) => (d += c));
      return req.on('end', () => json(200, { access_token: firmarJwt({ role: 'authenticated', sub: JSON.parse(d).email }, 's'), user: { id: JSON.parse(d).email === 'a@x.test' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222' } }));
    }
    if (u.pathname === '/rest/v1/') return json(401, { message: 'no' });
    if (u.pathname.startsWith('/rest/v1/')) return responder(u.pathname.slice(9), json, res);
    if (u.pathname === '/app.js') return res.end(`const s=createClient("http://127.0.0.1:${s.address().port}","${anon}");s.from("averiada");s.from("sana");`);
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<script src="/app.js"></script>');
  });
  servidores.push(s);
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${s.address().port}`, anon };
}
const local = () => new Cliente({ pausaMs: 0, permitirLocal: true });
const cuentas = { usuarioA: { correo: 'a@x.test', contrasena: 'x' }, usuarioB: { correo: 'b@x.test', contrasena: 'x' } };

test('errores del servidor (429, 500, respuesta que no es una lista) no cuentan como tabla protegida', async () => {
  for (const averia of [(json) => json(429, { message: 'rate limit' }), (json) => json(500, { message: 'boom' }), (json) => json(200, { no: 'es una lista' }), (_j, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end('[{"id":1},')]) {
    const sb = await supabaseAveriado((tabla, json, res) => (tabla === 'averiada' ? averia(json, res) : json(200, [], { 'Content-Range': '*/0' })));
    const web = await auditarWeb(sb.url, { cliente: local() });
    assert.equal(web.tablasEstado.averiada, 'error');
    assert.ok(web.avisos.some((a) => /No se pudo comprobar.*averiada/.test(a.es)), JSON.stringify(web.avisos));
    const superada = web.superadas.find((s) => /Sin sesión no se obtiene ninguna fila/.test(s.es));
    assert.ok(superada && /sana/.test(superada.es) && !/averiada/.test(superada.es), JSON.stringify(web.superadas));

    const ais = await probarAislamiento({ supabaseUrl: sb.url, clave: sb.anon, tablas: ['averiada', 'sana'], ...cuentas, cliente: local() });
    assert.equal(ais.matriz.find((m) => m.tabla === 'averiada').resultado, 'error');
    assert.ok(ais.avisos.some((a) => /No se pudo comprobar.*averiada/.test(a.es)));
    assert.match(generarInforme([web, ais]), /Resultado NO concluyente/);
  }
});

test('una respuesta cortada por tamaño es un error, no "sin filas"', async () => {
  const fila = JSON.stringify({ id: 1, user_id: '22222222-2222-4222-8222-222222222222', relleno: 'x'.repeat(30_000) });
  const cuerpo = `[${Array(1000).fill(fila).join(',')}]`; // ~30 MB: supera el tope de lectura
  const sb = await supabaseAveriado((_t, _json, res) => res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': '0-999/1000' }).end(cuerpo));
  const ais = await probarAislamiento({ supabaseUrl: sb.url, clave: sb.anon, tablas: ['averiada'], ...cuentas, cliente: local() });
  assert.equal(ais.matriz[0].resultado, 'error');
  assert.equal(ais.hallazgos.length, 0);
  assert.ok(ais.avisos.some((a) => /--limite menor/.test(a.es)));
});

test('filas nulas o raras en la respuesta no rompen la prueba', async () => {
  const B = '22222222-2222-4222-8222-222222222222';
  const sb = await supabaseAveriado((_t, json) => json(200, [null, 7, 'x', [], { id: 1, user_id: B }], { 'Content-Range': '0-4/5' }));
  const ais = await probarAislamiento({ supabaseUrl: sb.url, clave: sb.anon, tablas: ['averiada'], ...cuentas, cliente: local() });
  assert.equal(ais.matriz[0].resultado, 'fuga'); // A ve la fila de B
});

// ───────────── Heurística de propiedad ─────────────

function fetchFalso(filasPorCuenta) {
  const id = { 'a@x.test': '11111111-1111-4111-8111-111111111111', 'b@x.test': '22222222-2222-4222-8222-222222222222' };
  return {
    id,
    f: async (url, init) => {
      const u = new URL(url);
      if (u.pathname === '/auth/v1/token') {
        const { email } = JSON.parse(init.body);
        return new Response(JSON.stringify({ access_token: `t-${email}`, user: { id: id[email] } }));
      }
      const filas = filasPorCuenta(id)[init.headers.Authorization.slice(9)] ?? [];
      return new Response(JSON.stringify(filas), { headers: { 'Content-Range': filas.length ? `0-${filas.length - 1}/${filas.length}` : '*/0' } });
    },
  };
}
const aislar = (filasPorCuenta) => {
  const { f } = fetchFalso(filasPorCuenta);
  return probarAislamiento({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', clave: `sb_publishable_${'k'.repeat(24)}`, tablas: ['tickets'], ...cuentas, cliente: new Cliente({ pausaMs: 0, fetch: f }) });
};

test('aislamiento: aparecer en updated_by no convierte una fila ajena en propia', async () => {
  const r = await aislar((id) => {
    const deA = { id: 1, user_id: id['a@x.test'], updated_by: id['b@x.test'] }; // B solo la editó
    return { 'a@x.test': [deA], 'b@x.test': [deA] };
  });
  assert.deepEqual(r.hallazgos.map((h) => h.id), ['A-LECTURA-CRUZADA']);
  assert.deepEqual(r.hallazgos[0].datos.lecturas, [{ quien: 'B', ajenas: 1, delOtro: 1 }]);
});

test('aislamiento: se prefiere user_id a created_by, y las filas sin dueño se avisan', async () => {
  const r = await aislar((id) => {
    const filas = [
      { id: 1, created_by: id['b@x.test'], user_id: id['a@x.test'] }, // creada por B para A: es de A
      { id: 2, created_by: id['a@x.test'], user_id: null },
    ];
    return { 'a@x.test': filas, 'b@x.test': [] };
  });
  assert.equal(r.matriz[0].columnaDueno, 'user_id');
  assert.equal(r.hallazgos.length, 0);
  assert.ok(r.avisos.some((a) => /1 fila\(s\) visibles con la columna de dueño \(user_id\) vacía/.test(a.es)), JSON.stringify(r.avisos));
});

test('aislamiento: lo compartido legítimamente no es fuga, pero queda anotado', async () => {
  const r = await aislar((id) => {
    const m = { id: 1, user_id: id['b@x.test'], shared_with: id['a@x.test'] };
    return { 'a@x.test': [m], 'b@x.test': [m] };
  });
  assert.equal(r.hallazgos.length, 0);
  assert.ok(r.notas.some((n) => /NO se cuentan como fuga/.test(n.es)));
});

// ───────────── Descubrimiento en la web ─────────────

test('extraer: supabase?.from, prefijo public. y rutas de trozos con varias carpetas', () => {
  const r = extraer(`supabase?.from('users');db.from("public.orders");x.storage.from('mis-docs');const a="./chunks/vendor/api-1a2b.js";`, 'a.js');
  assert.deepEqual([...r.tablas].sort(), ['orders', 'users']);
  assert.deepEqual([...r.buckets], ['mis-docs']);
});

test('web: con una clave de ejemplo suelta en el código se usa la que el proyecto acepta', async () => {
  const demo = await iniciarDemo();
  const pagina = createServer((req, res) =>
    req.url === '/app.js'
      ? res.end(`const ejemplo="sb_publishable_${'e'.repeat(24)}";const s=createClient("${demo.url}","${demo.claveAnon}");s.from("profiles");import("./chunks/extra/mas.js");`)
      : req.url === '/chunks/extra/mas.js'
        ? res.end('s.from("integration_tokens")')
        : res.writeHead(200, { 'Content-Type': 'text/html' }).end('<script src="/app.js"></script>'),
  );
  servidores.push(pagina);
  await new Promise((ok) => pagina.listen(0, '127.0.0.1', ok));
  try {
    const r = await auditarWeb(`http://127.0.0.1:${pagina.address().port}/`, { cliente: local() });
    assert.equal(r.supabase.claveTipo, 'anon-jwt');
    assert.ok(!r.avisos.some((a) => /RECHAZA/.test(a.es)), JSON.stringify(r.avisos));
    assert.ok(tiene(r, 'S-TABLA-LEGIBLE-ANON', 'public.profiles'));
    assert.ok(tiene(r, 'S-TABLA-LEGIBLE-ANON', 'public.integration_tokens'), 'la tabla del trozo en ./chunks/extra/ también se descubre');
  } finally {
    await demo.cerrar();
  }
});

test('web: un sourceMappingURL inválido o una etiqueta rara no rompen el análisis', async () => {
  const s = createServer((req, res) => (req.url === '/app.js' ? res.end('console.log(1)\n//# sourceMappingURL=http://[') : res.writeHead(200, { 'Content-Type': 'text/html' }).end('<script src="/app.js"></script><script src="http://[mal"></script><link rel=modulepreload>')));
  servidores.push(s);
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const r = await auditarWeb(`http://127.0.0.1:${s.address().port}/`, { cliente: local() });
  assert.ok(r.avisos.some((a) => /No se detectó un proyecto de Supabase/.test(a.es)));
});

// ───────────── Coste lineal con entradas hostiles ─────────────

test('rendimiento: extraer no se degrada con archivos de varios MB hechos para atascarlo', () => {
  rapido("'eyJ' repetido", () => extraer('eyJ'.repeat(1_000_000), 'a.js'));
  rapido("'sk-' repetido", () => extraer('sk-'.repeat(1_000_000), 'a.js'));
  rapido('identificador enorme antes de .from(', () => extraer(`${'a'.repeat(2_000_000)}.from("x"`, 'a.js'));
  rapido("'.from(' repetido", () => extraer('.from('.repeat(500_000), 'a.js'));
  rapido('createClient( repetido', () => extraer('createClient("http://a'.repeat(150_000), 'a.js'));
  rapido('sourceMappingURL repetido', () => extraer('//# sourceMappingURL='.repeat(150_000), 'a.js'));
  rapido('JWT enorme', () => extraer(`eyJ${'a'.repeat(1_500_000)}.eyJ${'b'.repeat(1_500_000)}.c`, 'a.js'));
  // Y sigue encontrando lo que hay en un archivo grande y normal.
  const anon = firmarJwt({ role: 'anon', exp: 2e9 }, 's');
  const r = extraer(`${'var a=1;'.repeat(300_000)}createClient("https://abcdefghijklmnopqrst.supabase.co","${anon}");s.from("pedidos")`, 'a.js');
  assert.deepEqual([...r.tablas], ['pedidos']);
  assert.equal(r.clavesPublicas.length, 1);
});

test('rendimiento: el análisis de etiquetas HTML está acotado', () => {
  rapido('<link modulepreload sin cerrar', () => atributosDeEtiquetas('<link rel="modulepreload" '.repeat(100_000), 'link', 'href', /modulepreload/i));
  rapido('<script sin cerrar', () => atributosDeEtiquetas('<script '.repeat(350_000), 'script', 'src'));
  rapido('<script con > al final', () => atributosDeEtiquetas(`${'<script '.repeat(350_000)}>`, 'script', 'src'));
  assert.deepEqual(atributosDeEtiquetas('<SCRIPT type="module" crossorigin SRC="/a.js"></script><script>x</script><script src=\'/b.js\'>', 'script', 'src'), ['/a.js', '/b.js']);
});

test('rendimiento: el análisis de SQL es lineal', () => {
  const m = () => modeloVacio();
  rapido('$etiquetas$ sin cerrar', () => aplicarMigracion(m(), `create function f() ${Array.from({ length: 150_000 }, (_, i) => `$a${i}$`).join('')}`, 'm.sql'));
  rapido('update storage.buckets', () => aplicarMigracion(m(), `update storage.buckets set ${'public=true '.repeat(350_000)}`, 'm.sql'));
  rapido('create trigger', () => aplicarMigracion(m(), `create trigger t before ${'update '.repeat(200_000)}`, 'm.sql'));
  rapido('trigger corto y ambiguo', () => aplicarMigracion(m(), `create trigger t before ${'update or '.repeat(55)}x`, 'm.sql'));
  rapido('paréntesis anidados', () => normalizar('('.repeat(100_000) + 'true' + ')'.repeat(100_000)));
  rapido('política con condición enorme', () => aplicarMigracion(m(), `create table t (id int); create policy p on t using (${'(a or '.repeat(20_000)}true${')'.repeat(20_000)});`, 'm.sql'));
  rapido('comillas sin cerrar', () => dividirSentencias(`select '${'a;'.repeat(1_000_000)}`));
  rapido('2 MB de sentencias normales', () => {
    const modelo = aplicarMigracion(m(), 'create table public.x (id int); alter table public.x enable row level security;\n'.repeat(25_000), 'm.sql');
    assert.equal(modelo.tablas.get('public.x').rls, true);
  }, 4000);
});

// ───────────── Robustez del análisis de repositorio ─────────────

test('repo: una tubería con nombre o un enlace simbólico no cuelgan ni se siguen', { timeout: 10_000 }, () => {
  const dir = repoCon(TABLA, { 'supabase/config.toml': '[functions.f]\nverify_jwt = false\n', 'secreto-fuera.txt': 'x' });
  const fifo = spawnSync('mkfifo', [join(dir, '.gitignore')]);
  if (fifo.status !== 0) return; // sin mkfifo no se puede probar
  mkdirSync(join(dir, 'supabase', 'functions', 'f'), { recursive: true });
  symlinkSync(join(dir, 'secreto-fuera.txt'), join(dir, 'supabase', 'functions', 'f', 'index.ts'));
  const r = auditarRepo(dir);
  assert.ok(tiene(r, 'C-FUNCION-SIN-JWT'));
});

test('repo: config.toml en una subcarpeta (monorepo) encuentra sus funciones', () => {
  const dir = repoCon(null, {
    'apps/web/supabase/config.toml': '[functions.webhook]\nverify_jwt = false\n',
    'apps/web/supabase/functions/webhook/index.ts': 'await stripe.webhooks.constructEventAsync(cuerpo, firma, secreto)',
  });
  assert.equal(auditarRepo(dir).hallazgos.find((h) => h.id === 'C-FUNCION-SIN-JWT').gravedad, 'info');
});

// ───────────── Falsos positivos ─────────────

test('falsos positivos: identificadores "sk-…", variables públicas inofensivas y columnas de recuento', () => {
  assert.deepEqual(extraer('<div class="sk-navigation-menu-viewport-container-wrapper sk-button-primary-outline-large-rounded-xl">', 'a.html').secretos, []);
  assert.equal(extraer(`const k="sk-proj-${'Ab12'.repeat(10)}"`, 'a.js').secretos.length, 1);

  const dir = repoCon(null, {
    'src/config.ts': 'const a = import.meta.env.VITE_PASSWORD_RESET_URL; const b = process.env.NEXT_PUBLIC_OPENAI_MODEL; const c = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;',
    'src/malo.ts': 'const k = import.meta.env.VITE_OPENAI_API_KEY; const s = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;',
  });
  const publicas = auditarRepo(dir).hallazgos.filter((h) => h.id === 'C-ENV-PUBLICA-SECRETA').map((h) => h.datos.variable).sort();
  assert.deepEqual(publicas, ['NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY', 'VITE_OPENAI_API_KEY']);

  assert.equal(gravedadPorCategorias(categoriasSensibles(['plans', 'id', 'stripe_price_id', 'max_tokens', 'monthly_price'])), 'media');
  assert.equal(gravedadPorCategorias(categoriasSensibles(['api_keys', 'id', 'access_token'])), 'critica');
});

test('falsos positivos: un .env que está en .gitignore (también como "/.env") no se analiza', () => {
  const secreto = `sk_live_${'Ab12'.repeat(7)}`;
  for (const ignorar of ['.env\n', '/.env\n', 'node_modules\n.env*\n']) {
    const r = auditarRepo(repoCon(null, { '.env': `STRIPE_SECRET_KEY=${secreto}\n`, '.gitignore': ignorar }));
    assert.deepEqual(ids(r).filter((x) => x.startsWith('C-')), [], ignorar);
  }
  const versionado = auditarRepo(repoCon(null, { '.env': `STRIPE_SECRET_KEY=${secreto}\n`, '.gitignore': 'node_modules\n' }));
  assert.ok(tiene(versionado, 'C-ENV-EN-GIT') && tiene(versionado, 'C-SECRETO-EN-REPO'));
});

// ───────────── Inyección en la salida ─────────────

test('salida: los caracteres de control no llegan a la terminal', () => {
  assert.equal(sinControl('a\u001b[2Jb\u0007c\u009bd\ne\tf'), 'a?[2Jb?c?d\ne\tf');
  const r = auditarRepo(repoCon('create table public."t\u001b[2J" (id int);'));
  const texto = sinControl(resumenTexto(r));
  assert.ok(!texto.includes('\u001b'));
  const cli = spawnSync(process.execPath, [join(RAIZ, 'bin', 'cerrojo.js'), 'repo', repoCon('create table public."t\u001b[2J" (id int);'), '--salida', join(temporales[0], 'r.json')], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.ok(!cli.stdout.includes('\u001b') && /Tabla sin RLS/.test(cli.stdout));
});

test('informe: un archivo de resultados manipulado no inyecta HTML ni rompe el informe', () => {
  const malo = '"><script>alert(1)</script>';
  const html = generarInforme([
    { tipo: malo, objetivo: malo, fin: malo, peticiones: malo, hallazgos: [{ id: 'R-SIN-RLS', gravedad: malo, donde: malo, datos: null }, { id: malo, gravedad: 'alta', donde: malo }, { id: 'A-LECTURA-CRUZADA', gravedad: 'alta', donde: 'x', datos: {} }], superadas: [{ es: malo }], notas: malo, avisos: [malo, null, 7] },
    { tipo: 'aislamiento', objetivo: 'x', hallazgos: [], matriz: [{ tabla: malo, columnaDueno: malo, A: malo, B: malo, resultado: malo, escritura: malo }] },
    { tipo: 'repo', objetivo: 'x', hallazgos: [], inventario: [{ tabla: malo, rls: malo, politicas: malo }] },
    { tipo: 'web', objetivo: 'x', hallazgos: [], superficie: { rpc: [malo], funciones: malo, buckets: null } },
  ]);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.doesNotMatch(html, /class="[^"]*"><script/);
});

test('CLI: un --config con tipos incorrectos da un error claro', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cerrojo-'));
  temporales.push(dir);
  const probar = (contenido, patron) => {
    writeFileSync(join(dir, 'c.json'), JSON.stringify(contenido));
    const r = spawnSync(process.execPath, [join(RAIZ, 'bin', 'cerrojo.js'), 'aislamiento', '--autorizo', '--config', join(dir, 'c.json')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, patron);
  };
  probar(null, /debe contener un objeto JSON/);
  probar({ tablas: 'users' }, /"tablas" debe ser una lista/);
  probar({ usuarioA: 'ana' }, /"usuarioA" debe ser un objeto/);
});
