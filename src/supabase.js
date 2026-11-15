// Llamadas a las APIs públicas de un proyecto Supabase (PostgREST, Auth, Storage).
// Solo lectura, salvo `actualizarSinCambios`, que es una escritura real y el módulo de
// aislamiento únicamente invoca contra una base local declarada desechable.

import { json } from './http.js';
import { esIdentificador } from './util.js';

export class Supabase {
  /**
   * @param {import('./http.js').Cliente} cliente
   * @param {string} url   https://<ref>.supabase.co
   * @param {string} clave Clave pública (anon JWT o sb_publishable_).
   */
  constructor(cliente, url, clave) {
    this.c = cliente;
    this.url = url.replace(/\/+$/, '');
    this.clave = clave;
  }

  /** Cabeceras como las envía supabase-js. Las claves nuevas no son JWT y solo van en `apikey`. */
  cabeceras(token) {
    const h = { apikey: this.clave, Accept: 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    else if (this.clave.startsWith('eyJ')) h.Authorization = `Bearer ${this.clave}`;
    return h;
  }

  /**
   * Lee como mucho `limite` filas de una tabla y el recuento total.
   * @returns {Promise<{estado: 'ok'|'denegado'|'no_existe'|'clave_invalida'|'error', filas: object[], total: number|null, http: number, mensaje?: string}>}
   */
  async leer(tabla, { token, limite = 1, filtro = '' } = {}) {
    if (!esIdentificador(tabla)) return { estado: 'error', filas: [], total: null, http: 0, mensaje: 'nombre no válido' };
    const r = await this.c.pedir(`${this.url}/rest/v1/${tabla}?select=*&limit=${limite}${filtro ? `&${filtro}` : ''}`, {
      cabeceras: { ...this.cabeceras(token), Prefer: 'count=exact' },
    });
    return interpretarLectura(r);
  }

  /**
   * ¿Acepta el proyecto esta clave? Se pregunta a un endpoint que no depende de ninguna tabla.
   * Sirve para no confundir "la clave no vale" con "todas las tablas están protegidas".
   * @returns {Promise<'aceptada'|'rechazada'|'desconocido'>}
   */
  async estadoClave() {
    const r = await this.c.pedir(`${this.url}/auth/v1/settings`, { cabeceras: this.cabeceras(), maxBytes: 20000 });
    if (r.ok && json(r.texto) && typeof json(r.texto) === 'object') return 'aceptada';
    if (r.estado === 401 || r.estado === 403) return 'rechazada';
    return 'desconocido';
  }

  /** Configuración pública de autenticación. */
  async ajustesAuth() {
    const r = await this.c.pedir(`${this.url}/auth/v1/settings`, { cabeceras: this.cabeceras() });
    return r.ok ? json(r.texto) : null;
  }

  /** Especificación OpenAPI en la raíz de PostgREST (retirada para claves públicas en 2026). */
  async esquema() {
    const r = await this.c.pedir(`${this.url}/rest/v1/`, { cabeceras: this.cabeceras() });
    const doc = r.ok ? json(r.texto) : null;
    if (!doc || typeof doc !== 'object') return null;
    const tablas = Object.keys(doc.definitions ?? doc.components?.schemas ?? {}).filter(esIdentificador);
    const funciones = Object.keys(doc.paths ?? {}).filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5));
    if (!tablas.length && !funciones.length) return null;
    return { tablas, funciones };
  }

  /** Lista hasta `limite` objetos de un bucket. Devuelve null si no se permite. */
  async listarBucket(bucket, { token, limite = 5 } = {}) {
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(bucket)) return null;
    const r = await this.c.pedir(`${this.url}/storage/v1/object/list/${bucket}`, {
      metodo: 'POST',
      cabeceras: { ...this.cabeceras(token), 'Content-Type': 'application/json' },
      cuerpo: JSON.stringify({ prefix: '', limit: limite, offset: 0 }),
    });
    const lista = r.ok ? json(r.texto) : null;
    return Array.isArray(lista) ? lista.length : null;
  }

  /** Inicia sesión con correo y contraseña. */
  async iniciarSesion(correo, contrasena) {
    const r = await this.c.pedir(`${this.url}/auth/v1/token?grant_type=password`, {
      metodo: 'POST',
      cabeceras: { apikey: this.clave, 'Content-Type': 'application/json' },
      cuerpo: JSON.stringify({ email: correo, password: contrasena }),
    });
    const d = json(r.texto);
    if (!r.ok || !d?.access_token || !d?.user?.id) {
      return { ok: false, mensaje: d?.msg || d?.error_description || d?.message || r.error || `HTTP ${r.estado}` };
    }
    return { ok: true, token: d.access_token, id: d.user.id };
  }

  /**
   * UPDATE real que asigna a la columna dueño el valor que ya tiene, sobre las filas de
   * `idDueno`. Si devuelve filas, quien llama puede modificar filas ajenas.
   * OJO: aunque el valor no cambie, la base de datos ejecuta la escritura: se disparan los
   * triggers BEFORE/AFTER UPDATE (updated_at, auditoría, webhooks…) y se emiten eventos.
   * No usar contra datos reales.
   */
  async actualizarSinCambios(tabla, columna, idDueno, token) {
    if (!esIdentificador(tabla) || !esIdentificador(columna)) return { estado: 'error', filas: 0 };
    const r = await this.c.pedir(`${this.url}/rest/v1/${tabla}?${columna}=eq.${encodeURIComponent(idDueno)}`, {
      metodo: 'PATCH',
      cabeceras: { ...this.cabeceras(token), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      cuerpo: JSON.stringify({ [columna]: idDueno }),
    });
    const filas = json(r.texto);
    if (r.ok && Array.isArray(filas)) return { estado: 'ok', filas: filas.length };
    return { estado: r.estado === 401 || r.estado === 403 ? 'denegado' : 'error', filas: 0, http: r.estado };
  }
}

function interpretarLectura(r) {
  const cuerpo = json(r.texto);
  if (r.estado === 200 || r.estado === 206) {
    const filas = Array.isArray(cuerpo) ? cuerpo : [];
    const rango = r.cabeceras?.get('content-range') ?? '';
    const m = rango.match(/\/(\d+)$/);
    return { estado: 'ok', filas, total: m ? Number(m[1]) : null, http: r.estado };
  }
  const codigo = cuerpo?.code ?? '';
  const mensaje = cuerpo?.message ?? r.error ?? '';
  if (r.estado === 404 || codigo === 'PGRST205' || codigo === '42P01') return { estado: 'no_existe', filas: [], total: null, http: r.estado, mensaje };
  if (codigo === '42501') return { estado: 'denegado', filas: [], total: null, http: r.estado, mensaje };
  if (r.estado === 401 && /api key|apikey|jwt/i.test(mensaje)) return { estado: 'clave_invalida', filas: [], total: null, http: r.estado, mensaje };
  if (r.estado === 401 || r.estado === 403) return { estado: 'denegado', filas: [], total: null, http: r.estado, mensaje };
  return { estado: 'error', filas: [], total: null, http: r.estado, mensaje };
}
