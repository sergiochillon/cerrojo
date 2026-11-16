// Cliente HTTP deliberadamente conservador.
//
// - Pocas peticiones, espaciadas y con un máximo total: una auditoría no debe parecerse a un
//   ataque ni degradar el servicio auditado.
// - El límite de tamaño se aplica MIENTRAS se descarga (y sobre los bytes ya descomprimidos):
//   una respuesta enorme o una "bomba" de compresión se corta, no se carga en memoria.
// - No se conecta a localhost ni a direcciones privadas o internas, tampoco tras una
//   redirección. La URL que se audita y todo lo que su código referencia son datos que controla
//   un tercero; sin esta defensa, una página podría hacer que la máquina del auditor pidiera
//   recursos de su propia red (SSRF). La dirección IP se resuelve una vez, se valida y la
//   conexión se fija a esa misma IP, de modo que el DNS no puede cambiarla entre medias.
// - Al redirigir a otro origen se retiran las cabeceras con credenciales.

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { lookup as resolverDns } from 'node:dns/promises';

const AGENTE = 'cerrojo/0.1 (auditoria de seguridad autorizada por el titular)';
const MAX_REDIRECCIONES = 5;
const CABECERAS_CON_CREDENCIALES = ['apikey', 'authorization', 'cookie'];

// ───────────── Clasificación de destinos ─────────────

function ipv4ANumero(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
const enRango = (n, base, bits) => n >>> (32 - bits) === ipv4ANumero(base) >>> (32 - bits);

const V4_NO_PUBLICAS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function clasificarV4(ip) {
  const n = ipv4ANumero(ip);
  if (enRango(n, '127.0.0.0', 8)) return 'loopback';
  return V4_NO_PUBLICAS.some(([base, bits]) => enRango(n, base, bits)) ? 'privada' : 'publica';
}

/** Expande una dirección IPv6 a sus 8 grupos de 16 bits. Devuelve null si no es válida. */
function expandirV6(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    if (!net.isIPv4(v4[1])) return null;
    const n = ipv4ANumero(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [izq, der, sobra] = s.split('::');
  if (sobra !== undefined) return null;
  const a = izq ? izq.split(':') : [];
  const b = der !== undefined ? (der ? der.split(':') : []) : null;
  if (b !== null && a.length + b.length > 7) return null;
  const grupos = b === null ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return grupos.map((g) => parseInt(g, 16));
}

function clasificarV6(ip) {
  const g = expandirV6(ip);
  if (!g) return 'privada';
  const ceros = (hasta) => g.slice(0, hasta).every((x) => x === 0);
  if (ceros(7) && g[7] === 1) return 'loopback'; // ::1
  if (ceros(8)) return 'privada'; // ::
  // Direcciones IPv4 incrustadas: ::ffff:a.b.c.d, ::a.b.c.d y NAT64 (64:ff9b::/96).
  const incrustada = `${g[6] >>> 8}.${g[6] & 255}.${g[7] >>> 8}.${g[7] & 255}`;
  if (ceros(5) && g[5] === 0xffff) return clasificarV4(incrustada);
  if (ceros(6)) return clasificarV4(incrustada) === 'publica' ? 'privada' : clasificarV4(incrustada);
  if (g[0] === 0x64 && g[1] === 0xff9b) return clasificarV4(incrustada) === 'publica' ? 'privada' : clasificarV4(incrustada);
  // Mecanismos de transición que llevan una IPv4 dentro: SIIT (::ffff:0:a.b.c.d), 6to4
  // (2002:AABB:CCDD::/48) y Teredo (2001:0::/32). No hay motivo legítimo para usarlos aquí.
  if (ceros(4) && g[4] === 0xffff && g[5] === 0) return 'privada';
  if (g[0] === 0x2002) return 'privada';
  if (g[0] === 0x2001 && g[1] === 0) return 'privada';
  if (g[0] === 0x2001 && g[1] === 0x0db8) return 'privada'; // documentación
  // Solo es pública la unidifusión global (2000::/3). Todo lo demás —red local única (fc00::/7),
  // enlace local (fe80::/10), multidifusión (ff00::/8), rangos reservados— se rechaza.
  return (g[0] & 0xe000) === 0x2000 ? 'publica' : 'privada';
}

/** @returns {'publica'|'loopback'|'privada'} */
export function clasificarIp(ip) {
  if (net.isIPv4(ip)) return clasificarV4(ip);
  if (net.isIPv6(ip)) return clasificarV6(ip);
  return 'privada';
}

const SUFIJOS_INTERNOS = ['.local', '.internal', '.intranet', '.lan', '.corp', '.home', '.home.arpa', '.localdomain'];

/** Clasifica por el nombre, sin resolver DNS. Devuelve null si hay que resolverlo. */
export function clasificarNombre(nombre) {
  const h = nombre.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (net.isIP(h)) return clasificarIp(h);
  if (h === 'localhost' || h.endsWith('.localhost')) return 'loopback';
  if (!h.includes('.') || SUFIJOS_INTERNOS.some((s) => h.endsWith(s))) return 'privada';
  return null;
}

/** ¿El host de esta URL es la propia máquina (127.0.0.0/8, ::1, localhost)? */
export function esLoopback(url) {
  try {
    return clasificarNombre(new URL(url).hostname) === 'loopback';
  } catch {
    return false;
  }
}

class DestinoBloqueado extends Error {}

// ───────────── Cliente ─────────────

export class Cliente {
  /**
   * @param {{
   *   pausaMs?: number, maxPeticiones?: number, timeoutMs?: number,
   *   permitirLocal?: boolean,
   *   resolver?: (nombre: string) => Promise<{address: string, family: number}[]>,
   *   fetch?: typeof fetch
   * }} [op]
   * `permitirLocal` admite únicamente la propia máquina (loopback), para la demo y para un
   * Supabase local de desarrollo; las redes privadas siguen bloqueadas.
   * `resolver` y `fetch` existen para las pruebas. Con `fetch` inyectado no hay red real.
   */
  constructor(op = {}) {
    this.pausaMs = op.pausaMs ?? 150;
    this.maxPeticiones = op.maxPeticiones ?? 200;
    this.timeoutMs = op.timeoutMs ?? 12000;
    this.permitirLocal = op.permitirLocal ?? false;
    this.resolver = op.resolver ?? ((nombre) => resolverDns(nombre, { all: true }));
    this.fetch = op.fetch ?? null;
    this.hechas = 0;
    this.ultima = 0;
  }

  /**
   * Comprueba que el destino es admisible y devuelve la IP a la que fijar la conexión.
   * @returns {Promise<{address: string, family: number}|null>}
   */
  async validarDestino(url) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new DestinoBloqueado(`protocolo no admitido (${url.protocol})`);
    if (url.username || url.password) throw new DestinoBloqueado('URL con credenciales incrustadas');
    const nombre = url.hostname.replace(/^\[|\]$/g, '');
    const admitir = (clase, que) => {
      if (clase === 'publica' || (clase === 'loopback' && this.permitirLocal)) return;
      throw new DestinoBloqueado(
        clase === 'loopback'
          ? `${que} es la propia máquina (solo se admite con --permitir-local)`
          : `${que} es una dirección privada o interna`,
      );
    };
    const porNombre = clasificarNombre(nombre);
    if (porNombre) {
      admitir(porNombre, nombre);
      if (net.isIP(nombre)) return { address: nombre, family: net.isIPv6(nombre) ? 6 : 4 };
    }
    if (this.fetch) return null; // transporte inyectado en pruebas: no hay conexión real
    const direcciones = await this.resolver(nombre);
    if (!direcciones.length) throw new Error('el nombre no resuelve a ninguna dirección');
    // Basta una dirección no admisible para rechazar el nombre entero.
    for (const d of direcciones) admitir(clasificarIp(d.address), `${nombre} → ${d.address}`);
    return direcciones[0];
  }

  /**
   * @returns {Promise<{ok: boolean, estado: number, cabeceras: {get(n: string): string|null}|null, texto: string, truncada?: boolean, error?: string, url: string}>}
   */
  async pedir(url, { metodo = 'GET', cabeceras = {}, cuerpo, maxBytes = 3_000_000 } = {}) {
    if (this.hechas >= this.maxPeticiones) {
      return { ok: false, estado: 0, cabeceras: null, texto: '', error: 'limite_de_peticiones', url };
    }
    const espera = this.ultima + this.pausaMs - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    this.hechas++;
    this.ultima = Date.now();

    const limite = Date.now() + this.timeoutMs;
    let actual;
    let cab = { 'User-Agent': AGENTE, ...cabeceras };
    try {
      actual = new URL(url);
      for (let salto = 0; ; salto++) {
        const fijada = await this.validarDestino(actual);
        const r = this.fetch
          ? await this.#conFetch(actual, { metodo, cab, cuerpo, maxBytes, limite })
          : await this.#conNode(actual, fijada, { metodo, cab, cuerpo, maxBytes, limite });
        const destino = r.estado >= 300 && r.estado < 400 ? r.cabeceras.get('location') : null;
        if (!destino || (metodo !== 'GET' && metodo !== 'HEAD')) return { ...r, ok: r.estado >= 200 && r.estado < 300, url: actual.href };
        if (salto >= MAX_REDIRECCIONES) return { ok: false, estado: 0, cabeceras: null, texto: '', error: 'demasiadas_redirecciones', url: actual.href };
        const siguiente = new URL(destino, actual);
        if (siguiente.origin !== actual.origin) {
          cab = Object.fromEntries(Object.entries(cab).filter(([k]) => !CABECERAS_CON_CREDENCIALES.includes(k.toLowerCase())));
        }
        actual = siguiente;
      }
    } catch (e) {
      const error = e instanceof DestinoBloqueado ? `destino_bloqueado: ${e.message}` : e?.message === 'tiempo_agotado' ? 'tiempo_agotado' : `red: ${e?.code || e?.cause?.code || e?.message || e}`;
      return { ok: false, estado: 0, cabeceras: null, texto: '', error, url: actual?.href ?? String(url) };
    }
  }

  /** Transporte real: node:http(s) con la IP fijada y lectura acotada del cuerpo. */
  #conNode(url, fijada, { metodo, cab, cuerpo, maxBytes, limite }) {
    return new Promise((resolver, rechazar) => {
      const modulo = url.protocol === 'https:' ? https : http;
      const pet = modulo.request(
        url,
        {
          method: metodo,
          headers: { 'Accept-Encoding': 'gzip, deflate, br', ...cab },
          agent: false,
          // La conexión va a la IP ya validada, no a lo que el DNS diga en este instante.
          lookup: (_nombre, opciones, cb) => (opciones?.all ? cb(null, [fijada]) : cb(null, fijada.address, fijada.family)),
        },
        (res) => {
          const cabeceras = { get: (n) => [res.headers[n.toLowerCase()]].flat()[0] ?? null };
          const terminar = (texto, truncada) => {
            clearTimeout(reloj);
            resolver({ estado: res.statusCode, cabeceras, texto, truncada });
          };
          if (metodo === 'HEAD' || (res.statusCode >= 300 && res.statusCode < 400)) {
            res.resume();
            return terminar('', false);
          }
          const codificacion = String(res.headers['content-encoding'] ?? '').toLowerCase();
          const descompresor = { gzip: zlib.createGunzip, 'x-gzip': zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress }[codificacion];
          // pipe() no propaga los errores del origen: sin este manejador, un corte de conexión
          // a mitad de una respuesta comprimida tiraría el proceso.
          res.on('error', (e) => (cerrado ? null : (clearTimeout(reloj), rechazar(e))));
          const flujo = descompresor ? res.pipe(descompresor()) : res;
          const trozos = [];
          let recibidos = 0;
          let cerrado = false;
          const cerrar = (truncada) => {
            if (cerrado) return;
            cerrado = true;
            if (truncada) {
              // Deja de descargar y de descomprimir en cuanto se alcanza el límite.
              pet.destroy();
              if (flujo !== res) flujo.destroy();
            }
            terminar(Buffer.concat(trozos).toString('utf8'), truncada);
          };
          flujo.on('data', (trozo) => {
            if (cerrado) return;
            const hueco = maxBytes - recibidos;
            if (trozo.length >= hueco) {
              trozos.push(trozo.subarray(0, hueco));
              recibidos = maxBytes;
              cerrar(true);
            } else {
              trozos.push(trozo);
              recibidos += trozo.length;
            }
          });
          flujo.on('end', () => cerrar(false));
          flujo.on('error', (e) => (cerrado ? null : (clearTimeout(reloj), rechazar(e))));
        },
      );
      const reloj = setTimeout(() => pet.destroy(new Error('tiempo_agotado')), Math.max(1, limite - Date.now()));
      pet.on('error', (e) => {
        clearTimeout(reloj);
        rechazar(e);
      });
      pet.end(cuerpo);
    });
  }

  /** Transporte inyectado (pruebas). También lee el cuerpo por trozos y lo corta al límite. */
  async #conFetch(url, { metodo, cab, cuerpo, maxBytes, limite }) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(new Error('tiempo_agotado')), Math.max(1, limite - Date.now()));
    try {
      const r = await this.fetch(url.href, { method: metodo, headers: cab, body: cuerpo, signal: control.signal, redirect: 'manual' });
      const trozos = [];
      let recibidos = 0;
      let truncada = false;
      if (metodo !== 'HEAD' && r.body) {
        const lector = r.body.getReader();
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          const hueco = maxBytes - recibidos;
          if (value.length >= hueco) {
            trozos.push(value.subarray(0, hueco));
            truncada = true;
            await lector.cancel();
            break;
          }
          trozos.push(value);
          recibidos += value.length;
        }
      }
      return { estado: r.status, cabeceras: r.headers, texto: Buffer.concat(trozos).toString('utf8'), truncada };
    } finally {
      clearTimeout(reloj);
    }
  }
}

export function json(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return undefined;
  }
}
