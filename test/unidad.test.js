// Pruebas unitarias: extracción desde código público, lectura de SQL y evaluación de políticas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraer } from '../src/extraer.js';
import { dividirSentencias, modeloVacio, aplicarMigracion, normalizar, esSiempreCierta, soloExigeSesion } from '../src/sql.js';
import { enmascarar, categoriasSensibles, gravedadPorCategorias, decodificarJwt } from '../src/util.js';
import { generarInforme } from '../src/informe.js';
import { hallazgo } from '../src/catalogo.js';
import { probarAislamiento } from '../src/aislamiento.js';
import { Cliente } from '../src/http.js';
import { firmarJwt } from '../demo/servidor.js';

// Los "secretos" de prueba se generan aquí para que el repositorio no contenga ninguno.
const jwt = (rol) => firmarJwt({ iss: 'supabase', ref: 'abcdefghijklmnopqrst', role: rol, exp: 2000000000 }, 'secreto-de-prueba');

test('extraer: detecta proyecto, clave pública, tablas, buckets, RPC y funciones', () => {
  const anon = jwt('anon');
  const js = `const a="https://abcdefghijklmnopqrst.supabase.co",b="${anon}";const s=cc(a,b);
    s.from("orders").select();s.from('user_profiles');s.storage.from("user-uploads").list();
    s.rpc("get_stats");s.functions.invoke("send-email");Array.from("xyz");Buffer.from("abc");
    fetch(a+"/functions/v1/checkout");
    //# sourceMappingURL=app.js.map`;
  const r = extraer(js, 'app.js');
  assert.deepEqual([...r.urlsSupabase], ['https://abcdefghijklmnopqrst.supabase.co']);
  assert.equal(r.clavesPublicas.length, 1);
  assert.equal(r.clavesPublicas[0].tipo, 'anon-jwt');
  assert.deepEqual([...r.tablas].sort(), ['orders', 'user_profiles']);
  assert.deepEqual([...r.buckets], ['user-uploads']);
  assert.deepEqual([...r.rpc], ['get_stats']);
  assert.deepEqual([...r.funciones].sort(), ['checkout', 'send-email']);
  assert.equal(r.mapaFuente, 'app.js.map');
  assert.equal(r.secretos.length, 0, 'la clave anónima no es un secreto');
});

test('extraer: una clave service_role en el navegador es un secreto y se enmascara', () => {
  const servicio = jwt('service_role');
  const r = extraer(`const k="${servicio}"`, 'app.js');
  assert.equal(r.secretos.length, 1);
  assert.equal(r.secretos[0].servicio, true);
  assert.ok(!JSON.stringify(r.secretos).includes(servicio), 'el secreto completo no debe conservarse');
});

test('extraer: reconoce claves nuevas de Supabase y secretos de terceros', () => {
  const publicable = `sb_publishable_${'a1B2'.repeat(6)}`;
  const secreta = `sb_secret_${'z9Y8'.repeat(6)}`;
  const stripe = `sk_live_${'Ab12'.repeat(7)}`;
  const r = extraer(`x("${publicable}");y("${secreta}");z("${stripe}")`, 'a.js');
  assert.deepEqual(r.clavesPublicas.map((c) => c.tipo), ['publishable']);
  assert.equal(r.secretos.length, 2);
  assert.ok(r.secretos.some((s) => s.servicio));
});

test('util: enmascarado, JWT y clasificación de columnas sensibles', () => {
  assert.equal(enmascarar('abcdefghijklmnopqrstuvwxyz'), 'abcdef…wxyz (26 caracteres)');
  assert.equal(decodificarJwt(jwt('anon')).carga.role, 'anon');
  assert.equal(decodificarJwt('no-es-un-jwt'), null);
  assert.equal(gravedadPorCategorias(categoriasSensibles(['access_token'])), 'critica');
  assert.equal(gravedadPorCategorias(categoriasSensibles(['email', 'phone'])), 'alta');
  assert.equal(gravedadPorCategorias(categoriasSensibles(['title', 'monthly_price'])), 'media');
});

test('sql: divide sentencias respetando cadenas, comentarios y bloques $$', () => {
  const s = dividirSentencias(`
    -- comentario; con punto y coma
    create table a (x text default 'a;b'); /* otro; */
    create function f() returns void language plpgsql as $fn$ begin perform 1; perform 2; end $fn$;
    select 1`);
  assert.equal(s.length, 3);
  assert.match(s[1], /perform 1; perform 2;/);
});

test('sql: reconstruye tablas, RLS y políticas', () => {
  const m = aplicarMigracion(
    modeloVacio(),
    `create table if not exists public.notes (id uuid primary key, user_id uuid, body text, constraint c check (true));
     alter table notes enable row level security;
     create policy "own notes" on notes as permissive for select to authenticated, anon using ( (select auth.uid()) = user_id );
     create policy tmp on public.notes for delete using (true);
     drop policy tmp on public.notes;
     create table temp_stuff (id int);
     drop table temp_stuff;
     alter table public.notes add column role text;`,
    'm.sql',
  );
  const t = m.tablas.get('public.notes');
  assert.deepEqual(t.columnas, ['id', 'user_id', 'body', 'role']);
  assert.equal(t.rls, true);
  assert.equal(t.politicas.length, 1);
  assert.deepEqual(t.politicas[0].roles, ['authenticated', 'anon']);
  assert.equal(t.politicas[0].comando, 'select');
  assert.equal(t.politicas[0].using, '(select auth.uid()) = user_id');
  assert.ok(!m.tablas.has('public.temp_stuff'));
});

test('sql: una palabra "to" dentro de la condición no se confunde con los roles', () => {
  const m = aplicarMigracion(modeloVacio(), `create table t (id int, assigned_to uuid); create policy p on t for select using (status similar to 'a%' and assigned_to = auth.uid());`, 'm.sql');
  assert.deepEqual(m.tablas.get('public.t').politicas[0].roles, ['public']);
});

test('sql: evaluación de condiciones', () => {
  assert.equal(normalizar('( ( TRUE ) )'), 'true');
  assert.ok(esSiempreCierta('(true)'));
  assert.ok(!esSiempreCierta('auth.uid() = user_id'));
  assert.ok(soloExigeSesion('(select auth.uid()) IS NOT NULL'));
  assert.ok(soloExigeSesion("auth.role() = 'authenticated'"));
  assert.ok(!soloExigeSesion('auth.uid() = user_id'));
  assert.ok(!soloExigeSesion('auth.uid() is not null and auth.uid() = user_id'));
});

test('informe: escapa el HTML procedente de los datos auditados', () => {
  const malo = '<img src=x onerror=alert(1)>';
  const html = generarInforme(
    [{ tipo: 'repo', objetivo: malo, fin: '2026-11-14T10:00:00Z', superadas: [], notas: [], hallazgos: [hallazgo('R-POLITICA-LECTURA-ABIERTA', 'alta', malo, { tabla: 't', politica: malo, comando: 'select', roles: ['public'], expresion: 'true', archivo: malo })] }],
    { cliente: malo, auditor: malo },
  );
  assert.ok(!html.includes(malo));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('informe: sin hallazgos no afirma que la app sea segura', () => {
  const html = generarInforme([{ tipo: 'repo', objetivo: 'x', fin: '2026-11-14T10:00:00Z', superadas: [], notas: [], hallazgos: [] }]);
  assert.match(html, /no equivale a que no existan/);
  assert.doesNotMatch(html, /app (es|está) segura/i);
});

// Supabase simulado mínimo para probar la lógica de aislamiento sin red.
function supabaseFalso(filasPorUsuario) {
  const ids = { 'a@x.test': '11111111-1111-4111-8111-111111111111', 'b@x.test': '22222222-2222-4222-8222-222222222222' };
  return async (url, init) => {
    const u = new URL(url);
    const responder = (cuerpo, estado = 200, cabeceras = {}) => new Response(JSON.stringify(cuerpo), { status: estado, headers: cabeceras });
    if (u.pathname === '/auth/v1/token') {
      const { email } = JSON.parse(init.body);
      return responder({ access_token: `token-${email}`, user: { id: ids[email] } });
    }
    const quien = init.headers.Authorization.replace('Bearer token-', '');
    const filas = filasPorUsuario(ids)[quien] ?? [];
    return responder(filas, 200, { 'Content-Range': filas.length ? `0-${filas.length - 1}/${filas.length}` : '*/0' });
  };
}
const opAislamiento = (fetchFalso) => ({
  supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
  clave: 'sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx',
  tablas: ['messages'],
  usuarioA: { correo: 'a@x.test', contrasena: 'x' },
  usuarioB: { correo: 'b@x.test', contrasena: 'x' },
  cliente: new Cliente({ pausaMs: 0, fetch: fetchFalso }),
});

test('aislamiento: un mensaje que B envía a A no es una fuga', async () => {
  const r = await probarAislamiento(
    opAislamiento(
      supabaseFalso((ids) => {
        const m = { id: 1, sender_id: ids['b@x.test'], recipient_id: ids['a@x.test'], body: 'hola' };
        return { 'a@x.test': [m], 'b@x.test': [m] };
      }),
    ),
  );
  assert.equal(r.hallazgos.length, 0);
});

test('aislamiento: sin datos de las cuentas de prueba el resultado es "no concluyente", no "aislada"', async () => {
  const r = await probarAislamiento(opAislamiento(supabaseFalso(() => ({ 'a@x.test': [], 'b@x.test': [] }))));
  assert.equal(r.matriz[0].resultado, 'sin_datos');
  assert.equal(r.superadas.length, 0);
  assert.ok(r.avisos.some((n) => /No concluyente/.test(n.es)));
});

test('aislamiento: detecta filas de un tercero aunque no sean de la otra cuenta de prueba', async () => {
  const r = await probarAislamiento(
    opAislamiento(
      supabaseFalso((ids) => ({
        'a@x.test': [
          { id: 1, user_id: ids['a@x.test'], body: 'mía' },
          { id: 2, user_id: '33333333-3333-4333-8333-333333333333', body: 'de un tercero' },
        ],
        'b@x.test': [],
      })),
    ),
  );
  assert.equal(r.hallazgos.length, 1);
  assert.deepEqual(r.hallazgos[0].datos.lecturas, [{ quien: 'A', ajenas: 1, delOtro: 0 }]);
});

test('aislamiento: una columna account_id que no contiene usuarios no se toma por dueño', async () => {
  // Modelo por organización: las filas no llevan el id del usuario. No se puede concluir nada
  // automáticamente, y desde luego no se debe afirmar una fuga.
  const fila = (n) => ({ id: n, account_id: '99999999-9999-4999-8999-999999999999', title: `doc ${n}` });
  const r = await probarAislamiento(opAislamiento(supabaseFalso(() => ({ 'a@x.test': [fila(1), fila(2)], 'b@x.test': [fila(1), fila(2)] }))));
  assert.equal(r.hallazgos.length, 0);
  assert.equal(r.matriz[0].resultado, 'sin_dueno');
  assert.ok(r.avisos.some((n) => /Sin columna de dueño identificable/.test(n.es)));
});
