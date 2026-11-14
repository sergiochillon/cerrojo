// Extrae de un texto (HTML o JavaScript empaquetado) lo que revela sobre el backend:
// proyecto de Supabase, claves, secretos, tablas, funciones y buckets que usa la app.

import { decodificarJwt, enmascarar, esIdentificador } from './util.js';

const RE_JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const RE_URL_SUPABASE = /https:\/\/[a-z0-9]{20}\.supabase\.co/g;
const RE_CREAR_CLIENTE = /createClient\(\s*["'`](https?:\/\/[^"'`\s]+)["'`]\s*,\s*["'`]([^"'`\s]+)["'`]/g;

// Secretos de terceros con formato reconocible. `publica: true` = diseñada para ir en el navegador.
const PATRONES_SECRETO = [
  { tipo: 'Clave secreta de Supabase (sb_secret_)', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g, servicio: true },
  { tipo: 'Clave secreta de Stripe', re: /\b[sr]k_live_[A-Za-z0-9]{20,}/g },
  { tipo: 'Clave de API de Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { tipo: 'Clave de API de OpenAI', re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g },
  { tipo: 'Clave de acceso de AWS', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { tipo: 'Token de GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { tipo: 'Clave de API de Resend', re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g },
  { tipo: 'Clave de API de SendGrid', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { tipo: 'Token de Slack', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}/g },
  { tipo: 'Clave privada (PEM)', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

// Objetos cuyo método .from() no tiene nada que ver con Supabase.
const NO_SON_TABLAS = new Set(['Array', 'Buffer', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Float32Array', 'Float64Array', 'Set', 'Map', 'Object', 'String', 'Observable', 'Iterator', 'Readable']);

/**
 * @param {string} texto
 * @param {string} archivo  Nombre para citar en el informe.
 */
export function extraer(texto, archivo) {
  const r = {
    urlsSupabase: new Set(),
    clavesPublicas: [], // {clave, tipo: 'anon-jwt'|'publishable'}
    secretos: [], // {tipo, muestra, archivo, servicio}
    tablas: new Set(),
    buckets: new Set(),
    rpc: new Set(),
    funciones: new Set(),
    mapaFuente: null,
  };

  for (const m of texto.matchAll(RE_URL_SUPABASE)) r.urlsSupabase.add(m[0]);
  for (const m of texto.matchAll(RE_CREAR_CLIENTE)) {
    r.urlsSupabase.add(m[1].replace(/\/+$/, ''));
    if (m[2].startsWith('sb_publishable_')) r.clavesPublicas.push({ clave: m[2], tipo: 'publishable' });
  }

  const vistos = new Set();
  for (const m of texto.matchAll(RE_JWT)) {
    if (vistos.has(m[0])) continue;
    vistos.add(m[0]);
    const jwt = decodificarJwt(m[0]);
    const rol = jwt?.carga?.role;
    if (!jwt || !rol) continue;
    if (rol === 'service_role' || rol === 'supabase_admin') {
      r.secretos.push({ tipo: `JWT con rol ${rol}`, muestra: enmascarar(m[0]), archivo, servicio: true });
    } else if (rol === 'anon') {
      r.clavesPublicas.push({ clave: m[0], tipo: 'anon-jwt', ref: jwt.carga.ref });
    }
  }
  for (const m of texto.matchAll(/\bsb_publishable_[A-Za-z0-9_-]{16,}/g)) {
    if (!r.clavesPublicas.some((c) => c.clave === m[0])) r.clavesPublicas.push({ clave: m[0], tipo: 'publishable' });
  }

  for (const p of PATRONES_SECRETO) {
    const yaVistos = new Set();
    for (const m of texto.matchAll(p.re)) {
      if (yaVistos.has(m[0])) continue;
      yaVistos.add(m[0]);
      r.secretos.push({ tipo: p.tipo, muestra: enmascarar(m[0]), archivo, servicio: !!p.servicio });
    }
  }

  // supabase.from("tabla") / supabase.storage.from("bucket")
  // Los buckets admiten guiones y puntos; las tablas deben ser identificadores SQL.
  for (const m of texto.matchAll(/([A-Za-z0-9_$]*)\.from\(\s*(["'`])([A-Za-z0-9_][A-Za-z0-9_.-]{0,99})\2\s*\)/g)) {
    const [, objeto, , nombre] = m;
    if (NO_SON_TABLAS.has(objeto)) continue;
    if (/storage$/i.test(objeto)) r.buckets.add(nombre);
    else if (esIdentificador(nombre)) r.tablas.add(nombre);
  }
  for (const m of texto.matchAll(/\.rpc\(\s*(["'`])([A-Za-z_][A-Za-z0-9_]{0,62})\1/g)) r.rpc.add(m[2]);
  for (const m of texto.matchAll(/functions\.invoke\(\s*(["'`])([A-Za-z0-9_-]{1,80})\1/g)) r.funciones.add(m[2]);
  for (const m of texto.matchAll(/\/functions\/v1\/([A-Za-z0-9_-]{1,80})/g)) r.funciones.add(m[1]);
  for (const m of texto.matchAll(/\/rest\/v1\/([A-Za-z_][A-Za-z0-9_]{0,62})(?=[?"'`])/g)) if (m[1] !== 'rpc') r.tablas.add(m[1]);

  const mapa = texto.match(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/m);
  if (mapa && !mapa[1].startsWith('data:')) r.mapaFuente = mapa[1];

  for (const t of [...r.tablas]) if (!esIdentificador(t)) r.tablas.delete(t);
  return r;
}

/** Fusiona varios resultados de `extraer`. */
export function fusionar(resultados) {
  const total = { urlsSupabase: new Set(), clavesPublicas: [], secretos: [], tablas: new Set(), buckets: new Set(), rpc: new Set(), funciones: new Set(), mapasFuente: [] };
  for (const r of resultados) {
    for (const k of ['urlsSupabase', 'tablas', 'buckets', 'rpc', 'funciones']) for (const v of r[k]) total[k].add(v);
    for (const c of r.clavesPublicas) if (!total.clavesPublicas.some((x) => x.clave === c.clave)) total.clavesPublicas.push(c);
    for (const s of r.secretos) if (!total.secretos.some((x) => x.muestra === s.muestra && x.tipo === s.tipo)) total.secretos.push(s);
    if (r.mapaFuente) total.mapasFuente.push(r.mapaFuente);
  }
  return total;
}
