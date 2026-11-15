// Paso OPCIONAL de la validación: una página mínima, servida solo en esta máquina, que imita
// lo que publica una app real (la URL del proyecto y su clave PÚBLICA dentro del JavaScript).
// Sirve para probar "cerrojo web" de principio a fin contra el proyecto de pruebas.
//
// AVISO. Para auditar una página servida en tu máquina hay que pasar --permitir-local a
// "cerrojo web". Esa opción no distingue esta página de cualquier otro servicio que escuche
// en tu equipo (bases de datos, paneles de administración, otros servidores de desarrollo):
// mientras esté puesta, la herramienta aceptará como destino cualquier puerto de localhost.
// Úsala solo con la URL exacta que imprime este programa y no la dejes en alias ni scripts.
//
// La página no contiene ningún secreto: la clave pública está pensada para ir en el navegador.
// No se escribe ningún archivo; la página existe solo mientras este proceso está en marcha.
//
// Uso (ver GUION.md):
//   node --env-file=validacion/.env validacion/pagina.js

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { motivosParaNoEmpezar, comprobarMarca, ESPERADO_SIN_SESION, BUCKETS } from './validar.js';
import { Cliente } from '../src/http.js';
import { Supabase } from '../src/supabase.js';

/** Crea (sin arrancar) el servidor de la página de pruebas. */
export function crearPagina({ supabaseUrl, clave }) {
  const tablas = Object.keys(ESPERADO_SIN_SESION);
  const js =
    `const s=createClient(${JSON.stringify(supabaseUrl)},${JSON.stringify(clave)});\n` +
    tablas.map((t) => `s.from(${JSON.stringify(t)}).select("*");`).join('\n') +
    `\ns.storage.from(${JSON.stringify(BUCKETS.listable)}).list();\ns.storage.from(${JSON.stringify(BUCKETS.privado)}).list();\n`;
  const html = '<!doctype html><html lang="es"><meta charset="utf-8"><title>cerrojo · página de validación</title><script type="module" src="/app.js"></script><p>Página de validación de cerrojo. Datos sintéticos.</p></html>';
  return createServer((req, res) => {
    if (req.method !== 'GET') return res.writeHead(405).end();
    if (req.url === '/app.js') return res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(js);
    if (req.url === '/') return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('no encontrado');
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const motivos = motivosParaNoEmpezar(process.env);
  if (motivos.length) {
    process.stderr.write(`No se ha arrancado nada.\n\n${motivos.map((m) => `  · ${m}`).join('\n')}\n\nSigue los pasos de validacion/GUION.md.\n`);
    process.exit(2);
  }
  const supabaseUrl = process.env.CERROJO_SUPABASE_URL.replace(/\/+$/, '');
  // Igual que el validador: si el proyecto no lleva la marca, no se sirve nada. (Una lectura,
  // con el cliente por defecto: sin acceso a localhost ni a redes privadas.)
  try {
    await comprobarMarca(new Supabase(new Cliente({ maxPeticiones: 2 }), supabaseUrl, process.env.CERROJO_CLAVE));
  } catch (e) {
    process.stderr.write(`No se ha arrancado nada. ${e.message}\n`);
    process.exit(2);
  }
  const puerto = Number(process.env.CERROJO_PAGINA_PUERTO ?? 8787);
  const servidor = crearPagina({ supabaseUrl, clave: process.env.CERROJO_CLAVE });
  // Solo 127.0.0.1: la página no es accesible desde otros equipos de la red.
  servidor.listen(puerto, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${puerto}/`;
    process.stdout.write(
      `Página de validación en ${url}  (Ctrl+C para parar)\n\n` +
        'En otra terminal:\n' +
        `  node bin/cerrojo.js web ${url} --autorizo --permitir-local --salida salida/validacion-web.json\n\n` +
        'AVISO: --permitir-local acepta como destino CUALQUIER servicio de esta máquina, no solo\n' +
        'esta página. Úsalo únicamente con la URL de arriba y para esta orden.\n',
    );
  });
}
