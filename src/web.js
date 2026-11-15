// Auditoría externa de una app desplegada: qué revela su código público y qué deja leer
// su backend de Supabase a un visitante sin sesión.

import { Cliente } from './http.js';
import { extraer, fusionar } from './extraer.js';
import { Supabase } from './supabase.js';
import { hallazgo } from './catalogo.js';
import { ahoraIso, categoriasSensibles, gravedadPorCategorias, esIdentificador, esClaveSecreta, AVISO_CLAVE_SECRETA } from './util.js';

const CABECERAS_ESPERADAS = [
  ['content-security-policy', 'Content-Security-Policy'],
  ['strict-transport-security', 'Strict-Transport-Security'],
  ['x-content-type-options', 'X-Content-Type-Options'],
  ['referrer-policy', 'Referrer-Policy'],
];

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
  let bloqueadas = 0;
  let recortadas = 0;
  const origen = new URL(pagina.url).origin;

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
  for (const m of pagina.texto.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) anotar(m[1], pagina.url);
  for (const m of pagina.texto.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/gi)) anotar(m[1], pagina.url);

  const extraidos = [extraer(pagina.texto, '(HTML)')];
  const maxArchivos = op.maxArchivos ?? 40;
  const mapas = [];
  for (let i = 0; i < pendientes.length && i < maxArchivos; i++) {
    const url = pendientes[i];
    const r = await cliente.pedir(url, { maxBytes: 8_000_000 });
    if (r.error?.startsWith('destino_bloqueado')) bloqueadas++;
    if (r.truncada) recortadas++;
    if (!r.ok || /^\s*<!doctype html/i.test(r.texto)) continue;
    const nombre = new URL(url).pathname;
    const e = extraer(r.texto, nombre);
    extraidos.push(e);
    if (e.mapaFuente) mapas.push(new URL(e.mapaFuente, url).href);
    // Trozos cargados dinámicamente (import("./assets/x.js")).
    for (const m of r.texto.matchAll(/["'`]((?:\.{0,2}\/)?(?:assets\/)?[A-Za-z0-9._-]+\.js)["'`]/g)) anotar(m[1], url);
  }
  if (pendientes.length > maxArchivos) notas.push({ es: `Se analizaron ${maxArchivos} de ${pendientes.length} archivos JavaScript.`, en: `Analysed ${maxArchivos} of ${pendientes.length} JavaScript files.` });
  if (bloqueadas) notas.push({ es: `${bloqueadas} archivo(s) no se descargaron porque redirigían a una dirección local, privada o interna.`, en: `${bloqueadas} file(s) were not downloaded because they redirected to a local, private or internal address.` });
  if (recortadas) notas.push({ es: `${recortadas} archivo(s) superaban 8 MB y solo se analizó su comienzo.`, en: `${recortadas} file(s) exceeded 8 MB and only their beginning was analysed.` });
  const visto = fusionar(extraidos);
  avisar(`Analizados ${extraidos.length - 1} archivos JavaScript`);

  for (const s of visto.secretos) {
    hallazgos.push(hallazgo(s.servicio ? 'W-CLAVE-SERVICIO' : 'W-SECRETO-TERCERO', 'critica', s.archivo, { tipo: s.tipo, archivo: s.archivo, muestra: s.muestra }));
  }
  if (!visto.secretos.length) superadas.push({ es: 'No se han encontrado claves secretas en el código público analizado.', en: 'No secret keys found in the analysed public code.' });

  // 2. Archivos que no deberían servirse. Una SPA responde 200 con su index.html a cualquier
  //    ruta, así que se exige que el contenido tenga el formato esperado.
  for (const ruta of ['/.env', '/.env.local', '/.env.production']) {
    const r = await cliente.pedir(origen + ruta, { maxBytes: 20000 });
    const lineas = r.ok && !/<html|<!doctype/i.test(r.texto) ? r.texto.split('\n').filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l.trim())).length : 0;
    if (lineas > 0) hallazgos.push(hallazgo('W-ENV-EXPUESTO', 'critica', ruta, { ruta, variables: lineas }));
  }
  {
    const r = await cliente.pedir(`${origen}/.git/config`, { maxBytes: 5000 });
    if (r.ok && /^\s*\[core\]/m.test(r.texto)) hallazgos.push(hallazgo('W-GIT-EXPUESTO', 'alta', '/.git/config', { ruta: '/.git/config' }));
  }
  if (!hallazgos.some((h) => h.id === 'W-ENV-EXPUESTO' || h.id === 'W-GIT-EXPUESTO')) {
    superadas.push({ es: 'Los archivos .env y la carpeta .git no se sirven públicamente.', en: '.env files and the .git folder are not publicly served.' });
  }

  let mapasAccesibles = 0;
  let ejemploMapa = '';
  for (const m of mapas.slice(0, 3)) {
    const r = await cliente.pedir(m, { maxBytes: 300 });
    if (r.ok && /"version"\s*:/.test(r.texto)) {
      mapasAccesibles++;
      ejemploMapa ||= new URL(m).pathname;
    }
  }
  if (mapasAccesibles) hallazgos.push(hallazgo('W-MAPAS-FUENTE', 'baja', ejemploMapa, { total: mapasAccesibles, ejemplo: ejemploMapa }));

  // HSTS solo tiene sentido sobre HTTPS (en local, por HTTP, no se exige).
  const faltan = CABECERAS_ESPERADAS.filter(([k]) => !pagina.cabeceras?.get(k) && !(k === 'strict-transport-security' && base.protocol === 'http:')).map(([, n]) => n);
  const csp = pagina.cabeceras?.get('content-security-policy') ?? '';
  if (!pagina.cabeceras?.get('x-frame-options') && !/frame-ancestors/i.test(csp)) faltan.push('X-Frame-Options / frame-ancestors');
  if (faltan.length) hallazgos.push(hallazgo('W-CABECERAS', 'baja', origen, { faltan }));

  // 3. Backend de Supabase visto por un visitante sin sesión.
  const supabaseUrl = op.supabaseUrl ?? [...visto.urlsSupabase][0];
  const candidata = op.clave ? { clave: op.clave, tipo: op.clave.startsWith('eyJ') ? 'anon-jwt' : 'publishable' } : elegirClave(visto.clavesPublicas, supabaseUrl);
  const tablas = new Set([...visto.tablas, ...(op.tablas ?? [])].filter(esIdentificador));
  const superficie = { tablas: [], rpc: [...visto.rpc].sort(), funciones: [...visto.funciones].sort(), buckets: [...visto.buckets].sort() };
  const tablasEstado = {};

  if (!supabaseUrl || !candidata) {
    avisos.push({
      es: 'No se detectó un proyecto de Supabase (URL y clave pública) en el código de la app, así que NO se ha comprobado ninguna tabla. Si la app usa un dominio propio o un proxy, indícalo con --supabase-url y --clave.',
      en: 'No Supabase project (URL and public key) was detected in the app code, so NO table was checked. If the app uses a custom domain or proxy, pass --supabase-url and --clave.',
    });
  } else {
    avisar(`Proyecto Supabase: ${supabaseUrl}`);
    // La URL del backend sale del código de la página, que es un dato no fiable: se valida
    // igual que cualquier otro destino antes de enviarle nada.
    try {
      await cliente.validarDestino(new URL(supabaseUrl));
    } catch (e) {
      throw new Error(`El backend que declara la app (${supabaseUrl}) no es un destino admisible: ${e.message}`);
    }
    const sb = new Supabase(cliente, supabaseUrl, candidata.clave);
    if (candidata.tipo === 'anon-jwt') hallazgos.push(hallazgo('S-CLAVE-HEREDADA', 'info', supabaseUrl));

    // Con una clave caducada o mal copiada, todas las tablas responden "no autorizado" y
    // parecerían protegidas. Se comprueba la clave contra un endpoint que no depende de tablas.
    const estadoClave = await sb.estadoClave();
    const claveDudosa = estadoClave !== 'aceptada';
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
    if (esquema) {
      hallazgos.push(hallazgo('S-ESQUEMA-PUBLICO', 'baja', `${supabaseUrl}/rest/v1/`, { tablas: esquema.tablas.length, funciones: esquema.funciones.length }));
      for (const t of esquema.tablas) tablas.add(t);
      for (const f of esquema.funciones) if (!superficie.rpc.includes(f)) superficie.rpc.push(f);
    } else {
      superadas.push({ es: 'El esquema de la base de datos no se puede consultar con la clave pública.', en: 'The database schema cannot be queried with the public key.' });
    }

    const ajustes = await sb.ajustesAuth();
    if (ajustes?.mailer_autoconfirm === true && ajustes?.disable_signup !== true) hallazgos.push(hallazgo('S-REGISTRO-SIN-VERIFICAR', 'media', `${supabaseUrl}/auth/v1/settings`));

    let claveInvalida = false;
    for (const t of [...tablas].sort()) {
      const r = await sb.leer(t);
      tablasEstado[t] = r.estado;
      if (r.estado === 'clave_invalida') {
        claveInvalida = true;
        break;
      }
      if (r.estado === 'no_existe') continue;
      superficie.tablas.push(t);
      if (r.estado === 'ok' && (r.filas.length > 0 || (r.total ?? 0) > 0)) {
        // Solo se conservan los nombres de columna; los valores se descartan aquí mismo.
        const columnas = Object.keys(r.filas[0] ?? {});
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
    if (claveInvalida && estadoClave !== 'rechazada') {
      avisos.push({ es: 'El backend rechazó la clave pública detectada; no se pudieron comprobar las tablas.', en: 'The backend rejected the detected public key; tables could not be checked.' });
    } else if (!tablas.size) {
      avisos.push({
        es: 'No se encontró ningún nombre de tabla en el código público de la app, así que no se ha comprobado ninguna. Indica las tablas con --tablas (el titular puede listarlas desde su panel).',
        en: 'No table name was found in the app public code, so none was checked. Pass the tables with --tablas (the owner can list them from the dashboard).',
      });
    } else if (superficie.tablas.length && !claveDudosa) {
      const cerradas = superficie.tablas.filter((t) => !hallazgos.some((h) => h.id === 'S-TABLA-LEGIBLE-ANON' && h.datos.tabla === t));
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

function elegirClave(claves, supabaseUrl) {
  if (!claves.length) return null;
  const ref = supabaseUrl?.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/)?.[1];
  return claves.find((c) => c.tipo === 'publishable') ?? claves.find((c) => ref && c.ref === ref) ?? claves[0];
}
