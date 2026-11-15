// Avisos de resultado no concluyente y revisión manual en el informe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { iniciarDemo } from '../demo/servidor.js';
import { auditarWeb } from '../src/web.js';
import { auditarRepo } from '../src/repo.js';
import { generarInforme, consolidar, resumenTexto } from '../src/informe.js';
import { leerRevisionManual } from '../src/cli.js';
import { Cliente } from '../src/http.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliente = () => new Cliente({ pausaMs: 0, permitirLocal: true });

test('clave rechazada: no se da por protegida ninguna tabla y el informe dice que no es concluyente', async () => {
  const demo = await iniciarDemo();
  try {
    // Una clave pública que el proyecto no reconoce: todo responde "no autorizado".
    const r = await auditarWeb(demo.url, { clave: `sb_publishable_${'x'.repeat(24)}`, cliente: cliente() });
    assert.ok(r.avisos.some((a) => /RECHAZA la clave pública/.test(a.es)), JSON.stringify(r.avisos));
    assert.ok(!r.hallazgos.some((h) => h.id === 'S-TABLA-LEGIBLE-ANON'));
    assert.ok(!r.superadas.some((s) => /Sin sesión no se obtiene ninguna fila/.test(s.es)), 'no debe presentarse como comprobación superada');
    assert.match(resumenTexto(r), /NO CONCLUYENTE/);
    const html = generarInforme([{ ...r, hallazgos: r.hallazgos.filter((h) => h.gravedad !== 'critica' && h.gravedad !== 'alta') }]);
    assert.match(html, /Resultado NO concluyente/);
    assert.match(html, /Avisos: lo que no se ha podido comprobar/);
    assert.doesNotMatch(html, /no han encontrado problemas/);
    // Con la clave buena, el mismo proyecto sí tiene tablas legibles y no hay aviso de clave.
    const bien = await auditarWeb(demo.url, { cliente: cliente() });
    assert.ok(!bien.avisos.some((a) => /clave/i.test(a.es)));
    assert.ok(bien.hallazgos.some((h) => h.id === 'S-TABLA-LEGIBLE-ANON'));
  } finally {
    await demo.cerrar();
  }
});

test('sin proyecto o sin tablas detectadas: aviso en vez de informe limpio', async () => {
  const { createServer } = await import('node:http');
  const servir = async (js) => {
    const s = createServer((req, res) => (req.url === '/app.js' ? res.end(js) : res.writeHead(200, { 'Content-Type': 'text/html' }).end('<script src="/app.js"></script>')));
    await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
    return s;
  };
  const sinSupabase = await servir('console.log("una web cualquiera")');
  const demo = await iniciarDemo();
  const sinTablas = await servir(`const s=createClient(${JSON.stringify(demo.url)},${JSON.stringify(demo.claveAnon)});`);
  try {
    const a = await auditarWeb(`http://127.0.0.1:${sinSupabase.address().port}/`, { cliente: cliente() });
    assert.ok(a.avisos.some((x) => /No se detectó un proyecto de Supabase/.test(x.es)));
    const b = await auditarWeb(`http://127.0.0.1:${sinTablas.address().port}/`, { cliente: cliente() });
    assert.ok(b.avisos.some((x) => /No se encontró ningún nombre de tabla/.test(x.es)));
    assert.match(generarInforme([{ ...b, hallazgos: [] }]), /Resultado NO concluyente/);
  } finally {
    await demo.cerrar();
    for (const s of [sinSupabase, sinTablas]) await new Promise((ok) => s.close(ok));
  }
});

test('revisión manual: hallazgos propios, descartes con motivo y lo no revisado', () => {
  const repo = auditarRepo(join(RAIZ, 'demo', 'app-vulnerable'));
  const manual = leerRevisionManual(join(RAIZ, 'docs', 'revision-manual.ejemplo.json'));
  const antes = consolidar([repo]);
  const despues = consolidar([repo, manual]);
  assert.ok(antes.hallazgos.some((h) => h.id === 'R-POLITICA-LECTURA-ABIERTA' && h.donde === 'public.plans'));
  assert.ok(!despues.hallazgos.some((h) => h.id === 'R-POLITICA-LECTURA-ABIERTA' && h.donde === 'public.plans'));
  // Solo se descarta la coincidencia exacta: el mismo fallo en otra tabla sigue en el informe.
  assert.ok(despues.hallazgos.some((h) => h.id === 'R-POLITICA-LECTURA-ABIERTA' && h.donde === 'public.profiles'));
  assert.equal(despues.descartados.length, 1);
  assert.equal(despues.hallazgos.length, antes.hallazgos.length); // −1 descartado, +1 manual
  const posicion = despues.hallazgos.findIndex((h) => h.id === 'MANUAL');
  assert.ok(posicion >= 0 && posicion < despues.cuenta.critica, 'el hallazgo manual crítico va con los críticos');

  const html = generarInforme([repo, manual]);
  assert.match(html, /La función delete-account acepta el id de usuario/);
  assert.match(html, /Hallazgos automáticos descartados tras la revisión manual/);
  assert.match(html, /es el catálogo de planes y es público a propósito/);
  assert.match(html, /No revisado: Lógica de pagos y webhooks de Stripe/);
  assert.match(html, /Revisión manual de políticas, Edge Functions y configuración/);
  assert.doesNotMatch(html, /Autorización:/, 'sin pruebas de red no se menciona la autorización');
});

test('revisión manual: el texto del auditor también se escapa y se valida', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cerrojo-'));
  try {
    const ruta = join(dir, 'm.json');
    writeFileSync(ruta, JSON.stringify({ hallazgos: [{ titulo: '<script>alert(1)</script>', gravedad: 'alta', donde: '"><img src=x>', observado: '<b>x</b>', arreglo: '</pre><script>' }], noRevisado: ['<i>pagos</i>'] }));
    const html = generarInforme([leerRevisionManual(ruta)]);
    assert.doesNotMatch(html, /<script>alert|<img src=x>|<b>x<\/b>|<i>pagos<\/i>|<\/pre><script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

    writeFileSync(ruta, JSON.stringify({ hallazgos: [{ titulo: 'x', gravedad: 'gravísima', donde: 'y' }] }));
    assert.throws(() => leerRevisionManual(ruta), /gravedad no válida/);
    writeFileSync(ruta, JSON.stringify({ descartar: [{ id: 'R-SIN-RLS', donde: 'public.t' }] }));
    assert.throws(() => leerRevisionManual(ruta), /necesita "id", "donde" y "motivo"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: cerrojo informe --manual genera el informe completo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cerrojo-'));
  try {
    const cerrojo = (...a) => spawnSync(process.execPath, [join(RAIZ, 'bin', 'cerrojo.js'), ...a], { encoding: 'utf8' });
    assert.equal(cerrojo('repo', join(RAIZ, 'demo', 'app-vulnerable'), '--salida', join(dir, 'repo.json')).status, 0);
    const r = cerrojo('informe', join(dir, 'repo.json'), '--manual', join(RAIZ, 'docs', 'revision-manual.ejemplo.json'), '--idioma', 'en', '--salida', join(dir, 'i.html'));
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(join(dir, 'i.html'), 'utf8');
    assert.match(html, /Automated findings dismissed after manual review/);
    assert.match(html, /Not reviewed: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
