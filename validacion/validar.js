// Validación de cerrojo contra un proyecto Supabase de PRUEBAS, con datos sintéticos.
//
// Qué hace: ejecuta las mismas llamadas que usa la herramienta (lectura sin sesión, inicio de
// sesión con dos cuentas de prueba, lectura con sesión, listado de buckets) contra las tablas
// creadas por 01_esquema.sql y 02_datos.sql, y compara lo observado con lo esperado.
//
// Qué NO hace, por construcción:
//   · no modifica datos: solo hace lecturas (GET), inicios de sesión y listados de archivos
//     (ambos POST, que no alteran tablas), y no ofrece ninguna opción de escritura;
//   · no se conecta a localhost ni a redes privadas (usa el cliente con sus valores por
//     defecto, sin "permitir local");
//   · no acepta nada que no sea https://<ref>.supabase.co;
//   · no sigue adelante si el proyecto no contiene la marca que deja 01_esquema.sql;
//   · no guarda ni muestra claves, tokens, contraseñas ni valores de filas.
//
// La única huella que deja en el proyecto es la inevitable: cada inicio de sesión crea una
// sesión en el servicio de autenticación.
//
// Uso (ver GUION.md):
//   node --env-file=validacion/.env validacion/validar.js

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Cliente } from '../src/http.js';
import { Supabase } from '../src/supabase.js';
import { probarAislamiento } from '../src/aislamiento.js';
import { decodificarJwt, esClaveSecreta } from '../src/util.js';

export const FRASE_DE_CONFIRMACION = 'es-un-proyecto-de-pruebas-con-datos-sinteticos';
export const MARCA = { tabla: 'cv_marca', proposito: 'cerrojo-validacion' };
export const BUCKETS = { listable: 'cv-listable', privado: 'cv-privado' };

/** Lo que debe verse sin sesión, con la clave pública. */
export const ESPERADO_SIN_SESION = {
  cv_marca: { estado: 'ok', total: 1 },
  cv_sin_rls: { estado: 'ok', total: 5 },
  cv_solo_sesion: { estado: 'ok', total: 0 },
  cv_por_dueno: { estado: 'ok', total: 0 },
  cv_rls_sin_politicas: { estado: 'ok', total: 0 },
  cv_sin_permisos: { estado: 'denegado' },
  cv_vista_sin_invoker: { estado: 'ok', total: 3 },
  cv_vista_con_invoker: { estado: 'ok', total: 0 },
  cv_mensajes: { estado: 'ok', total: 0 },
  cv_volumen: { estado: 'ok', total: 0 },
  cv_no_existe: { estado: 'no_existe' },
};

/** Lo que debe concluir la prueba de aislamiento. A y B son las filas que ve cada cuenta. */
export const ESPERADO_AISLAMIENTO = {
  cv_marca: { resultado: 'sin_dueno', A: 1, B: 1 },
  cv_sin_rls: { resultado: 'fuga', columnaDueno: 'user_id', A: 5, B: 5, lecturas: [{ quien: 'A', ajenas: 3, delOtro: 3 }, { quien: 'B', ajenas: 2, delOtro: 2 }] },
  cv_solo_sesion: { resultado: 'fuga', columnaDueno: 'user_id', A: 4, B: 4, lecturas: [{ quien: 'A', ajenas: 2, delOtro: 2 }, { quien: 'B', ajenas: 2, delOtro: 2 }] },
  cv_por_dueno: { resultado: 'aislada', columnaDueno: 'user_id', A: 2, B: 1 },
  cv_rls_sin_politicas: { resultado: 'sin_datos', A: 0, B: 0 },
  cv_sin_permisos: { resultado: 'denegada' },
  cv_vista_sin_invoker: { resultado: 'fuga', columnaDueno: 'user_id', A: 3, B: 3, lecturas: [{ quien: 'A', ajenas: 1, delOtro: 1 }, { quien: 'B', ajenas: 2, delOtro: 2 }] },
  cv_vista_con_invoker: { resultado: 'aislada', columnaDueno: 'user_id', A: 2, B: 1 },
  cv_mensajes: { resultado: 'aislada', columnaDueno: 'remitente_id', A: 2, B: 2 },
  cv_volumen: { resultado: 'aislada', columnaDueno: 'user_id', A: 1200, B: 0 },
  cv_no_existe: { resultado: 'no_existe' },
};

export const TABLAS = Object.keys(ESPERADO_AISLAMIENTO);

// Filas completas que debe descargar la prueba de aislamiento si el proyecto conserva el
// máximo por defecto de 1.000 filas por petición.
export const FILAS_ESPERADAS = 1036;

/**
 * Envuelve al cliente HTTP para dejar constancia de cada petición SIN guardar nada sensible:
 * método, ruta, estado, cabecera Content-Range, código y mensaje de error de la API y número
 * de filas. Nunca cuerpos de respuesta, cabeceras de autenticación ni cuerpos de petición.
 */
export class Registrador {
  constructor(cliente) {
    this.cliente = cliente;
    this.peticiones = [];
  }
  get hechas() {
    return this.cliente.hechas;
  }
  validarDestino(url) {
    return this.cliente.validarDestino(url);
  }
  async pedir(url, op = {}) {
    const r = await this.cliente.pedir(url, op);
    const u = new URL(url);
    const apunte = { metodo: op.metodo ?? 'GET', ruta: u.pathname + u.search, estado: r.estado };
    if (r.error) apunte.error = r.error;
    const rango = r.cabeceras?.get('content-range');
    if (rango) apunte.contentRange = rango;
    const esDatos = u.pathname.startsWith('/rest/') || u.pathname.startsWith('/storage/');
    if (esDatos) {
      let cuerpo;
      try {
        cuerpo = JSON.parse(r.texto);
      } catch {
        /* sin cuerpo JSON */
      }
      if (Array.isArray(cuerpo)) apunte.filas = cuerpo.length;
      else if (cuerpo && r.estado >= 400) {
        // Los errores de la API describen el problema (tabla, permiso); no contienen filas.
        if (cuerpo.code) apunte.codigo = limpiarMensaje(cuerpo.code).slice(0, 20);
        if (cuerpo.message) apunte.mensaje = limpiarMensaje(cuerpo.message);
        if (cuerpo.hint) apunte.pista = limpiarMensaje(cuerpo.hint);
      }
    }
    this.peticiones.push(apunte);
    return r;
  }
}

/**
 * Los mensajes de error de la API describen el problema (tabla, permiso) y no deberían
 * contener datos; aun así, antes de guardarlos se enmascara todo lo que tenga forma de
 * token, clave, correo o identificador.
 */
export function limpiarMensaje(texto) {
  return String(texto)
    .replace(/eyJ[A-Za-z0-9_-]{6,}(\.[A-Za-z0-9_-]+){0,2}/g, '[token]')
    .replace(/\bsb_(publishable|secret)_[A-Za-z0-9_-]+/g, '[clave]')
    .replace(/[^\s@"']+@[^\s@"']+\.[^\s@"']+/g, '[correo]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]')
    .slice(0, 160);
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const recortar = (obj, claves) => Object.fromEntries(claves.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

/**
 * Lee la marca que deja 01_esquema.sql. Si no está, lanza un error: es la defensa contra
 * ejecutar la validación, por descuido, contra un proyecto que no es el de pruebas.
 * @param {Supabase} sb
 */
export async function comprobarMarca(sb) {
  const marca = await sb.leer(MARCA.tabla, { limite: 1 });
  if (marca.estado === 'ok' && marca.filas[0]?.proposito === MARCA.proposito) return;
  const motivo = marca.estado === 'ok' ? 'la tabla existe pero no contiene la marca' : `estado "${marca.estado}", HTTP ${marca.http}${marca.mensaje ? `: ${limpiarMensaje(marca.mensaje)}` : ''}`;
  const e = new Error(`No encuentro la marca de validación (${MARCA.tabla}): ${motivo}. O este no es el proyecto de pruebas, o falta ejecutar 01_esquema.sql, o la clave no es válida. No se ha hecho ninguna otra petición.`);
  e.codigo = 'sin_marca';
  throw e;
}

/**
 * Ejecuta la validación. No decide a qué proyecto se conecta: eso lo hace quien llama
 * (`principal`, más abajo, con sus comprobaciones previas).
 *
 * @param {{
 *   cliente: Cliente, supabaseUrl: string, clave: string,
 *   usuarioA: {correo: string, contrasena: string}, usuarioB: {correo: string, contrasena: string},
 *   conStorage?: boolean
 * }} op
 */
export async function ejecutarValidacion(op) {
  const reg = new Registrador(op.cliente);
  const sb = new Supabase(reg, op.supabaseUrl, op.clave);
  const comprobaciones = [];
  const apuntar = (id, descripcion, esperado, observado, extra = {}) => comprobaciones.push({ id, descripcion, esperado, observado, ok: igual(esperado, observado), ...extra });

  // 0. La marca. Si no está, este no es el proyecto de pruebas y no se hace nada más.
  await comprobarMarca(sb);

  // 1. Lectura sin sesión, tabla por tabla (una fila cada una, como hace "cerrojo web").
  for (const [tabla, esperado] of Object.entries(ESPERADO_SIN_SESION)) {
    const r = await sb.leer(tabla, { limite: 1 });
    const observado = r.estado === 'ok' ? { estado: r.estado, total: r.total } : { estado: r.estado };
    apuntar(`sin-sesion/${tabla}`, `Sin sesión: ${tabla}`, esperado, observado, { http: r.http });
  }

  // 2. Una clave pública que no existe debe reconocerse como tal, no como "tabla protegida".
  const falsa = new Supabase(reg, op.supabaseUrl, `sb_publishable_${'x'.repeat(24)}`);
  const conClaveFalsa = await falsa.leer(MARCA.tabla, { limite: 1 });
  apuntar('clave-invalida', 'Una clave inexistente se identifica como clave no válida', { estado: 'clave_invalida' }, { estado: conClaveFalsa.estado }, { http: conClaveFalsa.http });

  // 3. El esquema no debe poder consultarse con la clave pública (retirado por Supabase en 2026).
  const esquema = await sb.esquema();
  apuntar('esquema-publico', 'El esquema (OpenAPI) no es accesible con la clave pública', { accesible: false }, { accesible: esquema !== null });

  // 4. El endpoint público de ajustes de autenticación tiene los campos que la herramienta lee.
  const ajustes = await sb.ajustesAuth();
  apuntar(
    'ajustes-auth',
    'Los ajustes públicos de autenticación traen los campos esperados',
    { disponible: true, mailer_autoconfirm: 'boolean', disable_signup: 'boolean' },
    { disponible: ajustes !== null, mailer_autoconfirm: typeof ajustes?.mailer_autoconfirm, disable_signup: typeof ajustes?.disable_signup },
    { valores: ajustes ? { mailer_autoconfirm: ajustes.mailer_autoconfirm, disable_signup: ajustes.disable_signup } : null },
  );

  // 5. Aislamiento entre las dos cuentas de prueba. SOLO LECTURA: no se pasa ninguna opción
  //    de escritura, y contra un proyecto alojado la herramienta la rechazaría igualmente.
  const aislamiento = await probarAislamiento({ supabaseUrl: op.supabaseUrl, clave: op.clave, tablas: TABLAS, usuarioA: op.usuarioA, usuarioB: op.usuarioB, cliente: reg });
  for (const [tabla, esperado] of Object.entries(ESPERADO_AISLAMIENTO)) {
    const fila = aislamiento.matriz.find((m) => m.tabla === tabla) ?? {};
    const lecturas = aislamiento.hallazgos.find((h) => h.id === 'A-LECTURA-CRUZADA' && h.datos.tabla === tabla)?.datos.lecturas;
    const observado = recortar({ ...fila, columnaDueno: fila.columnaDueno ?? undefined, lecturas }, Object.keys(esperado));
    apuntar(`aislamiento/${tabla}`, `Entre cuentas: ${tabla}`, esperado, observado);
  }
  apuntar('aislamiento/sin-escritura', 'La prueba de aislamiento no ha escrito nada', { escrituraProbada: false, metodos: [] }, { escrituraProbada: aislamiento.escrituraProbada, metodos: [...new Set(reg.peticiones.map((p) => p.metodo).filter((m) => !['GET', 'POST'].includes(m)))] });
  apuntar('aislamiento/filas-descargadas', 'Filas completas descargadas (con el máximo por defecto de 1.000 por petición)', FILAS_ESPERADAS, aislamiento.lectura.filasDescargadas, { informativa: true });

  // 6. Opcional: listado de buckets sin sesión.
  if (op.conStorage) {
    const listable = await sb.listarBucket(BUCKETS.listable);
    apuntar('storage/listable', `Sin sesión: se pueden listar archivos de ${BUCKETS.listable}`, { lista: true }, { lista: (listable ?? 0) > 0 });
    const privado = await sb.listarBucket(BUCKETS.privado);
    apuntar('storage/privado', `Sin sesión: no se listan archivos de ${BUCKETS.privado}`, { lista: false }, { lista: (privado ?? 0) > 0 });
  }

  return {
    herramienta: 'cerrojo',
    tipo: 'validacion',
    objetivo: new URL(op.supabaseUrl).host,
    fecha: new Date().toISOString(),
    claveTipo: op.clave.startsWith('eyJ') ? 'anon-jwt' : 'publishable',
    comprobaciones,
    peticiones: reg.peticiones,
    // Mismo formato que produce "cerrojo aislamiento": sirve de entrada a "cerrojo informe".
    aislamiento,
  };
}

/** Comprobaciones previas a cualquier petición. Devuelve la lista de motivos para no seguir. */
export function motivosParaNoEmpezar(env) {
  const motivos = [];
  const url = env.CERROJO_SUPABASE_URL ?? '';
  const clave = env.CERROJO_CLAVE ?? '';

  if (env.CERROJO_VALIDACION_CONFIRMO !== FRASE_DE_CONFIRMACION) {
    motivos.push(`Falta la confirmación. Define CERROJO_VALIDACION_CONFIRMO=${FRASE_DE_CONFIRMACION} solo si el proyecto es de pruebas y sus datos son sintéticos.`);
  }
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url)) {
    motivos.push('CERROJO_SUPABASE_URL debe tener la forma https://<referencia de 20 caracteres>.supabase.co. No se admiten localhost, dominios propios ni otras direcciones.');
  }
  const rol = decodificarJwt(clave)?.carga?.role;
  if (esClaveSecreta(clave)) {
    motivos.push('CERROJO_CLAVE es una clave SECRETA (sb_secret_ o service_role). No la uses aquí ni la guardes en este archivo: revócala en el panel y pon la clave pública (publishable).');
  } else if (!clave.startsWith('sb_publishable_') && rol !== 'anon') {
    motivos.push('CERROJO_CLAVE debe ser la clave pública del proyecto: sb_publishable_… (o, si el proyecto aún las tiene, la clave "anon" antigua).');
  }
  for (const [letra, nombre] of [['A', 'cerrojo-a'], ['B', 'cerrojo-b']]) {
    const correo = env[`CERROJO_${letra}_CORREO`] ?? '';
    // "cerrojo-a@dominio" o un alias "loquesea+cerrojo-a@dominio"; nada más.
    if (!new RegExp(`^(?:[^@\\s]+\\+)?${nombre}@[^@\\s]+$`, 'i').test(correo)) {
      motivos.push(`CERROJO_${letra}_CORREO debe ser la cuenta de prueba ${nombre}@… (o un alias terminado en +${nombre}@…). No uses cuentas de personas reales.`);
    }
    if (!env[`CERROJO_${letra}_CONTRASENA`]) motivos.push(`Falta CERROJO_${letra}_CONTRASENA.`);
  }
  return motivos;
}

const corto = (v) => JSON.stringify(v).replace(/"/g, '');

function imprimir(resultado, escribir) {
  const fallos = resultado.comprobaciones.filter((c) => !c.ok && !c.informativa);
  escribir(`\nProyecto: ${resultado.objetivo} · clave: ${resultado.claveTipo}\n`);
  for (const c of resultado.comprobaciones) {
    const signo = c.ok ? '✔' : c.informativa ? '·' : '✘';
    escribir(`${signo} ${c.descripcion}`);
    if (!c.ok) escribir(`    esperado:  ${corto(c.esperado)}\n    observado: ${corto(c.observado)}${c.http ? `  (HTTP ${c.http})` : ''}`);
  }
  const auth = resultado.comprobaciones.find((c) => c.id === 'ajustes-auth')?.valores;
  if (auth) escribir(`\nAjustes de autenticación que declara el proyecto: mailer_autoconfirm=${auth.mailer_autoconfirm}, disable_signup=${auth.disable_signup}\n(compáralos con Authentication → Sign In / Providers en el panel).`);
  escribir('\nPeticiones realizadas (sin cuerpos ni credenciales):');
  for (const p of resultado.peticiones) {
    const detalle = [p.contentRange && `Content-Range ${p.contentRange}`, p.filas !== undefined && `${p.filas} fila(s)`, p.codigo && `código ${p.codigo}`, p.mensaje, p.error].filter(Boolean).join(' · ');
    escribir(`  ${p.metodo.padEnd(4)} ${String(p.estado).padEnd(3)} ${p.ruta}${detalle ? `  →  ${detalle}` : ''}`);
  }
  escribir(`\n${resultado.comprobaciones.length - fallos.length} de ${resultado.comprobaciones.length} comprobaciones coinciden con lo esperado.${fallos.length ? ` ${fallos.length} NO coinciden: consulta "Cómo interpretar cada resultado" en GUION.md.` : ''}`);
  return fallos.length;
}

async function principal() {
  const escribir = (s) => process.stdout.write(`${s}\n`);
  const motivos = motivosParaNoEmpezar(process.env);
  if (motivos.length) {
    process.stderr.write(`No se ha hecho ninguna petición.\n\n${motivos.map((m) => `  · ${m}`).join('\n')}\n\nSigue los pasos de validacion/GUION.md.\n`);
    return 2;
  }
  const env = process.env;
  let resultado;
  try {
    resultado = await ejecutarValidacion({
      // Cliente con sus valores por defecto: sin acceso a localhost ni a redes privadas.
      cliente: new Cliente({ maxPeticiones: 80 }),
      supabaseUrl: env.CERROJO_SUPABASE_URL.replace(/\/+$/, ''),
      clave: env.CERROJO_CLAVE,
      usuarioA: { correo: env.CERROJO_A_CORREO, contrasena: env.CERROJO_A_CONTRASENA },
      usuarioB: { correo: env.CERROJO_B_CORREO, contrasena: env.CERROJO_B_CONTRASENA },
      conStorage: env.CERROJO_VALIDAR_STORAGE === '1',
    });
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    return 2;
  }
  const fallos = imprimir(resultado, escribir);
  const carpeta = join(dirname(fileURLToPath(import.meta.url)), '..', 'salida');
  mkdirSync(carpeta, { recursive: true });
  const { aislamiento, ...validacion } = resultado;
  const ruta = join(carpeta, `validacion-${resultado.fecha.replace(/[:.]/g, '-').slice(0, 19)}.json`);
  writeFileSync(ruta, JSON.stringify(validacion, null, 2));
  const rutaAislamiento = join(carpeta, 'validacion-aislamiento.json');
  writeFileSync(rutaAislamiento, JSON.stringify(aislamiento, null, 2));
  escribir(`\nDetalle guardado en ${ruta}`);
  escribir(`Resultado de aislamiento, en el formato de la herramienta: ${rutaAislamiento}`);
  escribir('(la carpeta salida/ no se versiona).');
  return fallos ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await principal());
}
