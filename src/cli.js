// Línea de comandos de cerrojo.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { auditarWeb } from './web.js';
import { probarAislamiento, LIMITE_MAXIMO } from './aislamiento.js';
import { auditarRepo } from './repo.js';
import { generarInforme, resumenTexto } from './informe.js';
import { Cliente, esLoopback } from './http.js';
import { GRAVEDADES, sinControl } from './util.js';

const AYUDA = `cerrojo — ¿pueden los usuarios de una app sobre Supabase ver datos de otros usuarios?

Uso:
  cerrojo web <url> --autorizo [opciones]        Qué expone la app desplegada a un visitante sin sesión
  cerrojo aislamiento --autorizo [opciones]      ¿Un usuario registrado puede ver datos de otro?
  cerrojo repo <carpeta>                         Revisión estática de migraciones SQL y código (sin red)
  cerrojo informe <resultado.json>... [opciones] Informe HTML entregable a partir de los resultados

Opciones comunes:
  --salida <archivo>        Dónde guardar el resultado (por defecto, carpeta salida/)
  --ci                      Termina con código 1 si hay hallazgos críticos o altos
  --permitir-local          Admite como destino la propia máquina (127.0.0.1, localhost). Hace
                            falta para la demo o un Supabase local, pero OJO: no se limita a
                            ellos. Mientras está puesta, la herramienta acepta CUALQUIER servicio
                            que escuche en esta máquina (bases de datos, paneles, otros
                            servidores), también si una página redirige hacia él. No la uses al
                            auditar la app de un tercero. Sin esta opción, "web" y "aislamiento"
                            rechazan localhost. Las direcciones privadas o internas (10.x,
                            192.168.x, 169.254.x, *.local, *.internal…) se rechazan siempre,
                            también cuando se llega a ellas por una redirección.

  Solo se admite la clave PÚBLICA del proyecto. Con una clave secreta (sb_secret_… o
  service_role) la herramienta se niega a conectarse.

cerrojo web:
  --supabase-url <url>      Si no se detecta sola (dominio propio o proxy)
  --clave <clave pública>   Clave anon/publishable, si no se detecta sola
  --tablas a,b,c            Tablas adicionales que comprobar
  Qué lee: el HTML y el JavaScript público de la app y, por cada tabla que la app usa, UNA
  fila con la clave pública (para saber si es legible y con qué columnas). Los valores de esa
  fila no se guardan, pero se descargan.

cerrojo aislamiento:
  --desde <web.json>        Toma URL, clave pública y tablas de un resultado de "cerrojo web"
  --config <archivo.json>   {"supabaseUrl","clave","tablas":[],"usuarioA":{"correo","contrasena"},"usuarioB":{...}}
  --tablas a,b,c            Tablas que comprobar
  --limite <n>              Filas que leer por cuenta y tabla (por defecto y como máximo, 1000)
  Las credenciales de las cuentas de prueba también se leen de las variables de entorno
  CERROJO_A_CORREO, CERROJO_A_CONTRASENA, CERROJO_B_CORREO, CERROJO_B_CONTRASENA
  (y CERROJO_SUPABASE_URL, CERROJO_CLAVE). No se aceptan como argumentos para que no
  queden en el historial de la terminal.

  QUÉ LEE. Inicia sesión con las dos cuentas y descarga FILAS COMPLETAS: hasta 1000 por
  cuenta y por tabla, con todos sus valores. Las compara en memoria y en el resultado solo
  deja recuentos y nombres de columna, pero los datos llegan a esta máquina. Si las políticas
  fallan, entre esas filas habrá datos de otros usuarios. Recomendación: ejecútalo en un
  entorno de pruebas o con una base cargada con datos ficticios, y usa --limite para leer menos.

  --probar-escritura        SOLO para una base LOCAL Y DESECHABLE. Ejecuta un UPDATE real sobre
  --base-desechable         las filas de la otra cuenta. Asigna a una columna el valor que ya
                            tiene, pero NO es inocuo: dispara triggers (updated_at, auditoría,
                            webhooks, correos), genera eventos de Realtime y puede dejar la
                            base distinta de como estaba. Exige a la vez --permitir-local,
                            --base-desechable y un Supabase en 127.0.0.1/localhost; contra un
                            proyecto alojado se niega a ejecutarse. En producción, la escritura
                            se evalúa leyendo las políticas ("cerrojo repo").

cerrojo informe:
  --manual <archivo.json>   Añade al informe lo que aporta la revisión manual: hallazgos propios,
                            hallazgos automáticos descartados (con su motivo) y lo que quedó sin
                            revisar. Plantilla en docs/revision-manual.ejemplo.json
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
  const conValor = new Set(['salida', 'supabase-url', 'clave', 'tablas', 'desde', 'config', 'idioma', 'cliente', 'auditor', 'app', 'limite', 'manual']);
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

/**
 * Lee el archivo de la revisión manual y lo convierte en un resultado más para el informe.
 * Formato: { "hallazgos": [{titulo, gravedad, donde, observado, porque, arreglo}],
 *            "descartar": [{id, donde, motivo}], "noRevisado": ["…"] }
 */
export function leerRevisionManual(ruta) {
  const d = leerJson(ruta);
  const fallo = (m) => {
    throw new Error(`Revisión manual (${ruta}): ${m}`);
  };
  const hallazgos = (d.hallazgos ?? []).map((h, i) => {
    if (!h.titulo || !h.donde) fallo(`el hallazgo ${i + 1} necesita "titulo" y "donde".`);
    if (!GRAVEDADES.includes(h.gravedad)) fallo(`el hallazgo ${i + 1} tiene una gravedad no válida ("${h.gravedad}"). Usa: ${GRAVEDADES.join(', ')}.`);
    return { id: 'MANUAL', gravedad: h.gravedad, donde: String(h.donde), texto: { titulo: String(h.titulo), detalle: String(h.observado ?? ''), porque: String(h.porque ?? ''), arreglo: String(h.arreglo ?? '') } };
  });
  const descartar = (d.descartar ?? []).map((x, i) => {
    if (!x.id || !x.donde || !x.motivo) fallo(`el descarte ${i + 1} necesita "id", "donde" y "motivo".`);
    return { id: String(x.id), donde: String(x.donde), motivo: String(x.motivo) };
  });
  return { herramienta: 'cerrojo', tipo: 'manual', objetivo: d.alcance ? String(d.alcance) : 'Revisión manual', fin: new Date().toISOString(), hallazgos, descartar, noRevisado: (d.noRevisado ?? []).map(String), superadas: [], notas: [] };
}

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
  const avisar = (s) => process.stderr.write(`· ${sinControl(s)}\n`);
  let resultado;

  if (!orden || orden === 'ayuda' || orden === '--help' || orden === '-h' || op.help) {
    process.stdout.write(AYUDA);
    return 0;
  }

  if (orden === 'web') {
    if (!pos[0]) throw new Error('Falta la URL. Ejemplo: cerrojo web https://mi-app.example --autorizo');
    const url = /^https?:\/\//.test(pos[0]) ? pos[0] : `https://${pos[0]}`;
    const autorizacion = exigirAutorizacion(op, url);
    resultado = await auditarWeb(url, { supabaseUrl: op['supabase-url'], clave: op.clave, tablas: lista(op.tablas), avisar, cliente: new Cliente({ permitirLocal: !!op['permitir-local'] }) });
    resultado.autorizacion = autorizacion;
  } else if (orden === 'aislamiento') {
    const cfg = op.config ? leerJson(op.config) : {};
    const web = op.desde ? leerJson(op.desde) : null;
    const esObjeto = (x) => x && typeof x === 'object' && !Array.isArray(x);
    if (!esObjeto(cfg)) throw new Error('El archivo de --config debe contener un objeto JSON.');
    if (cfg.tablas !== undefined && !Array.isArray(cfg.tablas)) throw new Error('En --config, "tablas" debe ser una lista: ["tabla1", "tabla2"].');
    for (const u of ['usuarioA', 'usuarioB']) if (cfg[u] !== undefined && !esObjeto(cfg[u])) throw new Error(`En --config, "${u}" debe ser un objeto {"correo", "contrasena"}.`);
    if (web !== null && !esObjeto(web)) throw new Error('El archivo de --desde no es un resultado de "cerrojo web".');
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
    if (!esLoopback(supabaseUrl)) {
      process.stderr.write(
        '\nAVISO: vas a ejecutar la prueba contra un proyecto alojado.\n' +
          `Se descargarán filas completas (hasta ${Math.min(Number(op.limite) || LIMITE_MAXIMO, LIMITE_MAXIMO)} por cuenta y tabla). Si las políticas fallan,\n` +
          'entre ellas habrá datos de otros usuarios. Hazlo solo con cuentas de prueba y, si es\n' +
          'posible, en un entorno de pruebas con datos ficticios.\n\n',
      );
    }
    resultado = await probarAislamiento({
      supabaseUrl,
      clave,
      tablas,
      usuarioA,
      usuarioB,
      probarEscritura: !!op['probar-escritura'],
      baseDesechable: !!op['base-desechable'] && !!op['permitir-local'],
      limite: op.limite ? Number(op.limite) : undefined,
      cliente: new Cliente({ maxPeticiones: 400, permitirLocal: !!op['permitir-local'] }),
      avisar,
    });
    resultado.autorizacion = autorizacion;
  } else if (orden === 'repo') {
    resultado = auditarRepo(resolve(pos[0] ?? '.'));
  } else if (orden === 'informe') {
    if (!pos.length) throw new Error('Indica al menos un archivo de resultado (.json).');
    const resultados = pos.map(leerJson);
    if (op.manual) resultados.push(leerRevisionManual(op.manual));
    const html = generarInforme(resultados, { idioma: op.idioma, cliente: op.cliente, auditor: op.auditor, app: op.app });
    const ruta = guardar(resolve(op.salida ?? `salida/informe-${marca()}.html`), html);
    process.stdout.write(`Informe guardado en ${ruta}\n`);
    return 0;
  } else {
    throw new Error(`Orden desconocida: ${orden}. Prueba "cerrojo ayuda".`);
  }

  const ruta = guardar(resolve(op.salida ?? `salida/${resultado.tipo}-${marca()}.json`), JSON.stringify(resultado, null, 2));
  process.stdout.write(`${sinControl(resumenTexto(resultado))}\n\nResultado guardado en ${ruta}\n`);
  const graves = resultado.hallazgos.some((h) => h.gravedad === 'critica' || h.gravedad === 'alta');
  return op.ci && graves ? 1 : 0;
}
