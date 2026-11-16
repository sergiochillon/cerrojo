// Pruebas adversarias redactadas por Antigravity (Gemini 4 Hydrogen) en una revisión de solo
// lectura e integradas después a mano. Se cambió una aserción: 0.0.0.0 se clasifica como
// dirección interna, no como la propia máquina.
// Pruebas adversarias: entradas hostiles, casos límite y resistencia a ReDoS/XSS/SSRF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

// Más holgura en integración continua: se comprueba que no haya coste cuadrático, no una cifra.
const LIMITE_MS = process.env.CI ? 10_000 : 2000;
import {
  dividirSentencias,
  modeloVacio,
  aplicarMigracion,
  normalizar,
  esSiempreCierta,
  soloExigeSesion,
} from '../src/sql.js';
import { extraer } from '../src/extraer.js';
import { generarInforme } from '../src/informe.js';
import { hallazgo } from '../src/catalogo.js';
import { clasificarIp, clasificarNombre, esLoopback } from '../src/http.js';
import { esClaveSecreta, decodificarJwt, enmascarar } from '../src/util.js';

// ───────────── src/sql.js ─────────────

test('sql: comillas simples, dobles, comentarios y $$ sin cerrar no cuelgan el analizador', () => {
  for (const entrada of [
    "select 'cadena sin cerrar; create table x (id int);",
    'create table "nombre sin cerrar (id int);',
    'select 1; /* comentario sin cerrar; create table x (id int);',
    'create function f() returns void as $$ begin perform 1;',
  ]) {
    const sentencias = dividirSentencias(entrada);
    assert.ok(Array.isArray(sentencias));
    assert.ok(sentencias.length >= 1);
    const modelo = aplicarMigracion(modeloVacio(), entrada, 'sin-cerrar.sql');
    assert.ok(modelo.tablas instanceof Map);
  }
});

test('sql: bloques de dólares anidados con etiquetas distintas no parten la sentencia', () => {
  const sql = `
    create function public.f_anidada() returns void
    language plpgsql
    security definer
    as $outer$
    begin
      execute $inner$ select 'hola; mundo'; $inner$;
      perform 1;
    end;
    $outer$;
    create table public.despues (id int);
  `;
  const sentencias = dividirSentencias(sql);
  assert.equal(sentencias.length, 2);
  assert.match(sentencias[0], /\$inner\$ select 'hola; mundo'; \$inner\$;/);

  const m = aplicarMigracion(modeloVacio(), sql, 'anidada.sql');
  assert.equal(m.funciones.length, 1);
  assert.equal(m.funciones[0].definer, true);
  assert.equal(m.funciones[0].searchPath, false);
  assert.ok(m.tablas.has('public.despues'));
});

test('sql: comentarios dentro de cadenas literales no se eliminan ni parten sentencias', () => {
  const sql = `
    create table public.docs (
      id int,
      nota text default 'texto -- falso comentario; /* tampoco comentario */ fin'
    );
  `;
  const sentencias = dividirSentencias(sql);
  assert.equal(sentencias.length, 1);
  assert.match(sentencias[0], /-- falso comentario; \/\* tampoco comentario \*\//);

  const m = aplicarMigracion(modeloVacio(), sql, 'comentarios-cadena.sql');
  assert.deepEqual(m.tablas.get('public.docs').columnas, ['id', 'nota']);
});

test('sql: nombres entre comillas con espacios, puntos y comillas dobles escapadas', () => {
  const sql = `
    create table "mi esquema"."mi.tabla con espacios" (
      "id usuario" uuid,
      "col.con.punto" text
    );
    alter table "mi esquema"."mi.tabla con espacios" enable row level security;
    create policy "pol ""especial"" con espacios"
      on "mi esquema"."mi.tabla con espacios"
      for select
      to authenticated
      using ("id usuario" = auth.uid());
  `;
  const m = aplicarMigracion(modeloVacio(), sql, 'comillas.sql');
  const tabla = m.tablas.get('mi esquema.mi.tabla con espacios');
  assert.ok(tabla, 'debe registrar la tabla con espacios y puntos en el nombre');
  assert.deepEqual(tabla.columnas, ['id usuario', 'col.con.punto']);
  assert.equal(tabla.rls, true);
  assert.equal(tabla.politicas.length, 1);
  assert.equal(tabla.politicas[0].nombre, 'pol "especial" con espacios');
});

test('sql: CREATE POLICY en mayúsculas y en varias líneas', () => {
  const sql = `
    CREATE TABLE PUBLIC.NOTAS (ID UUID, USER_ID UUID);
    ALTER TABLE PUBLIC.NOTAS ENABLE ROW LEVEL SECURITY;
    CREATE POLICY
      "Solo Propio"
    ON
      PUBLIC.NOTAS
    AS RESTRICTIVE
    FOR SELECT
    TO AUTHENTICATED, ANON
    USING (
      ( SELECT AUTH.UID() ) = USER_ID
    );
  `;
  const m = aplicarMigracion(modeloVacio(), sql, 'mayus.sql');
  const t = m.tablas.get('public.notas');
  assert.ok(t);
  assert.equal(t.politicas.length, 1);
  assert.equal(t.politicas[0].nombre, 'Solo Propio');
  assert.equal(t.politicas[0].restrictiva, true);
  assert.equal(t.politicas[0].comando, 'select');
  assert.deepEqual(t.politicas[0].roles, ['authenticated', 'anon']);
  assert.equal(normalizar(t.politicas[0].using), 'auth.uid()=user_id');
});

test('sql: evaluación segura de políticas con expresiones equivalentes a abierta o solo-sesión', () => {
  const sql = `
    create table public.items (id int);
    create policy p1 on public.items for select using (1 = 1);
    create policy p2 on public.items for select using ((true)::boolean);
    create policy p3 on public.items for select using (auth.role() = 'authenticated');
    create policy p4 on public.items for select using (auth.uid() IS NOT NULL OR false);
  `;
  const m = aplicarMigracion(modeloVacio(), sql, 'condiciones.sql');
  const pols = m.tablas.get('public.items').politicas;
  assert.equal(pols.length, 4);

  assert.equal(esSiempreCierta(pols[0].using), true, '1 = 1 es siempre cierta');
  assert.equal(esSiempreCierta(pols[1].using), true, '(true)::boolean es siempre cierta');
  assert.equal(soloExigeSesion(pols[2].using), true, "auth.role() = 'authenticated' solo exige sesión");
  assert.equal(soloExigeSesion(pols[3].using), true, 'auth.uid() IS NOT NULL OR false solo exige sesión');
  assert.equal(
    soloExigeSesion("(select auth.jwt() ->> 'role') = 'authenticated'"),
    true,
    '(select auth.jwt() ->> \'role\') = \'authenticated\' solo exige sesión',
  );
});

test('sql: alter table con enable, force y disable row level security', () => {
  const sql = `
    create table public.a (id int);
    alter table public.a enable row level security, force row level security;

    create table public.b (id int);
    alter table public.b force row level security;

    create table public.c (id int);
    alter table public.c disable row level security, enable row level security;
  `;
  const m = aplicarMigracion(modeloVacio(), sql, 'rls-combinado.sql');
  assert.equal(m.tablas.get('public.a').rls, true);
  assert.equal(m.tablas.get('public.b').rls, false, 'FORCE sin ENABLE no activa RLS en PostgreSQL');
  assert.equal(m.tablas.get('public.c').rls, true, 'ENABLE posterior a DISABLE en el mismo ALTER deja RLS activo');
  assert.equal(m.tablas.get('public.c').rlsDesactivado, null);
});

test('sql: esquemas distintos de public y particiones (partition of)', () => {
  const sql = `
    create schema privado;
    create table privado.secretos (id int, clave text);
    alter table privado.secretos enable row level security;

    create table public.eventos (id int, creado date) partition by range (creado);
    alter table public.eventos enable row level security;
    create table public.eventos_2026 partition of public.eventos
      for values from ('2026-01-01') to ('2027-01-01');
  `;
  const m = aplicarMigracion(modeloVacio(), sql, 'esquemas-particiones.sql');
  assert.ok(m.tablas.has('privado.secretos'));
  assert.equal(m.tablas.get('privado.secretos').rls, true);
  assert.ok(!m.tablas.has('public.secretos'));

  assert.ok(m.tablas.has('public.eventos_2026'), 'una partición es una tabla independiente y debe registrarse');
  assert.equal(m.tablas.get('public.eventos_2026').rls, false);
});

test('sql: script de 2 MB se procesa en menos de 2 segundos', () => {
  const scriptEstandar = 'create table public.t (id int);\n'.repeat(65_000); // ~2 MB
  assert.ok(scriptEstandar.length >= 2_000_000);
  const t0 = performance.now();
  const s1 = dividirSentencias(scriptEstandar);
  const dt1 = performance.now() - t0;
  assert.equal(s1.length, 65_000);
  assert.ok(dt1 < LIMITE_MS, `dividirSentencias estándar tardó ${dt1.toFixed(1)} ms`);

  const scriptDolares = 'select $1, $2;\n'.repeat(145_000); // ~2 MB con abundantes $
  assert.ok(scriptDolares.length >= 2_000_000);
  const t1 = performance.now();
  const s2 = dividirSentencias(scriptDolares);
  aplicarMigracion(modeloVacio(), scriptDolares, 'grande.sql');
  const dt2 = performance.now() - t1;
  assert.equal(s2.length, 145_000);
  assert.ok(dt2 < LIMITE_MS, `script de 2 MB con $ tardó ${dt2.toFixed(1)} ms`);
});

// ───────────── src/extraer.js ─────────────

test('extraer: cadenas de varios MB adversarias no provocan retroceso catastrófico (< 2 s)', () => {
  const casos = [
    ['millones de eyJ', 'eyJ'.repeat(1_000_000)],
    ['eyJ con un punto', ('eyJ' + 'a'.repeat(20) + '.').repeat(120_000)],
    ['millones de .from(', '.from('.repeat(500_000)],
    ['millones de a. repetido', 'a.'.repeat(1_500_000)],
    ['millones de a sin punto', 'a'.repeat(2_500_000)],
    ['createClient sin cierre', 'createClient("https://'.repeat(120_000)],
  ];

  for (const [nombre, texto] of casos) {
    assert.ok(texto.length >= 2_000_000, `${nombre} debe superar 2 MB`);
    const inicio = performance.now();
    const res = extraer(texto, 'bundle.js');
    const ms = performance.now() - inicio;
    assert.ok(res && res.tablas instanceof Set);
    assert.ok(ms < LIMITE_MS, `${nombre} tardó ${ms.toFixed(1)} ms (límite 2000 ms)`);
  }
});

// ───────────── src/informe.js ─────────────

test('informe: escapa HTML, comillas, saltos de línea y </script> en todos los campos', () => {
  const marca = 'XSS_PAYLOAD';
  const hostil = `</script></SCRIPT><img src=x onerror="alert('${marca}')">\n\r"'&`;

  const h1 = hallazgo('R-POLITICA-LECTURA-ABIERTA', 'alta', hostil, {
    tabla: hostil,
    politica: hostil,
    comando: hostil,
    roles: [hostil],
    expresion: hostil,
    archivo: hostil,
  });
  h1.gravedad = hostil;

  const h2 = hallazgo('S-TABLA-LEGIBLE-ANON', 'critica', hostil, {
    tabla: hostil,
    filas: hostil,
    columnas: [hostil],
    categorias: [hostil],
  });

  const html = generarInforme(
    [
      {
        tipo: 'repo',
        objetivo: hostil,
        fin: '2026-11-15T10:00:00Z',
        peticiones: hostil,
        superadas: [hostil],
        notas: [hostil],
        inventario: [{ tabla: hostil, rls: false, politicas: hostil }],
        hallazgos: [h1],
      },
      {
        tipo: 'aislamiento',
        objetivo: hostil,
        fin: '2026-11-15T10:00:00Z',
        superadas: [hostil],
        notas: [hostil],
        matriz: [
          {
            tabla: hostil,
            columnaDueno: hostil,
            A: hostil,
            B: hostil,
            resultado: hostil,
            escritura: hostil,
          },
        ],
        hallazgos: [],
      },
      {
        tipo: 'web',
        objetivo: hostil,
        fin: '2026-11-15T10:00:00Z',
        superadas: [hostil],
        notas: [hostil],
        superficie: { rpc: [hostil], funciones: [hostil], buckets: [hostil] },
        hallazgos: [h2],
      },
    ],
    { idioma: 'es', cliente: hostil, auditor: hostil, app: hostil, fecha: hostil },
  );

  const htmlMinus = html.toLowerCase();
  assert.ok(!htmlMinus.includes('</script>'), 'no debe contener </script> sin escapar');
  assert.ok(!htmlMinus.includes('<img src=x'), 'no debe contener etiquetas <img inyectadas');
  assert.ok(!html.includes(`onerror="alert('${marca}')"`), 'no debe contener atributos de evento sin escapar');
  assert.ok(html.includes('&lt;/script&gt;'), 'debe contener el payload debidamente escapado');
});

// ───────────── src/http.js ─────────────

test('http: clasificarIp trata como no públicas direcciones IPv6 especiales y embebidas', () => {
  assert.notEqual(clasificarIp('::ffff:0:127.0.0.1'), 'publica', '::ffff:0:127.0.0.1 (IPv4-translated) no es pública');
  assert.equal(clasificarIp('0::1'), 'loopback');
  assert.equal(clasificarIp('::127.0.0.1'), 'loopback');
  assert.notEqual(clasificarIp('[::]'), 'publica');
  assert.equal(clasificarIp('1::'), 'privada', '1:: está fuera del bloque unicast global 2000::/3');
  assert.notEqual(clasificarIp('2002:7f00:1::'), 'publica', '2002:7f00:1:: (6to4 de 127.0.0.1) no es pública');
  assert.equal(clasificarIp('fe80::1%eth0'), 'privada');
});

test('http: clasificarNombre y esLoopback manejan mayúsculas, punto final, DNS rebinding y URLs raras', () => {
  assert.equal(clasificarNombre('localhost.'), 'loopback');
  assert.equal(clasificarNombre('LOCALHOST'), 'loopback');
  assert.notEqual(clasificarNombre('127.0.0.1.nip.io'), 'publica');

  assert.equal(esLoopback('http://127.0.0.1.:80/'), true);
  assert.equal(esLoopback('http://[0:0:0:0:0:ffff:7f00:1]/'), true);
  assert.notEqual(clasificarNombre(new URL('http://0/').hostname), 'publica');
  // 0.0.0.0 se trata como dirección interna (rechazada siempre), no como "la propia máquina"
  // (admitida con --permitir-local): es el lado seguro.
  assert.equal(esLoopback('http://0/'), false);
  assert.equal(clasificarNombre(new URL('http://0/').hostname), 'privada');
});

// ───────────── src/util.js ─────────────

test('util: esClaveSecreta, decodificarJwt y enmascarar ante no-cadenas, vacíos y base64 inválido', () => {
  for (const rara of [null, undefined, 12345, {}, [], Symbol('s'), Object.create(null)]) {
    assert.doesNotThrow(() => esClaveSecreta(rara));
    assert.equal(esClaveSecreta(rara), false);
    assert.doesNotThrow(() => decodificarJwt(rara));
    assert.equal(decodificarJwt(rara), null);
    assert.doesNotThrow(() => enmascarar(rara));
    assert.equal(enmascarar(rara), '', 'enmascarar de una entrada no cadena debe devolver cadena vacía');
  }

  assert.equal(esClaveSecreta(''), false);
  assert.equal(decodificarJwt(''), null);
  assert.equal(enmascarar(''), '');

  // JWT con caracteres inválidos en base64url (!@#) que Node Buffer.from(..., 'base64url') ignora silenciosamente
  const cabValida = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const cargaService = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  const jwtCorrupto = `${cabValida}.${cargaService}!!!@@@.firma`;
  assert.equal(decodificarJwt(jwtCorrupto), null, 'base64url inválido no debe decodificarse');

  // JWT cuyos segmentos decodifican a tipos JSON que no son objetos
  const nuloB64 = Buffer.from('null').toString('base64url');
  assert.equal(decodificarJwt(`${nuloB64}.${nuloB64}.firma`), null);
});