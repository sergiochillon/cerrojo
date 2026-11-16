// Extrae de un texto (HTML o JavaScript empaquetado) lo que revela sobre el backend:
// proyecto de Supabase, claves, secretos, tablas, funciones y buckets que usa la app.
//
// El texto lo controla un tercero y puede medir varios MB, así que todo aquí es de coste
// lineal: nada de expresiones regulares con cuantificadores abiertos sobre el texto completo.
// Se trocea en "fichas" (secuencias de caracteres propios de claves e identificadores) y las
// expresiones regulares solo se aplican a fichas cortas.

import { decodificarJwt, enmascarar, esIdentificador } from './util.js';

const RE_FICHA = /[A-Za-z0-9_.-]{16,}/g;
const MAX_FICHA = 8192; // una clave real es corta; una ficha enorme es un recurso incrustado
const RE_JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const RE_URL_SUPABASE = /https:\/\/[a-z0-9]{20}\.supabase\.co/g;
const RE_CREAR_CLIENTE = /createClient\(\s{0,20}["'`](https?:\/\/[^"'`\s]{1,300})["'`]\s{0,20},\s{0,20}["'`]([^"'`\s]{1,600})["'`]/g;

// Secretos de terceros con formato reconocible. Se buscan dentro de cada ficha.
const PATRONES_SECRETO = [
  { tipo: 'Clave secreta de Supabase (sb_secret_)', re: /sb_secret_[A-Za-z0-9_-]{16,}/g, servicio: true },
  { tipo: 'Clave secreta de Stripe', re: /\b[sr]k_live_[A-Za-z0-9]{20,}/g },
  { tipo: 'Clave de API de Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  // OpenAI: claves de proyecto/servicio, o el formato antiguo con su marcador interno.
  // Un simple "sk-…" con guiones (clases CSS, identificadores) no cuenta.
  { tipo: 'Clave de API de OpenAI', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/g },
  { tipo: 'Clave de acceso de AWS', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { tipo: 'Token de GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { tipo: 'Clave de API de Resend', re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g },
  { tipo: 'Clave de API de SendGrid', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { tipo: 'Token de Slack', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}/g },
];

// Objetos cuyo método .from() no tiene nada que ver con Supabase.
const NO_SON_TABLAS = new Set(['Array', 'Buffer', 'Uint8Array', 'Uint16Array', 'Uint32Array', 'Int8Array', 'Float32Array', 'Float64Array', 'Set', 'Map', 'Object', 'String', 'Observable', 'Iterator', 'Readable']);

/** Recorre todas las apariciones de una cadena literal (coste lineal). */
function* apariciones(texto, literal) {
  for (let i = texto.indexOf(literal); i !== -1; i = texto.indexOf(literal, i + literal.length)) yield i;
}

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
  for (const i of apariciones(texto, 'createClient(')) {
    RE_CREAR_CLIENTE.lastIndex = 0;
    const m = RE_CREAR_CLIENTE.exec(texto.slice(i, i + 1100));
    if (m?.index === 0) r.urlsSupabase.add(m[1].replace(/\/+$/, ''));
  }

  // Claves y secretos: solo dentro de fichas de tamaño razonable.
  const secretosVistos = new Set();
  const jwtVistos = new Set();
  for (const f of texto.matchAll(RE_FICHA)) {
    const ficha = f[0];
    if (ficha.length > MAX_FICHA) continue;
    for (const m of ficha.matchAll(RE_JWT)) {
      if (jwtVistos.has(m[0])) continue;
      jwtVistos.add(m[0]);
      const rol = decodificarJwt(m[0])?.carga?.role;
      if (!rol) continue;
      if (rol === 'anon') r.clavesPublicas.push({ clave: m[0], tipo: 'anon-jwt', ref: decodificarJwt(m[0]).carga.ref });
      else if (rol === 'service_role' || rol === 'supabase_admin') r.secretos.push({ tipo: `JWT con rol ${rol}`, muestra: enmascarar(m[0]), archivo, servicio: true });
    }
    for (const m of ficha.matchAll(/sb_publishable_[A-Za-z0-9_-]{16,}/g)) {
      if (!r.clavesPublicas.some((c) => c.clave === m[0])) r.clavesPublicas.push({ clave: m[0], tipo: 'publishable' });
    }
    for (const p of PATRONES_SECRETO) {
      for (const m of ficha.matchAll(p.re)) {
        const clave = `${p.tipo}|${m[0]}`;
        if (secretosVistos.has(clave)) continue;
        secretosVistos.add(clave);
        r.secretos.push({ tipo: p.tipo, muestra: enmascarar(m[0]), archivo, servicio: !!p.servicio });
      }
    }
  }
  if (texto.includes('PRIVATE KEY-----')) {
    for (const i of apariciones(texto, 'PRIVATE KEY-----')) {
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?$/.test(texto.slice(Math.max(0, i - 20), i))) {
        r.secretos.push({ tipo: 'Clave privada (PEM)', muestra: '-----BEGIN … PRIVATE KEY-----', archivo, servicio: false });
        break;
      }
    }
  }

  // supabase.from("tabla") / supabase.storage.from("bucket") / supabase?.from('public.tabla')
  for (const i of apariciones(texto, '.from(')) {
    const objeto = /([A-Za-z0-9_$]{0,40})\??$/.exec(texto.slice(Math.max(0, i - 42), i))?.[1] ?? '';
    const m = /^\.from\(\s{0,10}(["'`])([A-Za-z0-9_][A-Za-z0-9_.-]{0,99})\1\s{0,10}\)/.exec(texto.slice(i, i + 140));
    if (!m || NO_SON_TABLAS.has(objeto)) continue;
    if (/storage$/i.test(objeto)) {
      r.buckets.add(m[2]);
    } else {
      const nombre = m[2].startsWith('public.') ? m[2].slice(7) : m[2];
      if (esIdentificador(nombre)) r.tablas.add(nombre);
    }
  }
  for (const i of apariciones(texto, '.rpc(')) {
    const m = /^\.rpc\(\s{0,10}(["'`])([A-Za-z_][A-Za-z0-9_]{0,62})\1/.exec(texto.slice(i, i + 90));
    if (m) r.rpc.add(m[2]);
  }
  for (const i of apariciones(texto, 'functions.invoke(')) {
    const m = /^functions\.invoke\(\s{0,10}(["'`])([A-Za-z0-9_-]{1,80})\1/.exec(texto.slice(i, i + 120));
    if (m) r.funciones.add(m[2]);
  }
  for (const i of apariciones(texto, '/functions/v1/')) {
    const m = /^\/functions\/v1\/([A-Za-z0-9_-]{1,80})/.exec(texto.slice(i, i + 100));
    if (m) r.funciones.add(m[1]);
  }
  for (const i of apariciones(texto, '/rest/v1/')) {
    const m = /^\/rest\/v1\/([A-Za-z_][A-Za-z0-9_]{0,62})[?"'`]/.exec(texto.slice(i, i + 80));
    if (m && m[1] !== 'rpc') r.tablas.add(m[1]);
  }

  // Por convención va al final del archivo: solo se mira la cola.
  const mapa = texto.slice(-2000).match(/\/\/[#@]\s?sourceMappingURL=([^\s'"]{1,500})\s*$/);
  if (mapa && !mapa[1].startsWith('data:')) r.mapaFuente = mapa[1];

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
