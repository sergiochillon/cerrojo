// Auditoría externa de una app desplegada: qué revela su código público y qué deja leer
// su backend de Supabase a un visitante sin sesión.

import { Cliente } from './http.js';
import { extraer, fusionar } from './extraer.js';
import { Supabase } from './supabase.js';
import { hallazgo } from './catalogo.js';
import { ahoraIso, categoriasSensibles, gravedadPorCategorias, esIdentificador } from './util.js';

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
  const inicio = ahoraIso();
  const hallazgos = [];
  const superadas = [];
  const notas = [];

  const base = new URL(urlApp);
  avisar(`Descargando ${base.href}`);
  const pagina = await cliente.pedir(base.href);
  if (!pagina.ok) throw new Error(`No se pudo abrir ${base.href}: ${pagina.error ?? `HTTP ${pagina.estado}`}`);
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
    if (!r.ok || /^\s*<!doctype html/i.test(r.texto)) continue;
    const nombre = new URL(url).pathname;
    const e = extraer(r.texto, nombre);
    extraidos.push(e);
    if (e.mapaFuente) mapas.push(new URL(e.mapaFuente, url).href);
    // Trozos cargados dinámicamente (import("./assets/x.js")).
    for (const m of r.texto.matchAll(/["'`]((?:\.{0,2}\/)?(?:assets\/)?[A-Za-z0-9._-]+\.js)["'`]/g)) anotar(m[1], url);
  }
  if (pendientes.length > maxArchivos) notas.push({ es: `Se analizaron ${maxArchivos} de ${pendientes.length} archivos JavaScript.`, en: `Analysed ${maxArchivos} of ${pendientes.length} JavaScript files.` });
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
    notas.push({
      es: 'No se detectó un proyecto de Supabase (URL y clave pública) en el código. Si la app usa un dominio propio o un proxy, indícalo con --supabase-url y --clave.',
      en: 'No Supabase project (URL and public key) detected in the code. If the app uses a custom domain or proxy, pass --supabase-url and --clave.',
    });
  } else {
    avisar(`Proyecto Supabase: ${supabaseUrl}`);
    const sb = new Supabase(cliente, supabaseUrl, candidata.clave);
    if (candidata.tipo === 'anon-jwt') hallazgos.push(hallazgo('S-CLAVE-HEREDADA', 'info', supabaseUrl));

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
    if (claveInvalida) {
      notas.push({ es: 'El backend rechazó la clave pública detectada; no se pudieron comprobar las tablas.', en: 'The backend rejected the detected public key; tables could not be checked.' });
    } else if (superficie.tablas.length) {
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
    superficie,
    tablasEstado,
  };
}

function elegirClave(claves, supabaseUrl) {
  if (!claves.length) return null;
  const ref = supabaseUrl?.match(/https:\/\/([a-z0-9]{20})\.supabase\.co/)?.[1];
  return claves.find((c) => c.tipo === 'publishable') ?? claves.find((c) => ref && c.ref === ref) ?? claves[0];
}
