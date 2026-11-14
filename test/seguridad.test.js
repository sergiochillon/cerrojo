// Pruebas de las salvaguardas: límite de descarga, destinos prohibidos, redirecciones,
// restricción de la prueba de escritura y tope de filas leídas.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import zlib from 'node:zlib';
import { Cliente, clasificarIp, clasificarNombre, esLoopback } from '../src/http.js';
import { auditarWeb } from '../src/web.js';
import { probarAislamiento, LIMITE_MAXIMO } from '../src/aislamiento.js';
import { iniciarDemo } from '../demo/servidor.js';

const servidores = [];
after(async () => {
  for (const s of servidores) await new Promise((ok) => (s.closeAllConnections?.(), s.close(ok)));
});

/** Servidor local efímero. Devuelve su URL y un contador de peticiones recibidas. */
async function servir(manejador) {
  const estado = { peticiones: 0, cabeceras: [] };
  const s = createServer((req, res) => {
    estado.peticiones++;
    estado.cabeceras.push(req.headers);
    manejador(req, res, estado);
  });
  servidores.push(s);
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${s.address().port}`, puerto: s.address().port, estado };
}
const local = (extra = {}) => new Cliente({ pausaMs: 0, permitirLocal: true, ...extra });

// ───────────── 1. Límite de tamaño aplicado durante la descarga ─────────────

test('descarga: el límite corta la transferencia; no se carga la respuesta entera', async () => {
  let enviados = 0;
  let cerrada = false;
  const srv = await servir((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    const trozo = Buffer.alloc(64 * 1024, 'a');
    // Respuesta sin fin: solo se detiene si el cliente cierra la conexión.
    const bombear = () => {
      while (!cerrada && res.write(trozo)) enviados += trozo.length;
      enviados += trozo.length;
    };
    res.on('drain', bombear);
    res.on('close', () => (cerrada = true));
    bombear();
  });
  const antes = process.memoryUsage().arrayBuffers;
  const r = await local({ timeoutMs: 5000 }).pedir(srv.url, { maxBytes: 200_000 });
  assert.equal(r.estado, 200);
  assert.equal(r.truncada, true);
  assert.equal(r.texto.length, 200_000);
  await new Promise((ok) => setTimeout(ok, 100));
  assert.equal(cerrada, true, 'el cliente debe cerrar la conexión al alcanzar el límite');
  assert.ok(enviados < 20_000_000, `el servidor llegó a enviar ${enviados} bytes`);
  assert.ok(process.memoryUsage().arrayBuffers - antes < 30_000_000);
});

test('descarga: una respuesta comprimida enorme se corta sobre los bytes descomprimidos', async () => {
  const bomba = zlib.gzipSync(Buffer.alloc(60 * 1024 * 1024, 0)); // 60 MB → unos pocos KB
  assert.ok(bomba.length < 200_000);
  const srv = await servir((req, res) => {
    res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Type': 'text/javascript' });
    res.end(bomba);
  });
  const r = await local().pedir(srv.url, { maxBytes: 1_000_000 });
  assert.equal(r.truncada, true);
  assert.equal(r.texto.length, 1_000_000);
});

test('descarga: una respuesta pequeña llega completa y sin marcar como truncada', async () => {
  const simple = await servir((req, res) => {
    res.writeHead(200, { 'Content-Encoding': 'br' });
    res.end(zlib.brotliCompressSync('{"ok":true}'));
  });
  const r = await local().pedir(simple.url);
  assert.equal(r.texto, '{"ok":true}');
  assert.equal(r.truncada, false);
});

// ───────────── 2. Destinos prohibidos ─────────────

test('destinos: clasificación de direcciones IPv4 e IPv6', () => {
  const casos = {
    loopback: ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:0:0:1'],
    privada: [
      '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
      '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:c0a8:0101', '64:ff9b::a00:1', '2001:db8::1', 'no-es-una-ip',
    ],
    publica: ['1.1.1.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.167.1.1', '100.63.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'],
  };
  for (const [clase, ips] of Object.entries(casos)) for (const ip of ips) assert.equal(clasificarIp(ip), clase, ip);
});

test('destinos: clasificación por nombre y formas alternativas de escribir una IP', () => {
  assert.equal(clasificarNombre('localhost'), 'loopback');
  assert.equal(clasificarNombre('app.localhost'), 'loopback');
  assert.equal(clasificarNombre('LOCALHOST.'), 'loopback');
  for (const n of ['intranet', 'nas.local', 'db.internal', 'router.lan', 'metadata.google.internal']) assert.equal(clasificarNombre(n), 'privada', n);
  assert.equal(clasificarNombre('example.com'), null);
  // El analizador de URL normaliza las formas decimal, hexadecimal y abreviada de 127.0.0.1.
  for (const u of ['http://2130706433/', 'http://0x7f000001/', 'http://127.1/', 'http://0177.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/']) assert.equal(esLoopback(u), true, u);
});

test('destinos: por defecto no se hace ninguna petición a la propia máquina', async () => {
  const srv = await servir((req, res) => res.end('secreto interno'));
  const c = new Cliente({ pausaMs: 0 });
  for (const u of [srv.url, `http://localhost:${srv.puerto}/`, `http://[::1]:${srv.puerto}/`, `http://2130706433:${srv.puerto}/`]) {
    const r = await c.pedir(u);
    assert.match(r.error, /^destino_bloqueado/, u);
    assert.equal(r.texto, '');
  }
  assert.equal(srv.estado.peticiones, 0);
});

test('destinos: las direcciones privadas se rechazan siempre, también con --permitir-local', async () => {
  for (const permitirLocal of [false, true]) {
    const c = new Cliente({ pausaMs: 0, permitirLocal, timeoutMs: 1500 });
    for (const u of ['http://10.0.0.1/', 'http://192.168.1.1/admin', 'http://169.254.169.254/latest/meta-data/', 'http://[fd00::1]/', 'http://nas.local/', 'http://intranet/']) {
      assert.match((await c.pedir(u)).error, /^destino_bloqueado/, u);
    }
  }
  const raros = new Cliente({ pausaMs: 0 });
  assert.match((await raros.pedir('file:///etc/passwd')).error, /protocolo no admitido/);
  assert.match((await raros.pedir('https://usuario:clave@example.com/')).error, /credenciales incrustadas/);
});

test('destinos: un nombre público que resuelve a una dirección interna se rechaza', async () => {
  const srv = await servir((req, res) => res.end('interno'));
  for (const direcciones of [
    [{ address: '10.1.2.3', family: 4 }],
    [{ address: '127.0.0.1', family: 4 }],
    // Basta con que una de las direcciones sea interna.
    [{ address: '93.184.216.34', family: 4 }, { address: '192.168.0.10', family: 4 }],
  ]) {
    const c = new Cliente({ pausaMs: 0, resolver: async () => direcciones });
    const r = await c.pedir(`http://engano.example:${srv.puerto}/`);
    assert.match(r.error, /^destino_bloqueado/, JSON.stringify(direcciones));
  }
  assert.equal(srv.estado.peticiones, 0);
});

test('destinos: la conexión se fija a la IP validada (el DNS no puede cambiarla después)', async () => {
  const srv = await servir((req, res) => res.end(`host=${req.headers.host}`));
  let consultas = 0;
  const c = local({
    resolver: async () => {
      consultas++;
      // Si se volviera a resolver al conectar, la segunda respuesta apuntaría a otra parte.
      return consultas === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '10.9.9.9', family: 4 }];
    },
  });
  const r = await c.pedir(`http://app.example:${srv.puerto}/`);
  assert.equal(r.texto, `host=app.example:${srv.puerto}`);
  assert.equal(consultas, 1);
  assert.equal(srv.estado.peticiones, 1);
});

// ───────────── Redirecciones ─────────────

test('redirecciones: no se sigue una redirección hacia una dirección interna', async () => {
  const interno = await servir((req, res) => res.end('datos internos'));
  for (const destino of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://192.168.0.1/', 'http://nas.local/']) {
    const puente = await servir((req, res) => {
      res.writeHead(302, { Location: destino });
      res.end();
    });
    const r = await local().pedir(puente.url);
    assert.match(r.error, /^destino_bloqueado/, destino);
    assert.equal(r.texto, '');
  }
  // Y con el comportamiento por defecto tampoco hacia la propia máquina: se simula un sitio
  // público (resolver inyectado) que redirige a un servicio local.
  const puente = await servir((req, res) => {
    res.writeHead(307, { Location: `${interno.url}/admin` });
    res.end();
  });
  const publico = new Cliente({ pausaMs: 0, resolver: async () => [{ address: '127.0.0.1', family: 4 }] });
  publico.validarDestino = async function (url) {
    // Solo el primer salto se trata como público; el resto pasa por la validación real.
    if (url.hostname === 'sitio.example') return { address: '127.0.0.1', family: 4 };
    return Cliente.prototype.validarDestino.call(this, url);
  };
  const r = await publico.pedir(`http://sitio.example:${puente.puerto}/`);
  assert.match(r.error, /^destino_bloqueado/);
  assert.equal(interno.estado.peticiones, 0, 'no debe llegar ninguna petición al servicio interno');
});

test('redirecciones: al cambiar de origen se retiran las cabeceras con credenciales', async () => {
  const otro = await servir((req, res) => res.end('ok'));
  const primero = await servir((req, res) => {
    res.writeHead(302, { Location: `${otro.url}/destino` });
    res.end();
  });
  const r = await local().pedir(`${primero.url}/inicio`, { cabeceras: { apikey: 'clave-publica', Authorization: 'Bearer token-de-usuario', Accept: 'application/json' } });
  assert.equal(r.texto, 'ok');
  assert.equal(r.url, `${otro.url}/destino`);
  assert.equal(primero.estado.cabeceras[0].authorization, 'Bearer token-de-usuario');
  const recibidas = otro.estado.cabeceras[0];
  assert.equal(recibidas.authorization, undefined);
  assert.equal(recibidas.apikey, undefined);
  assert.equal(recibidas.accept, 'application/json');
});

test('redirecciones: hay un máximo de saltos', async () => {
  const bucle = await servir((req, res) => {
    res.writeHead(302, { Location: '/otra-vez' });
    res.end();
  });
  const r = await local().pedir(bucle.url);
  assert.equal(r.error, 'demasiadas_redirecciones');
  assert.equal(bucle.estado.peticiones, 6);
});

test('web: no se audita localhost sin --permitir-local, ni un backend interno declarado por la página', async () => {
  const demo = await iniciarDemo();
  try {
    await assert.rejects(auditarWeb(demo.url, { cliente: new Cliente({ pausaMs: 0 }) }), /destino_bloqueado/);
  } finally {
    await demo.cerrar();
  }
  // Una página (controlada por un tercero) que declara como backend la red interna del auditor.
  const trampa = await servir((req, res) => {
    if (req.url.startsWith('/app.js')) return res.end('const s=createClient("http://169.254.169.254","sb_publishable_aaaaaaaaaaaaaaaaaaaaaaaa");s.from("users")');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<script src="/app.js"></script>');
  });
  await assert.rejects(auditarWeb(trampa.url, { cliente: local() }), /no es un destino admisible/);
});

// ───────────── 3. La prueba de escritura ─────────────

function fetchContador() {
  const llamadas = [];
  const f = async (url, init) => {
    llamadas.push({ url: String(url), metodo: init.method });
    const u = new URL(url);
    if (u.pathname === '/auth/v1/token') {
      const { email } = JSON.parse(init.body);
      return new Response(JSON.stringify({ access_token: `t-${email}`, user: { id: email === 'a@x.test' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222' } }));
    }
    return new Response('[]', { headers: { 'Content-Range': '*/0' } });
  };
  return { f, llamadas };
}
const cuentas = { usuarioA: { correo: 'a@x.test', contrasena: 'x' }, usuarioB: { correo: 'b@x.test', contrasena: 'x' } };

test('escritura: contra un proyecto alojado se niega antes de hacer ninguna petición', async () => {
  for (const baseDesechable of [false, true]) {
    const { f, llamadas } = fetchContador();
    await assert.rejects(
      probarAislamiento({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', clave: 'sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx', tablas: ['notes'], ...cuentas, probarEscritura: true, baseDesechable, cliente: new Cliente({ pausaMs: 0, fetch: f }) }),
      /UPDATE real/,
    );
    assert.equal(llamadas.length, 0);
  }
});

test('escritura: en local también exige declarar la base como desechable', async () => {
  const demo = await iniciarDemo();
  try {
    await assert.rejects(
      probarAislamiento({ supabaseUrl: demo.url, clave: demo.claveAnon, tablas: ['clients'], usuarioA: demo.usuarios.A, usuarioB: demo.usuarios.B, probarEscritura: true, cliente: local() }),
      /desechable/,
    );
  } finally {
    await demo.cerrar();
  }
});

test('escritura: sin la opción no se envía ningún PATCH', async () => {
  const { f, llamadas } = fetchContador();
  const r = await probarAislamiento({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', clave: 'sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx', tablas: ['notes'], ...cuentas, cliente: new Cliente({ pausaMs: 0, fetch: f }) });
  assert.ok(llamadas.length > 0);
  assert.ok(llamadas.every((l) => l.metodo === 'GET' || l.url.includes('/auth/v1/token')));
  assert.equal(r.escrituraProbada, false);
});

test('escritura: es una escritura real — dispara los triggers aunque no cambie el valor', async () => {
  // Esta prueba documenta por qué la opción está restringida a bases desechables.
  const demo = await iniciarDemo();
  try {
    await demo.db.exec(`
      alter table public.clients add column updated_at timestamptz;
      create table public.rastro (id bigint generated always as identity primary key, cliente uuid);
      create function public.marcar() returns trigger language plpgsql as $$
        begin new.updated_at := now(); insert into public.rastro (cliente) values (new.id); return new; end $$;
      create trigger clients_marcar before update on public.clients for each row execute function public.marcar();
    `);
    const r = await probarAislamiento({ supabaseUrl: demo.url, clave: demo.claveAnon, tablas: ['clients'], usuarioA: demo.usuarios.A, usuarioB: demo.usuarios.B, probarEscritura: true, baseDesechable: true, cliente: local() });
    assert.ok(r.hallazgos.some((h) => h.id === 'A-ESCRITURA-CRUZADA'));
    assert.equal(r.escrituraProbada, true);
    const disparos = (await demo.db.query('select count(*)::int as n from public.rastro')).rows[0].n;
    const tocadas = (await demo.db.query('select count(*)::int as n from public.clients where updated_at is not null')).rows[0].n;
    assert.equal(disparos, 5, 'A actualiza las 3 filas de B y B las 2 de A');
    assert.equal(tocadas, 5, 'la base queda distinta de como estaba');
    assert.ok(r.notas.some((n) => /UPDATE reales/.test(n.es)));
  } finally {
    await demo.cerrar();
  }
});

// ───────────── 4. Filas leídas ─────────────

test('lectura: nunca se piden más de 1.000 filas por cuenta y tabla, y el resultado lo declara', async () => {
  assert.equal(LIMITE_MAXIMO, 1000);
  for (const [pedido, esperado] of [[50_000, 1000], [undefined, 1000], [25, 25], [0, 1000], [-3, 1], ['abc', 1000]]) {
    const { f, llamadas } = fetchContador();
    const r = await probarAislamiento({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', clave: 'sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx', tablas: ['notes'], ...cuentas, limite: pedido, cliente: new Cliente({ pausaMs: 0, fetch: f }) });
    const lecturas = llamadas.filter((l) => l.url.includes('/rest/v1/notes'));
    assert.equal(lecturas.length, 2);
    for (const l of lecturas) assert.equal(new URL(l.url).searchParams.get('limit'), String(esperado), `limite=${pedido}`);
    assert.equal(r.lectura.limitePorCuentaYTabla, esperado);
  }
});

test('lectura: el resultado y el informe dicen cuántas filas completas se descargaron', async () => {
  const demo = await iniciarDemo();
  try {
    const r = await probarAislamiento({ supabaseUrl: demo.url, clave: demo.claveAnon, tablas: ['clients', 'invoices'], usuarioA: demo.usuarios.A, usuarioB: demo.usuarios.B, cliente: local() });
    // clients: A y B ven las 6 filas cada uno (12). invoices: A ve 2 y B ve 1 (3).
    assert.equal(r.lectura.filasDescargadas, 15);
    assert.ok(r.notas.some((n) => /se descargaron 15 fila\(s\) completas/.test(n.es)));
    assert.ok(r.notas.some((n) => /No se probó la escritura/.test(n.es)));
  } finally {
    await demo.cerrar();
  }
});
