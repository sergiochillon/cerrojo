// Revisión estática de un repositorio: migraciones SQL de Supabase y código de la app.
// Todo se hace en local; no se envía nada a ningún sitio.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, sep } from 'node:path';
import { hallazgo } from './catalogo.js';
import { extraer } from './extraer.js';
import { modeloVacio, aplicarMigracion, esSiempreCierta, soloExigeSesion, usaMetadatosDeUsuario } from './sql.js';
import { ahoraIso, categoriasSensibles, RE_COLUMNA_PRIVILEGIO } from './util.js';

const IGNORAR = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output', '.vercel', '.netlify', 'coverage', '.turbo', '.cache', 'vendor', '.svelte-kit']);
const EXT_CODIGO = /\.(m?[jt]sx?|cjs|vue|svelte|astro|html)$/i;
// Señales de que una Edge Function identifica a quien la llama o valida una firma.
const RE_COMPRUEBA_IDENTIDAD = /getUser\s*\(|getClaims\s*\(|jwtVerify|verifyJWT|constructEvent(Async)?\s*\(|timingSafeEqual|CRON_SECRET|WEBHOOK_SECRET|x-webhook-secret/i;
const BUCKET_SENSIBLE = /(doc|invoice|factura|contract|contrato|private|privad|kyc|receipt|recibo|medical|report|informe|upload|attachment|adjunto|id_?card|dni)/i;

function* recorrer(dir, raiz = dir) {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entradas) {
    const ruta = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (!IGNORAR.has(e.name)) yield* recorrer(ruta, raiz);
    } else if (e.isFile()) {
      yield { ruta, rel: relative(raiz, ruta).split(sep).join('/') };
    }
  }
}

function leer(ruta, max = 1_500_000) {
  try {
    if (statSync(ruta).size > max) return null;
    return readFileSync(ruta, 'utf8');
  } catch {
    return null;
  }
}

const lineaDe = (texto, indice) => texto.slice(0, indice).split('\n').length;

/**
 * @param {string} dir Carpeta raíz del repositorio a revisar.
 */
export function auditarRepo(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`No existe la carpeta: ${dir}`);
  const inicio = ahoraIso();
  const hallazgos = [];
  const superadas = [];
  const notas = [];
  const archivos = [...recorrer(dir)];

  // ───────────── 1. Migraciones SQL ─────────────
  const sqls = archivos.filter((a) => /\.sql$/i.test(a.rel)).sort((a, b) => a.rel.localeCompare(b.rel));
  const modelo = modeloVacio();
  for (const a of sqls) {
    const texto = leer(a.ruta, 5_000_000);
    if (texto != null) aplicarMigracion(modelo, texto, a.rel);
  }

  const inventario = [];
  for (const t of modelo.tablas.values()) {
    const [esquema, nombre] = t.nombre.split('.');
    const esPublica = esquema === 'public' && t.declarada;
    // Solo se evalúan las tablas de la app (public) y las políticas de archivos (storage.objects).
    if (!esPublica && t.nombre !== 'storage.objects') continue;
    if (esPublica) {
      const cats = categoriasSensibles([nombre, ...t.columnas]);
      inventario.push({ tabla: nombre, rls: t.rls, politicas: t.politicas.length });
      if (!t.rls) {
        hallazgos.push(
          t.rlsDesactivado
            ? hallazgo('R-RLS-DESACTIVADO', 'critica', t.nombre, { tabla: nombre, archivo: t.rlsDesactivado })
            : hallazgo('R-SIN-RLS', cats.length ? 'critica' : 'alta', t.nombre, { tabla: nombre, archivo: t.archivo, columnas: t.columnas }),
        );
        continue;
      }
      if (!t.politicas.length) hallazgos.push(hallazgo('R-RLS-SIN-POLITICAS', 'info', t.nombre, { tabla: nombre, archivo: t.archivo }));
    }

    const sensibles = categoriasSensibles([nombre, ...t.columnas]);
    for (const p of t.politicas) {
      if (p.restrictiva) continue;
      const base = { tabla: nombre, politica: p.nombre, comando: p.comando, roles: p.roles, archivo: p.archivo };
      const abiertoATodos = p.roles.some((r) => r === 'public' || r === 'anon');
      // Condición que gobierna cada operación: INSERT usa WITH CHECK; el resto, USING.
      const condicion = p.comando === 'insert' ? p.check : p.using ?? p.check;
      const escribe = p.comando !== 'select';

      if (usaMetadatosDeUsuario(p.using) || usaMetadatosDeUsuario(p.check)) {
        hallazgos.push(hallazgo('R-POLITICA-METADATOS-USUARIO', 'alta', t.nombre, { ...base, expresion: [p.using, p.check].filter(Boolean).join(' / ') }));
      }
      // En PostgreSQL una política sin condición equivale a "true".
      const siempre = condicion == null || esSiempreCierta(condicion);
      const expresion = condicion ?? '(sin condición = true)';
      if (siempre && abiertoATodos) {
        if (escribe) {
          hallazgos.push(hallazgo('R-POLITICA-ESCRITURA-ABIERTA', p.comando === 'insert' ? 'media' : 'critica', t.nombre, { ...base, expresion }));
        } else {
          hallazgos.push(hallazgo('R-POLITICA-LECTURA-ABIERTA', sensibles.length ? 'alta' : 'media', t.nombre, { ...base, expresion }));
        }
      } else if (siempre || soloExigeSesion(condicion)) {
        // true limitado a "authenticated", o condición del tipo auth.uid() is not null.
        const grave = escribe && p.comando !== 'insert' ? 'alta' : sensibles.length ? 'alta' : 'media';
        hallazgos.push(hallazgo('R-POLITICA-SOLO-AUTENTICADO', grave, t.nombre, { ...base, expresion }));
      }
    }

    if (esquema === 'public') {
      const privilegio = t.columnas.filter((c) => RE_COLUMNA_PRIVILEGIO.test(c));
      const modifica = t.politicas.find((p) => !p.restrictiva && (p.comando === 'update' || p.comando === 'all'));
      const checkMencionaColumna = modifica && privilegio.some((c) => new RegExp(`\\b${c}\\b`, 'i').test(modifica.check ?? ''));
      if (privilegio.length && modifica && !t.restriccionColumnas && !t.disparadorUpdate && !checkMencionaColumna) {
        hallazgos.push(hallazgo('R-COLUMNA-PRIVILEGIO-EDITABLE', 'alta', t.nombre, { tabla: nombre, columnas: privilegio, politica: modifica.nombre }));
      }
    }
  }

  for (const v of modelo.vistas.values()) {
    if (v.nombre.startsWith('public.') && !v.invoker) hallazgos.push(hallazgo('R-VISTA-SIN-INVOKER', 'media', v.nombre, { tabla: v.nombre.slice(7), archivo: v.archivo }));
  }
  for (const f of modelo.funciones) {
    if (f.definer && !f.searchPath) hallazgos.push(hallazgo('R-FUNCION-DEFINER', f.nombre.startsWith('public.') ? 'media' : 'baja', f.nombre, { funcion: f.nombre, archivo: f.archivo }));
  }
  for (const b of modelo.buckets) {
    if (b.publico) hallazgos.push(hallazgo('R-BUCKET-PUBLICO', BUCKET_SENSIBLE.test(b.id) ? 'media' : 'info', `storage/${b.id}`, { tabla: b.id, archivo: b.archivo }));
  }

  if (!sqls.length) {
    notas.push({
      es: 'No hay archivos .sql en el repositorio: no se pudo revisar RLS de forma estática. Si las tablas se crearon desde el panel, exporta el esquema (supabase db dump --schema public) y repite.',
      en: 'No .sql files in the repository: RLS could not be reviewed statically. If tables were created from the dashboard, export the schema (supabase db dump --schema public) and re-run.',
    });
  } else {
    const bien = inventario.filter((t) => t.rls && t.politicas > 0).length;
    superadas.push({ es: `${sqls.length} archivo(s) SQL leídos; ${inventario.length} tabla(s) en public, ${bien} con RLS y políticas.`, en: `${sqls.length} SQL file(s) read; ${inventario.length} table(s) in public, ${bien} with RLS and policies.` });
    notas.push({
      es: 'El análisis de migraciones refleja lo que dice el repositorio, no el estado real de la base de datos: cambios hechos desde el panel no aparecen aquí.',
      en: 'Migration analysis reflects what the repository says, not the live database state: changes made from the dashboard do not show up here.',
    });
  }

  // ───────────── 2. Código y configuración ─────────────
  const gitignore = leer(join(dir, '.gitignore')) ?? '';
  const envIgnorado = /^\s*\.env(\*|\..*)?\s*$/m.test(gitignore);
  const variablesVistas = new Set();
  let secretosEnCodigo = 0;

  for (const a of archivos) {
    const nombre = basename(a.rel);
    const esEnv = /^\.env(\..+)?$/.test(nombre) && !/\.(example|sample|template|dist)$/i.test(nombre);
    const esCodigo = EXT_CODIGO.test(a.rel);
    const esToml = a.rel.endsWith('supabase/config.toml');
    if (!esEnv && !esCodigo && !esToml) continue;
    const texto = leer(a.ruta);
    if (texto == null) continue;

    if (esEnv) {
      const lineas = texto.split('\n').filter((l) => /^\s*[A-Z][A-Z0-9_]*\s*=\s*\S/.test(l));
      const privadas = lineas.filter((l) => !/^\s*(VITE|NEXT_PUBLIC|REACT_APP|PUBLIC|EXPO_PUBLIC|NUXT_PUBLIC)_/.test(l));
      if (lineas.length && !envIgnorado) {
        hallazgos.push(hallazgo('C-ENV-EN-GIT', privadas.length ? 'alta' : 'baja', a.rel, { archivo: a.rel, variables: lineas.length, ignorado: false }));
      }
    }

    if (esToml) {
      for (const m of texto.matchAll(/^\[functions\.([A-Za-z0-9_-]+)\]([^[]*)/gm)) {
        if (!/^\s*verify_jwt\s*=\s*false/m.test(m[2])) continue;
        // Si la función valida por su cuenta (firma de webhook, getUser…), es solo informativo.
        const codigo = leer(join(dir, 'supabase', 'functions', m[1], 'index.ts')) ?? '';
        hallazgos.push(hallazgo('C-FUNCION-SIN-JWT', RE_COMPRUEBA_IDENTIDAD.test(codigo) ? 'info' : 'media', a.rel, { funcion: m[1], archivo: a.rel }));
      }
      continue;
    }

    // Secretos con formato reconocible (los mismos patrones que en la app desplegada).
    for (const s of extraer(texto, a.rel).secretos) {
      secretosEnCodigo++;
      const indice = Math.max(0, texto.indexOf(s.muestra.slice(0, 6)));
      hallazgos.push(hallazgo('C-SECRETO-EN-REPO', 'critica', a.rel, { tipo: s.tipo, archivo: a.rel, linea: lineaDe(texto, indice), muestra: s.muestra }));
    }

    for (const m of texto.matchAll(/\b((?:VITE|NEXT_PUBLIC|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC|PUBLIC)_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE_KEY|PASSWORD|OPENAI|ANTHROPIC|API_SECRET)[A-Z0-9_]*)\b/g)) {
      if (variablesVistas.has(m[1])) continue;
      variablesVistas.add(m[1]);
      hallazgos.push(hallazgo('C-ENV-PUBLICA-SECRETA', 'critica', a.rel, { variable: m[1], archivo: a.rel, linea: lineaDe(texto, m.index) }));
    }

    if (!esCodigo) continue;
    const enFuncion = /(^|\/)supabase\/functions\//.test(a.rel);
    if (enFuncion) {
      const comprueba = RE_COMPRUEBA_IDENTIDAD.test(texto);
      if (/SERVICE_ROLE/.test(texto) && !comprueba) hallazgos.push(hallazgo('C-FUNCION-SERVICIO-SIN-AUTH', 'alta', a.rel, { archivo: a.rel }));
      if (/Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/.test(texto)) hallazgos.push(hallazgo('C-CORS-ABIERTO', 'baja', a.rel, { archivo: a.rel }));
    } else {
      const admin = texto.match(/localStorage\.getItem\(\s*["'](?:is_?admin|isAdmin|role|userRole|user_role|admin)["']\s*\)|user_metadata\??\.(?:role|is_?admin|isAdmin|admin)\b/);
      if (admin) hallazgos.push(hallazgo('C-ADMIN-EN-CLIENTE', 'media', a.rel, { archivo: a.rel, linea: lineaDe(texto, admin.index), fragmento: admin[0].slice(0, 80) }));
      // Los componentes de shadcn/ui (p. ej. chart.tsx) insertan CSS propio: se excluyen.
      const html = texto.match(/dangerouslySetInnerHTML|\bv-html=|\{@html\s/);
      if (html && !/DOMPurify|sanitize/i.test(texto) && !/components\/ui\//.test(a.rel)) {
        hallazgos.push(hallazgo('C-HTML-SIN-SANEAR', 'baja', a.rel, { archivo: a.rel, linea: lineaDe(texto, html.index) }));
      }
    }
  }
  if (!secretosEnCodigo && !variablesVistas.size) superadas.push({ es: 'No se han encontrado secretos con formato reconocible en el código.', en: 'No secrets with a recognisable format were found in the code.' });
  notas.push({
    es: 'La revisión de código usa patrones: detecta fallos típicos, no sustituye a leer las Edge Functions y la lógica de negocio.',
    en: 'Code review is pattern-based: it catches typical flaws and does not replace reading the Edge Functions and business logic.',
  });

  return {
    herramienta: 'cerrojo',
    tipo: 'repo',
    objetivo: basename(dir) || dir,
    inicio,
    fin: ahoraIso(),
    hallazgos,
    superadas,
    notas,
    inventario: inventario.sort((a, b) => a.tabla.localeCompare(b.tabla)),
  };
}
