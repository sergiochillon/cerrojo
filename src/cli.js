// Línea de comandos de cerrojo.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { auditarWeb } from './web.js';
import { probarAislamiento } from './aislamiento.js';
import { auditarRepo } from './repo.js';
import { generarInforme, resumenTexto } from './informe.js';
import { Cliente } from './http.js';

const AYUDA = `cerrojo — auditoría de seguridad para apps hechas con IA sobre Supabase

Uso:
  cerrojo web <url> --autorizo [opciones]        Qué expone la app desplegada a un visitante sin sesión
  cerrojo aislamiento --autorizo [opciones]      ¿Un usuario registrado puede ver o tocar datos de otro?
  cerrojo repo <carpeta>                         Revisión estática de migraciones SQL y código
  cerrojo informe <resultado.json>... [opciones] Informe HTML entregable a partir de los resultados

Opciones comunes:
  --salida <archivo>        Dónde guardar el resultado (por defecto, carpeta salida/)
  --ci                      Termina con código 1 si hay hallazgos críticos o altos

cerrojo web:
  --supabase-url <url>      Si no se detecta sola (dominio propio o proxy)
  --clave <clave pública>   Clave anon/publishable, si no se detecta sola
  --tablas a,b,c            Tablas adicionales que comprobar

cerrojo aislamiento:
  --desde <web.json>        Toma URL, clave pública y tablas de un resultado de "cerrojo web"
  --config <archivo.json>   {"supabaseUrl","clave","tablas":[],"usuarioA":{"correo","contrasena"},"usuarioB":{...}}
  --tablas a,b,c            Tablas que comprobar
  --probar-escritura        Además intenta una actualización SIN cambios sobre filas de la otra cuenta
  Las credenciales de las cuentas de prueba también se leen de las variables de entorno
  CERROJO_A_CORREO, CERROJO_A_CONTRASENA, CERROJO_B_CORREO, CERROJO_B_CONTRASENA
  (y CERROJO_SUPABASE_URL, CERROJO_CLAVE). No se aceptan como argumentos para que no
  queden en el historial de la terminal.

cerrojo informe:
  --idioma es|en            Idioma del informe (por defecto es)
  --cliente <nombre>        Para quién es el informe
  --auditor <nombre>        Quién firma la auditoría
  --app <nombre o url>      Nombre de la aplicación auditada

Autorización:
  "web" y "aislamiento" hacen peticiones a sistemas reales. Solo pueden ejecutarse sobre
  aplicaciones propias o con autorización escrita de su titular; --autorizo lo declara
  y queda registrado en el resultado.
`;

function parsear(argv) {
  const pos = [];
  const op = {};
  const conValor = new Set(['salida', 'supabase-url', 'clave', 'tablas', 'desde', 'config', 'idioma', 'cliente', 'auditor', 'app', 'limite']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (conValor.has(k)) op[k] = v ?? argv[++i];
      else op[k] = true;
    } else pos.push(a);
  }
  return { pos, op };
}

function guardar(ruta, contenido) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido);
  return ruta;
}

const marca = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const lista = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);
const leerJson = (ruta) => JSON.parse(readFileSync(ruta, 'utf8'));

function exigirAutorizacion(op, objetivo) {
  if (op.autorizo) return { declarada: true, fecha: new Date().toISOString(), objetivo };
  process.stderr.write(
    `\nEsta orden hace peticiones a un sistema real (${objetivo}).\n` +
      'Ejecútala solo sobre una aplicación tuya o con autorización escrita de su titular.\n' +
      'Hacerlo sobre sistemas ajenos sin permiso puede ser delito (art. 197 bis del Código Penal español).\n\n' +
      'Si tienes esa autorización, repite la orden añadiendo --autorizo\n\n',
  );
  process.exit(2);
}

export async function main(argv) {
  const [orden, ...resto] = argv;
  const { pos, op } = parsear(resto);
  const avisar = (s) => process.stderr.write(`· ${s}\n`);
  let resultado;

  if (!orden || orden === 'ayuda' || orden === '--help' || orden === '-h' || op.help) {
    process.stdout.write(AYUDA);
    return 0;
  }

  if (orden === 'web') {
    if (!pos[0]) throw new Error('Falta la URL. Ejemplo: cerrojo web https://mi-app.example --autorizo');
    const url = /^https?:\/\//.test(pos[0]) ? pos[0] : `https://${pos[0]}`;
    const autorizacion = exigirAutorizacion(op, url);
    resultado = await auditarWeb(url, { supabaseUrl: op['supabase-url'], clave: op.clave, tablas: lista(op.tablas), avisar });
    resultado.autorizacion = autorizacion;
  } else if (orden === 'aislamiento') {
    const cfg = op.config ? leerJson(op.config) : {};
    const web = op.desde ? leerJson(op.desde) : null;
    const env = process.env;
    const supabaseUrl = cfg.supabaseUrl ?? env.CERROJO_SUPABASE_URL ?? web?.supabase?.url;
    const clave = cfg.clave ?? env.CERROJO_CLAVE ?? web?.supabase?.clavePublica;
    const tablas = [...new Set([...(cfg.tablas ?? []), ...lista(op.tablas), ...(web?.superficie?.tablas ?? [])])];
    const usuarioA = cfg.usuarioA ?? { correo: env.CERROJO_A_CORREO, contrasena: env.CERROJO_A_CONTRASENA };
    const usuarioB = cfg.usuarioB ?? { correo: env.CERROJO_B_CORREO, contrasena: env.CERROJO_B_CONTRASENA };
    const faltan = [
      !supabaseUrl && 'URL de Supabase',
      !clave && 'clave pública',
      !tablas.length && 'lista de tablas',
      !(usuarioA.correo && usuarioA.contrasena) && 'credenciales de la cuenta A',
      !(usuarioB.correo && usuarioB.contrasena) && 'credenciales de la cuenta B',
    ].filter(Boolean);
    if (faltan.length) throw new Error(`Faltan datos: ${faltan.join(', ')}. Consulta "cerrojo ayuda".`);
    const autorizacion = exigirAutorizacion(op, supabaseUrl);
    resultado = await probarAislamiento({
      supabaseUrl,
      clave,
      tablas,
      usuarioA,
      usuarioB,
      probarEscritura: !!op['probar-escritura'],
      limite: op.limite ? Number(op.limite) : undefined,
      cliente: new Cliente({ maxPeticiones: 400 }),
      avisar,
    });
    resultado.autorizacion = autorizacion;
  } else if (orden === 'repo') {
    resultado = auditarRepo(resolve(pos[0] ?? '.'));
  } else if (orden === 'informe') {
    if (!pos.length) throw new Error('Indica al menos un archivo de resultado (.json).');
    const resultados = pos.map(leerJson);
    const html = generarInforme(resultados, { idioma: op.idioma, cliente: op.cliente, auditor: op.auditor, app: op.app });
    const ruta = guardar(resolve(op.salida ?? `salida/informe-${marca()}.html`), html);
    process.stdout.write(`Informe guardado en ${ruta}\n`);
    return 0;
  } else {
    throw new Error(`Orden desconocida: ${orden}. Prueba "cerrojo ayuda".`);
  }

  const ruta = guardar(resolve(op.salida ?? `salida/${resultado.tipo}-${marca()}.json`), JSON.stringify(resultado, null, 2));
  process.stdout.write(`${resumenTexto(resultado)}\n\nResultado guardado en ${ruta}\n`);
  const graves = resultado.hallazgos.some((h) => h.gravedad === 'critica' || h.gravedad === 'alta');
  return op.ci && graves ? 1 : 0;
}
