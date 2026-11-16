// Auditoría externa de una app desplegada: qué revela su código público y qué deja leer
// su backend de Supabase a un visitante sin sesión.
//
// Regla de este módulo: "no se pudo comprobar" nunca se presenta como "está protegido". Todo
// lo que impide concluir va a `avisos`, que el informe muestra en primer plano.

import { Cliente } from './http.js';
import { extraer, fusionar } from './extraer.js';
import { Supabase } from './supabase.js';
import { hallazgo } from './catalogo.js';
import { ahoraIso, categoriasSensibles, gravedadPorCategorias, esIdentificador, esClaveSecreta, AVISO_CLAVE_SECRETA, sinControl } from './util.js';

const CABECERAS_ESPERADAS = [
  ['content-security-policy', 'Content-Security-Policy'],
  ['strict-transport-security', 'Strict-Transport-Security'],
  ['x-content-type-options', 'X-Content-Type-Options'],
  ['referrer-policy', 'Referrer-Policy'],
];
const MAX_ETIQUETAS = 5000;

/**
 * Devuelve el valor del atributo `atributo` de las etiquetas `<nombre …>` que cumplan
 * `filtro`. Recorrido lineal y acotado: el HTML lo escribe un tercero.
 */
export function atributosDeEtiquetas(html, nombre, atributo, filtro = null) {
  const valores = [];
  const minusculas = html.toLowerCase();
  const apertura = `<${nombre}`;
  const reAtributo = new RegExp(String.raw`\s${atributo}\s{0,5}=\s{0,5}["']([^"']{1,2000})["']`, 'i');
  let vistas = 0;
  for (let i = minusculas.indexOf(apertura); i !== -1 && vistas < MAX_ETIQUETAS; i = minusculas.indexOf(apertura, i + apertura.length)) {
    vistas++;
    const trozo = html.slice(i, i + 4000);
    const fin = trozo.indexOf('>');
    if (fin === -1) continue;
    const etiqueta = trozo.slice(0, fin);
    if (filtro && !filtro.test(etiqueta)) continue;
    const m = reAtributo.exec(etiqueta);
    if (m) valores.push(m[1]);
  }
  return valores;
}

/**
 * @param {string} urlApp
 * @param {{supabaseUrl?: string, clave?: string, tablas?: string[], maxArchivos?: number, cliente?: Cliente, avisar?: (s: string) => void}} [op]
 */
export async function auditarWeb(urlApp, op = {}) {
  const cliente = op.cliente ?? new Cliente();
  const avisar = op.avisar ?? (() => {});
  if (op.clave && esClaveSecreta(op.clave)) throw new Error(AVISO_CLAVE_SECRETA);
  const inicio = ahoraIso();
  const hallazgos = [];
  const superadas = [];
  const notas = [];
  // Motivos por los que el resultado NO permite concluir nada. Van destacados en el informe:
  // un informe sin hallazgos solo vale si no hay ninguno de estos avisos.
  const avisos = [];

  const base = new URL(urlApp);
  avisar(`Descargando ${base.href}`);
  const pagina = await cliente.pedir(base.href);
  if (!pagina.ok) throw new Error(`No se pudo abrir ${base.href}: ${pagina.error ?? `HTTP ${pagina.estado}`}`);
  // La página puede haber redirigido; a partir de aquí manda el origen final, ya validado.
  const final = new URL(pagina.url);
  const origen = final.origin;
  let bloqueadas = 0;
  let recortadas = 0;
  let sinPresupuesto = false;
  // Mismo cliente, pero recordando si se agotó el máximo de peticiones.
  const red = {
    pedir: async (url, opciones) => {
      const r = await cliente.pedir(url, opciones);
      if (r.error === 'limite_de_peticiones') sinPresupuesto = true;
      return r;
    },
  };

  // 1. Código público: HTML + JavaScript del mismo origen.
  const pendientes = [];
  const anotar = (ref, desde) => {
    try {
      const u = new URL(ref, desde);
      if (u.origin === origen && !pendientes.includes(u.href)) pendientes.push(u.href);
    } catch {
      /* referencia no válida */
    }
  };
  for (const src of atributosDeEtiquetas(pagina.texto, 'script', 'src')) anotar(src, pagina.url);
  for (const href of atributosDeEtiquetas(pagina.texto, 'link', 'href', /modulepreload/i)) anotar(href, pagina.url);

  const extraidos = [extraer(pagina.texto, '(HTML)')];
  const maxArchivos = op.maxArchivos ?? 40;
  const mapas = [];
  for (let i = 0; i < pendientes.length && i < maxArchivos; i++) {
    const url = pendientes[i];
    const r = await red.pedir(url, { maxBytes: 8_000_000 });
    if (r.error?.startsWith('destino_bloqueado')) bloqueadas++;
    if (r.truncada) recortadas++;
    // Una SPA responde con su index.html a rutas que no existen: eso no es JavaScript.
    if (!r.ok || /^\s*<(!doctype html|html[\s>])/i.test(r.texto.slice(0, 300))) continue;
    const e = extraer(r.texto, new URL(url).pathname);
    extraidos.push(e);
    if (e.mapaFuente) {
      try {
        mapas.push(new URL(e.mapaFuente, url).href);
      } catch {
        /* URL de mapa no válida */
      }
    }
    // Trozos cargados dinámicamente: import("./assets/x.js"), "./chunks/api-1a2b.js"…
    for (const m of r.texto.matchAll(/["'`]((?:\.{0,2}\/)?(?:[A-Za-z0-9_-]{1,60}\/){0,4}[A-Za-z0-9._-]{1,120}\.js)["'`]/g)) anotar(m[1], url);
  }
  if (pendientes.length > maxArchivos) {
    avisos.push({
      es: `La app tiene ${pendientes.length} archivos JavaScript y solo se analizaron ${maxArchivos}: puede haber tablas o claves en los que faltan.`,
      en: `The app has ${pendientes.length} JavaScript files and only ${maxArchivos} were analysed: tables or keys may be in the missing ones.`,
    });
  }
  if (bloqueadas) notas.push({ es: `${bloqueadas} archivo(s) no se descargaron porque redirigían a una dirección local, privada o interna.`, en: `${bloqueadas} file(s) were not downloaded because they redirected to a local, private or internal address.` });
  if (recortadas) notas.push({ es: `${recortadas} archivo(s) superaban 8 MB y solo se analizó su comienzo.`, en: `${recortadas} file(s) exceeded 8 MB and only their beginning was analysed.` });
  const visto = fusionar(extraidos);
  avisar(`Analizados ${extraidos.length - 1} archivos JavaScript`);

  for (const s of visto.secretos) {
    hallazgos.push(hallazgo(s.servicio ? 'W-CLAVE-SERVICIO' : 'W-SECRETO-TERCERO', 'critica', s.archivo, { tipo: s.tipo, archivo: s.archivo, muestra: s.muestra }));
  }
  if (!visto.secretos.length) superadas.push({ es: 'No se han encontrado claves secretas con formato reconocible en el código público analizado.', en: 'No secret keys with a recognisable format were found in the analysed public code.' });

  // 2. Archivos que no deberían servirse. Una SPA responde 200 con su index.html a cualquier
  //    ruta, así que se exige que el contenido tenga el formato esperado.
  let rutasSinRespuesta = 0;
  const respondio = (r) => !r.error && r.estado > 0 && r.estado < 500;
  for (const ruta of ['/.env', '/.env.local', '/.env.production']) {
    const r = await red.pedir(origen + ruta, { maxBytes: 20000 });
    if (!respondio(r)) rutasSinRespuesta++;
    const lineas = r.ok && !/<html|<!doctype/i.test(r.texto) ? r.texto.split('\n').filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l.trim())).length : 0;
    if (lineas > 0) hallazgos.push(hallazgo('W-ENV-EXPUESTO', 'critica', ruta, { ruta, variables: lineas }));
  }
  {
    const r = await red.pedir(`${origen}/.git/config`, { maxBytes: 5000 });
    if (!respondio(r)) rutasSinRespuesta++;
    if (r.ok && /^\s*\[core\]/m.test(r.texto)) hallazgos.push(hallazgo('W-GIT-EXPUESTO', 'alta', '/.git/config', { ruta: '/.git/config' }));
  }
  if (rutasSinRespuesta) {
    notas.push({ es: `No se pudo comprobar si se sirven .env o .git: ${rutasSinRespuesta} petición(es) sin respuesta clara del servidor.`, en: `Could not check whether .env or .git are served: ${rutasSinRespuesta} request(s) got no clear answer from the server.` });
  } else if (!hallazgos.some((h) => h.id === 'W-ENV-EXPUESTO' || h.id === 'W-GIT-EXPUESTO')) {
    superadas.push({ es: 'Los archivos .env y la carpeta .git no se sirven públicamente.', en: '.env files and the .git folder are not publicly served.' });
  }

  let mapasAccesibles = 0;
  let ejemploMapa = '';
  for (const m of mapas.slice(0, 3)) {
    const r = await red.pedir(m, { maxBytes: 300 });
    if (r.ok && /"version"\s*:/.test(r.texto)) {
      mapasAccesibles++;
      ejemploMapa ||= new URL(m).pathname;
    }
  }
  if (mapasAccesibles) hallazgos.push(hallazgo('W-MAPAS-FUENTE', 'baja', ejemploMapa, { total: mapasAccesibles, ejemplo: ejemploMapa }));

  // HSTS solo tiene sentido sobre HTTPS; se mira la URL final, no la que se escribió.
  const faltan = CABECERAS_ESPERADAS.filter(([k]) => !pagina.cabeceras?.get(k) && !(k === 'strict-transport-security' && final.protocol === 'http:')).map(([, n]) => n);
  const csp = pagina.cabeceras?.get('content-security-policy') ?? '';
  if (!pagina.cabeceras?.get('x-frame-options') && !/frame-ancestors/i.test(csp)) faltan.push('X-Frame-Options / frame-ancestors');
  if (faltan.length) hallazgos.push(hallazgo('W-CABECERAS', 'baja', origen, { faltan }));

  // 3. Backend de Supabase visto por un visitante sin sesión.
  // La URL sale del código de la página (dato no fiable): se normaliza y se valida como
  // cualquier otro destino antes de enviarle nada.
  let supabaseUrl = null;
  const urlsDeclaradas = op.supabaseUrl ? [op.supabaseUrl] : [...visto.urlsSupabase];
  for (const declarada of urlsDeclaradas) {
    try {
      const u = new URL(declarada);
      await cliente.validarDestino(u);
      supabaseUrl = u.origin;
      break;
    } catch (e) {
      if (urlsDeclaradas.length === 1) throw new Error(`El backend que declara la app (${sinControl(declarada).slice(0, 200)}) no es un destino admisible: ${e.message}`);
    }
  }
  const candidatas = op.clave ? [{ clave: op.clave, tipo: op.clave.startsWith('eyJ') ? 'anon-jwt' : 'publishable' }] : ordenarClaves(visto.clavesPublicas, supabaseUrl);
  const tablas = new Set([...visto.tablas, ...(op.tablas ?? [])].filter(esIdentificador));
  const superficie = { tablas: [], rpc: [...visto.rpc].sort(), funciones: [...visto.funciones].sort(), buckets: [...visto.buckets].sort() };
  const tablasEstado = {};
  let candidata = candidatas[0] ?? null;

  if (!supabaseUrl || !candidata) {
    avisos.push({
      es: 'No se detectó un proyecto de Supabase (URL y clave pública) en el código de la app, así que NO se ha comprobado ninguna tabla. Si la app usa un dominio propio o un proxy, indícalo con --supabase-url y --clave.',
      en: 'No Supabase project (URL and public key) was detected in the app code, so NO table was checked. If the app uses a custom domain or proxy, pass --supabase-url and --clave.',
    });
  } else {
    avisar(`Proyecto Supabase: ${supabaseUrl}`);
    // Con una clave caducada o mal copiada, todas las tablas responden "no autorizado" y
    // parecerían protegidas. Se prueba cada clave candidata contra un endpoint que no depende
    // de ninguna tabla y se usa la primera que el proyecto acepta.
    let sb = null;
    let estadoClave = 'rechazada';
    for (const c of candidatas.slice(0, 4)) {
      sb = new Supabase(red, supabaseUrl, c.clave);
      candidata = c;
      estadoClave = await sb.estadoClave();
      if (estadoClave === 'aceptada') break;
    }
    const claveDudosa = estadoClave !== 'aceptada';
    if (candidata.tipo === 'anon-jwt') hallazgos.push(hallazgo('S-CLAVE-HEREDADA', 'info', supabaseUrl));
    if (estadoClave === 'rechazada') {
      avisos.push({
        es: 'El proyecto RECHAZA la clave pública detectada (puede estar caducada, revocada o mal copiada). Las respuestas "no autorizado" de las tablas no significan que estén protegidas: el resultado sobre tablas y archivos NO es concluyente. Repite con la clave correcta (--clave).',
        en: 'The project REJECTS the detected public key (it may be expired, revoked or mistyped). "Unauthorized" responses from tables do not mean they are protected: the result on tables and files is NOT conclusive. Re-run with the correct key (--clave).',
      });
    } else if (estadoClave === 'desconocido') {
      avisos.push({
        es: 'No se pudo confirmar que el proyecto acepte la clave pública detectada (el servicio de autenticación no respondió como se esperaba). Trata como no concluyente cualquier tabla que figure como protegida.',
        en: 'Could not confirm that the project accepts the detected public key (the auth service did not respond as expected). Treat any table reported as protected as inconclusive.',
      });
    }

    const esquema = await sb.esquema();
    if (esquema?.error) {
      notas.push({ es: 'No se pudo comprobar si el esquema de la base de datos es consultable con la clave pública (sin respuesta clara).', en: 'Could not check whether the database schema can be queried with the public key (no clear answer).' });
    } else if (esquema) {
      hallazgos.push(hallazgo('S-ESQUEMA-PUBLICO', 'baja', `${supabaseUrl}/rest/v1/`, { tablas: esquema.tablas.length, funciones: esquema.funciones.length }));
      for (const t of esquema.tablas) tablas.add(t);
      for (const f of esquema.funciones) if (!superficie.rpc.includes(f)) superficie.rpc.push(f);
    } else if (!claveDudosa) {
      superadas.push({ es: 'El esquema de la base de datos no se puede consultar con la clave pública.', en: 'The database schema cannot be queried with the public key.' });
    }

    const ajustes = await sb.ajustesAuth();
    if (ajustes?.mailer_autoconfirm === true && ajustes?.disable_signup !== true) hallazgos.push(hallazgo('S-REGISTRO-SIN-VERIFICAR', 'media', `${supabaseUrl}/auth/v1/settings`));

    const conError = [];
    for (const t of [...tablas].sort()) {
      const r = await sb.leer(t);
      tablasEstado[t] = r.estado;
      if (r.estado === 'no_existe') continue;
      superficie.tablas.push(t);
      if (r.estado === 'error' || r.estado === 'clave_invalida') {
        conError.push(t);
      } else if (r.estado === 'ok' && (r.filas.length > 0 || (r.total ?? 0) > 0)) {
        // Solo se conservan los nombres de columna; los valores se descartan aquí mismo.
        const columnas = Object.keys(r.filas[0] ?? {}).slice(0, 200).map((c) => sinControl(c).slice(0, 80));
        const categorias = categoriasSensibles([t, ...columnas]);
        hallazgos.push(hallazgo('S-TABLA-LEGIBLE-ANON', gravedadPorCategorias(categorias), `public.${t}`, { tabla: t, filas: r.total ?? r.filas.length, columnas, categorias }));
      }
    }
    if (superficie.tablas.length) {
      notas.push({
        es: 'Para saber si cada tabla es legible sin sesión se pidió una fila por tabla con la clave pública. Los valores recibidos se descartaron; en el informe solo constan recuentos y nombres de columna.',
        en: 'To check whether each table is readable without a session, one row per table was requested with the public key. Received values were discarded; the report only holds counts and column names.',
      });
    }
    if (conError.length && !claveDudosa) {
      avisos.push({
        es: `No se pudo comprobar (error del servidor, límite de frecuencia o respuesta inesperada): ${conError.join(', ')}. Esas tablas NO figuran como protegidas; repite la orden más tarde.`,
        en: `Could not be checked (server error, rate limit or unexpected response): ${conError.join(', ')}. Those tables are NOT reported as protected; re-run later.`,
      });
    }
    if (!tablas.size) {
      avisos.push({
        es: 'No se encontró ningún nombre de tabla en el código público de la app, así que no se ha comprobado ninguna. Indica las tablas con --tablas (el titular puede listarlas desde su panel).',
        en: 'No table name was found in the app public code, so none was checked. Pass the tables with --tablas (the owner can list them from the dashboard).',
      });
    } else if (!claveDudosa) {
      // "Cerrada" solo si el servidor respondió con claridad: sin filas, o acceso denegado.
      const cerradas = superficie.tablas.filter((t) => tablasEstado[t] === 'denegado' || (tablasEstado[t] === 'ok' && !hallazgos.some((h) => h.id === 'S-TABLA-LEGIBLE-ANON' && h.datos.tabla === t)));
      if (cerradas.length) {
        superadas.push({
          es: `Sin sesión no se obtiene ninguna fila de: ${cerradas.join(', ')}. (Esto no prueba que un usuario registrado no vea filas ajenas: para eso está la prueba de aislamiento.)`,
          en: `Without a session no rows are returned from: ${cerradas.join(', ')}. (This does not prove a signed-in user cannot see others’ rows: that is what the isolation test is for.)`,
        });
      }
    }

    for (const b of superficie.buckets) {
      const n = await sb.listarBucket(b);
      if (n && n > 0) hallazgos.push(hallazgo('S-BUCKET-LISTABLE', 'media', `storage/${b}`, { tabla: b, objetos: n }));
    }
  }

  if (sinPresupuesto) {
    avisos.push({
      es: 'Se alcanzó el máximo de peticiones de esta ejecución antes de terminar: parte de las comprobaciones no se hizo. El resultado NO es completo.',
      en: 'The request budget for this run was exhausted before finishing: some checks were not performed. The result is NOT complete.',
    });
  }
  if (superficie.rpc.length || superficie.funciones.length) {
    notas.push({
      es: 'Las funciones RPC y Edge Functions detectadas no se invocan automáticamente (podrían tener efectos). Deben revisarse a mano.',
      en: 'Detected RPC and Edge Functions are not invoked automatically (they may have side effects). They need manual review.',
    });
  }

  return {
    herramienta: 'cerrojo',
    tipo: 'web',
    objetivo: base.href,
    // La clave pública va en el código de la web; se guarda para encadenar con `aislamiento`.
    supabase: supabaseUrl ? { url: supabaseUrl, claveTipo: candidata?.tipo ?? null, clavePublica: candidata?.clave ?? null } : null,
    inicio,
    fin: ahoraIso(),
    peticiones: cliente.hechas,
    hallazgos,
    superadas,
    notas,
    avisos,
    superficie,
    tablasEstado,
  };
}

/** Ordena las claves públicas encontradas: primero las que declaran pertenecer a este proyecto. */
function ordenarClaves(claves, supabaseUrl) {
  const ref = supabaseUrl?.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/)?.[1];
  const peso = (c) => (ref && c.ref === ref ? 0 : c.tipo === 'publishable' ? 1 : 2);
  return [...claves].sort((a, b) => peso(a) - peso(b));
}
