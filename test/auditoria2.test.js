// Pruebas de la segunda auditoría independiente (Antigravity, sobre el código ya corregido).
// Casi todas tratan de lo mismo: que algo que no se pudo comprobar no figure como superado.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { clasificarCondicion, esSiempreCierta, soloExigeSesion } from '../src/sql.js';
import { auditarRepo } from '../src/repo.js';
import { auditarWeb } from '../src/web.js';
import { probarAislamiento } from '../src/aislamiento.js';
import { generarInforme } from '../src/informe.js';
import { hallazgo } from '../src/catalogo.js';
import { Cliente } from '../src/http.js';
import { limpiarMensaje } from '../validacion/validar.js';
import { iniciarDemo, firmarJwt } from '../demo/servidor.js';

const temporales = [];
const servidores = [];
after(async () => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
  for (const s of servidores) await new Promise((ok) => (s.closeAllConnections?.(), s.close(ok)));
});
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
const local = () => new Cliente({ pausaMs: 0, permitirLocal: true });
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const cuentas = { usuarioA: { correo: 'a@x.test', contrasena: 'x' }, usuarioB: { correo: 'b@x.test', contrasena: 'x' } };

/** Supabase simulado sin red: `responder(quien, url)` devuelve {filas, total?, estado?, cuerpo?}. */
function fetchFalso(responder) {
  const llamadas = [];
  const f = async (url, init) => {
    const u = new URL(url);
    llamadas.push({ metodo: init.method, ruta: u.pathname + decodeURIComponent(u.search) });
    if (u.pathname === '/auth/v1/token') {
      const { email } = JSON.parse(init.body);
      return new Response(JSON.stringify({ access_token: `t-${email}`, user: { id: email === 'a@x.test' ? A : B } }));
    }
    const quien = init.headers.Authorization === 'Bearer t-a@x.test' ? 'A' : 'B';
    const r = responder(quien, u, init);
    if (r.estado && r.estado !== 200) return new Response(r.cuerpo ?? '{}', { status: r.estado, headers: r.cabeceras ?? {} });
    const total = r.total ?? r.filas.length;
    return new Response(JSON.stringify(r.filas), { headers: { 'Content-Range': r.filas.length ? `0-${r.filas.length - 1}/${total}` : `*/${total}` } });
  };
  return { f, llamadas };
}
const aislar = (responder, extra = {}) => {
  const { f, llamadas } = fetchFalso(responder);
  return probarAislamiento({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', clave: `sb_publishable_${'k'.repeat(24)}`, tablas: ['t'], ...cuentas, cliente: new Cliente({ pausaMs: 0, fetch: f }), ...extra }).then((r) => ({ r, llamadas }));
};

// ───────────── Lo no comprobado no figura como superado ─────────────

test('un 403 de un cortafuegos (sin código de la base de datos) no es "acceso denegado"', async () => {
  const anon = firmarJwt({ role: 'anon', exp: 2e9 }, 's');
  const s = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/auth/v1/settings') return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"disable_signup":false,"mailer_autoconfirm":false}');
    if (u.pathname === '/rest/v1/') return res.writeHead(500).end('error interno');
    if (u.pathname === '/rest/v1/tras_cortafuegos') return res.writeHead(403, { 'Content-Type': 'text/html' }).end('<html>Access denied by WAF</html>');
    if (u.pathname === '/rest/v1/denegada') return res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"code":"42501","message":"permission denied for table denegada"}');
    if (u.pathname.startsWith('/.env') || u.pathname === '/.git/config') return res.writeHead(502).end('bad gateway');
    if (u.pathname === '/app.js') return res.end(`const s=createClient("http://127.0.0.1:${s.address().port}","${anon}");s.from("tras_cortafuegos");s.from("denegada");`);
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<script src="/app.js"></script>');
  });
  servidores.push(s);
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const r = await auditarWeb(`http://127.0.0.1:${s.address().port}/`, { cliente: local() });
  assert.equal(r.tablasEstado.tras_cortafuegos, 'error');
  assert.equal(r.tablasEstado.denegada, 'denegado');
  assert.ok(r.avisos.some((a) => /No se pudo comprobar.*tras_cortafuegos/.test(a.es)));
  const cerradas = r.superadas.find((x) => /Sin sesión no se obtiene ninguna fila/.test(x.es));
  assert.ok(cerradas && /denegada/.test(cerradas.es) && !/tras_cortafuegos/.test(cerradas.es));
  // .env/.git y el esquema respondieron con error: no se afirma nada sobre ellos.
  assert.ok(!r.superadas.some((x) => /\.env y la carpeta \.git/.test(x.es)));
  assert.ok(!r.superadas.some((x) => /esquema de la base de datos no se puede consultar/.test(x.es)));
  assert.ok(r.notas.some((x) => /No se pudo comprobar si se sirven \.env o \.git/.test(x.es)));
  assert.ok(r.notas.some((x) => /No se pudo comprobar si el esquema/.test(x.es)));
});

test('aislamiento: una fila ajena más allá del tope de lectura se encuentra con una consulta aparte', async () => {
  const propias = Array.from({ length: 3 }, (_, i) => ({ id: i, user_id: A }));
  const { r, llamadas } = await aislar(
    (quien, u) => {
      if (quien === 'B') return { filas: [] };
      // Con el filtro "dueño distinto de mí" aparece la fila que quedaba fuera de las leídas.
      if (u.search.includes('neq.')) return { filas: [{ id: 999, user_id: B }] };
      return { filas: propias, total: 1200 };
    },
    { limite: 3 },
  );
  assert.ok(llamadas.some((l) => l.ruta.includes(`user_id=neq.${A}`)), JSON.stringify(llamadas));
  assert.equal(r.matriz[0].resultado, 'fuga');
  assert.deepEqual(r.hallazgos[0].datos.lecturas, [{ quien: 'A', ajenas: 1, delOtro: 1 }]);
});

test('aislamiento: si no se puede comprobar el resto de una tabla recortada, no se declara aislada', async () => {
  const { r } = await aislar(
    (quien, u) => {
      if (quien === 'B') return { filas: [] };
      if (u.search.includes('neq.')) return { estado: 500, cuerpo: '{"message":"boom"}' };
      return { filas: [{ id: 1, user_id: A }, { id: 2, user_id: A }], total: 5000 };
    },
    { limite: 2 },
  );
  assert.equal(r.matriz[0].resultado, 'no_concluyente');
  assert.equal(r.superadas.length, 0);
  assert.ok(r.avisos.some((a) => /hay más filas de las 2 leídas/.test(a.es)));
});

test('aislamiento: con filas sin dueño visibles no se declara aislada', async () => {
  const { r } = await aislar((quien) => ({ filas: quien === 'A' ? [{ id: 1, user_id: A }, { id: 2, user_id: null }] : [{ id: 3, user_id: B }] }));
  assert.equal(r.matriz[0].resultado, 'no_concluyente');
  assert.equal(r.superadas.length, 0);
});

test('aislamiento: aparecer en verified_by (o cualquier *_by) no oculta una fila ajena', async () => {
  const { r } = await aislar((quien) => ({ filas: quien === 'A' ? [{ id: 1, user_id: B, verified_by: A }] : [{ id: 1, user_id: B, verified_by: A }] }));
  assert.equal(r.matriz[0].resultado, 'fuga');
  assert.equal(r.matriz[0].columnaDueno, 'user_id');
  // created_by sí puede ser el dueño cuando no hay otra columna.
  const { r: r2 } = await aislar((quien) => ({ filas: quien === 'A' ? [{ id: 1, created_by: A }] : [{ id: 2, created_by: B }] }));
  assert.equal(r2.matriz[0].columnaDueno, 'created_by');
  assert.equal(r2.matriz[0].resultado, 'aislada');
});

test('escritura: sin filas de la otra cuenta no se declara protegida', async () => {
  const demo = await iniciarDemo();
  try {
    await demo.db.exec(`
      create table public.solo_de_ana (id bigint generated always as identity primary key, user_id uuid not null, nota text);
      alter table public.solo_de_ana enable row level security;
      create policy p on public.solo_de_ana for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
      insert into public.solo_de_ana (user_id, nota) values ('${demo.usuarios.A.id}', 'x');`);
    const r = await probarAislamiento({ supabaseUrl: demo.url, clave: demo.claveAnon, tablas: ['solo_de_ana', 'invoices'], usuarioA: demo.usuarios.A, usuarioB: demo.usuarios.B, probarEscritura: true, baseDesechable: true, cliente: local() });
    const fila = (t) => r.matriz.find((m) => m.tabla === t);
    assert.equal(fila('solo_de_ana').resultado, 'aislada');
    assert.equal(fila('solo_de_ana').escritura, 'no_concluyente', 'B no tiene filas: no se pudo intentar en los dos sentidos');
    assert.equal(fila('invoices').escritura, 'aislada');
  } finally {
    await demo.cerrar();
  }
});

test('escritura: "localhost" que resuelve fuera de esta máquina no recibe ningún UPDATE', async () => {
  let peticiones = 0;
  const cliente = new Cliente({ pausaMs: 0, permitirLocal: true, resolver: async () => [{ address: '93.184.216.34', family: 4 }], timeoutMs: 500 });
  const original = cliente.pedir.bind(cliente);
  cliente.pedir = (...a) => (peticiones++, original(...a));
  await assert.rejects(
    probarAislamiento({ supabaseUrl: 'http://localhost:54321', clave: `sb_publishable_${'k'.repeat(24)}`, tablas: ['t'], ...cuentas, probarEscritura: true, baseDesechable: true, cliente }),
    /solo se ejecuta contra esta máquina.*93\.184\.216\.34/,
  );
  assert.equal(peticiones, 0);
});

test('cliente soloLoopback: no sale de la propia máquina ni a direcciones públicas', async () => {
  const c = new Cliente({ pausaMs: 0, soloLoopback: true, resolver: async () => [{ address: '93.184.216.34', family: 4 }] });
  for (const u of ['https://example.com/', 'http://10.0.0.1/', 'http://x.localhost:54321/', 'http://localhost:54321/']) {
    assert.match((await c.pedir(u)).error, /^destino_bloqueado/, u);
  }
});

// ───────────── Políticas ─────────────

test('política: "solo sesión" anidado en OR y AND se propaga', () => {
  for (const e of ["is_admin() OR (role = 'staff' OR auth.uid() IS NOT NULL)", "(role = 'staff' OR auth.uid() IS NOT NULL) AND true", "(a = 1 or (b = 2 or (auth.role() = 'authenticated')))"]) {
    assert.ok(soloExigeSesion(e), e);
  }
  assert.equal(clasificarCondicion("(role = 'staff' OR auth.uid() IS NOT NULL) AND user_id = auth.uid()"), 'otra');
});

test('política: una columna llamada select1 no se confunde con SELECT', () => {
  assert.ok(!esSiempreCierta('(select1 = 1)'));
  assert.ok(esSiempreCierta('(select 1 = 1)'));
  assert.ok(esSiempreCierta('( SELECT true )'));
});

test('columnas de privilegio: se mira cada columna y cada política', () => {
  const tabla = (extra) => `create table public.p (id uuid, role text, balance numeric); alter table public.p enable row level security; ${extra}`;
  const expuestas = (sql) => auditarRepo(repoCon(sql)).hallazgos.find((h) => h.id === 'R-COLUMNA-PRIVILEGIO-EDITABLE')?.datos.columnas ?? [];
  // El WITH CHECK vigila role, pero no balance.
  assert.deepEqual(expuestas(tabla("create policy u on public.p for update to authenticated using (auth.uid() = id) with check (auth.uid() = id and role = 'user');")), ['balance']);
  // Dos políticas: basta que una no vigile la columna.
  assert.deepEqual(
    expuestas(tabla("create policy u1 on public.p for update to authenticated using (auth.uid() = id) with check (role = 'user' and balance = 0); create policy u2 on public.p for update to authenticated using (auth.uid() = id);")),
    ['role', 'balance'],
  );
  // Identificador entre comillas con mayúsculas: se devuelve el permiso justo sobre esa columna.
  assert.deepEqual(
    expuestas('create table public.q (id uuid, "Role" text); alter table public.q enable row level security; create policy u on public.q for update to authenticated using (auth.uid() = id); revoke update on public.q from authenticated; grant update ("Role") on public.q to authenticated;'),
    ['Role'],
  );
});

// ───────────── Repositorio ─────────────

test('repo: ignorar .env.local no es ignorar .env; un SQL enorme se avisa', () => {
  const secreto = `sk_live_${'Ab12'.repeat(7)}`;
  const r = auditarRepo(repoCon(null, { '.env': `STRIPE_SECRET_KEY=${secreto}\n`, '.env.local': `OTRA_CLAVE=${secreto}\n`, '.gitignore': '.env.local\n' }));
  assert.deepEqual(r.hallazgos.filter((h) => h.id === 'C-ENV-EN-GIT').map((h) => h.donde), ['.env']);

  const grande = repoCon('create table public.x (id int);', { 'supabase/migrations/2_volcado.sql': `-- ${'x'.repeat(5_100_000)}\ncreate table public.oculta (id int);` });
  const r2 = auditarRepo(grande);
  assert.ok(r2.avisos.some((a) => /No se analizaron 1 archivo\(s\) SQL.*2_volcado\.sql/.test(a.es)), JSON.stringify(r2.avisos));
});

// ───────────── Informe y registro ─────────────

test('informe: una tabla llamada "all" se cita con su nombre en el arreglo', () => {
  const html = generarInforme([{ tipo: 'repo', objetivo: 'x', hallazgos: [hallazgo('R-SIN-RLS', 'alta', 'public.all', { tabla: 'all', archivo: 'm.sql', columnas: [] })] }]);
  assert.match(html, /alter table public\.all enable row level security/);
});

test('registro de la validación: un mensaje de error enorme no atasca el enmascarado', () => {
  const t0 = performance.now();
  const limpio = limpiarMensaje(`${'a'.repeat(2_900_000)}@b`);
  assert.ok(performance.now() - t0 < 1000);
  assert.ok(limpio.length <= 160);
  assert.equal(limpiarMensaje(`/rest/v1/t?user_id=neq.${A}`), '/rest/v1/t?user_id=neq.[uuid]');
});
