// Demostración completa, en local y sin tocar ningún sistema ajeno:
//   1. arranca la app ficticia vulnerable,
//   2. la audita por fuera (sin sesión),
//   3. ejecuta la prueba de aislamiento con dos cuentas de prueba,
//   4. revisa su repositorio,
//   5. genera el informe entregable en español e inglés.
//
// Uso: npm run demo

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { iniciarDemo } from './servidor.js';
import { auditarWeb } from '../src/web.js';
import { probarAislamiento } from '../src/aislamiento.js';
import { auditarRepo } from '../src/repo.js';
import { generarInforme, resumenTexto } from '../src/informe.js';
import { Cliente } from '../src/http.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const aDocs = process.argv.includes('--docs');
const salida = join(RAIZ, aDocs ? 'docs' : 'salida');
mkdirSync(salida, { recursive: true });

// Con --docs el puerto es fijo para que el informe de ejemplo no cambie en cada generación.
const demo = await iniciarDemo({ puerto: aDocs ? 54321 : undefined });
const decir = (s) => process.stdout.write(`${s}\n`);
try {
  decir(`App ficticia vulnerable en ${demo.url}\n`);

  decir('1/3 · Aplicación desplegada, sin sesión');
  const web = await auditarWeb(demo.url, { cliente: new Cliente({ pausaMs: 0, permitirLocal: true }) });
  decir(`${resumenTexto(web)}\n`);

  decir('2/3 · Aislamiento entre dos cuentas de prueba');
  const aislamiento = await probarAislamiento({
    supabaseUrl: web.supabase.url,
    clave: web.supabase.clavePublica,
    tablas: web.superficie.tablas,
    usuarioA: demo.usuarios.A,
    usuarioB: demo.usuarios.B,
    // La base de la demo vive en memoria y se destruye al terminar: es desechable de verdad.
    probarEscritura: true,
    baseDesechable: true,
    cliente: new Cliente({ pausaMs: 0, permitirLocal: true }),
  });
  decir(`${resumenTexto(aislamiento)}\n`);

  decir('3/3 · Repositorio');
  const repo = auditarRepo(join(RAIZ, 'demo', 'app-vulnerable'));
  decir(`${resumenTexto(repo)}\n`);

  // En el informe publicado como ejemplo no debe figurar el puerto aleatorio ni la clave local.
  const resultados = [web, aislamiento, repo];
  const meta = { cliente: 'Clientia (app ficticia de demostración)', auditor: 'cerrojo · demo', app: 'Clientia — entorno local de demostración', fecha: aDocs ? '2026-11-14' : undefined };
  const es = join(salida, aDocs ? 'ejemplo-informe.html' : 'demo-informe.html');
  const en = join(salida, aDocs ? 'sample-report.html' : 'demo-report.html');
  writeFileSync(es, generarInforme(resultados, { ...meta, idioma: 'es' }));
  writeFileSync(en, generarInforme(resultados, { ...meta, idioma: 'en', cliente: 'Clientia (fictional demo app)', app: 'Clientia — local demo environment' }));
  decir(`Informe en español: ${es}`);
  decir(`Informe en inglés:  ${en}`);
} finally {
  await demo.cerrar();
}
