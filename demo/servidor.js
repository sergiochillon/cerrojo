// Servidor local de demostración: sirve la app ficticia "Clientia" y emula el subconjunto de
// las APIs de Supabase que usa cerrojo (PostgREST, Auth y Storage).
//
// La autorización NO está simulada: detrás hay un PostgreSQL real (PGlite, Postgres compilado
// a WASM) con los roles anon/authenticated y las políticas RLS de la migración de la app. Lo
// que sí es una emulación es la capa HTTP, escrita según la documentación pública de Supabase.
//
// Solo escucha en 127.0.0.1. Todos los datos y claves son inventados y se generan al arrancar.

import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = join(AQUI, 'app-vulnerable');

// Cuentas de prueba del entorno local (valores de ejemplo, sin uso fuera de esta demo).
export const USUARIOS = {
  A: { id: 'aaaaaaaa-0000-4000-8000-000000000001', correo: 'ana@clientia.test', contrasena: 'demo-local-ana' },
  B: { id: 'bbbbbbbb-0000-4000-8000-000000000002', correo: 'bruno@clientia.test', contrasena: 'demo-local-bruno' },
  C: { id: 'cccccccc-0000-4000-8000-000000000003', correo: 'carla@clientia.test', contrasena: 'demo-local-carla' },
};

const PRELUDIO = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema storage;
  create table auth.users (id uuid primary key, email text unique not null, raw_user_meta_data jsonb default '{}');
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create function auth.role() returns text language sql stable as
    $$ select coalesce(auth.jwt() ->> 'role', 'anon') $$;
  create table storage.buckets (id text primary key, name text not null, public boolean default false);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text not null, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
  grant usage on schema public, auth, storage to anon, authenticated, service_role;
  grant select on storage.objects, storage.buckets to anon, authenticated;
`;

// Comportamiento histórico de Supabase: toda tabla nueva de public quedaba expuesta a la API.
// Desde octubre de 2026 ya no es así (hacen falta GRANT explícitos); la app ficticia imita
// un proyecto antiguo, y el ensayo del guion de validación lo desactiva.
const PERMISOS_HISTORICOS = `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

function semilla() {
  const { A, B, C } = USUARIOS;
  const u = (x, nombre, rol = 'user', plan = 'free') => `
    insert into auth.users (id, email) values ('${x.id}', '${x.correo}');
    insert into public.profiles (id, email, full_name, role, plan) values ('${x.id}', '${x.correo}', '${nombre}', '${rol}', '${plan}');`;
  return `
    ${u(A, 'Ana Ejemplo')} ${u(B, 'Bruno Ejemplo')} ${u(C, 'Carla Ejemplo', 'admin', 'pro')}
    insert into public.clients (user_id, name, email, phone, notes) values
      ('${A.id}', 'Taller Ficticio 1', 'taller1@example.test', '600000001', 'Cliente de Ana'),
      ('${A.id}', 'Taller Ficticio 2', 'taller2@example.test', '600000002', 'Cliente de Ana'),
      ('${B.id}', 'Clínica Ficticia 1', 'clinica1@example.test', '600000003', 'Cliente de Bruno'),
      ('${B.id}', 'Clínica Ficticia 2', 'clinica2@example.test', '600000004', 'Cliente de Bruno'),
      ('${B.id}', 'Clínica Ficticia 3', 'clinica3@example.test', '600000005', 'Cliente de Bruno'),
      ('${C.id}', 'Bufete Ficticio', 'bufete@example.test', '600000006', 'Cliente de Carla');
    insert into public.invoices (user_id, amount, iban, status) values
      ('${A.id}', 120.00, 'ES0000000000000000000001', 'sent'),
      ('${A.id}', 80.50, 'ES0000000000000000000001', 'draft'),
      ('${B.id}', 990.00, 'ES0000000000000000000002', 'paid'),
      ('${C.id}', 45.00, 'ES0000000000000000000003', 'paid');
    insert into public.integration_tokens (user_id, provider, access_token) values
      ('${A.id}', 'calendario', 'token-ficticio-ana'),
      ('${B.id}', 'correo', 'token-ficticio-bruno');
    insert into public.plans (id, title, monthly_price) values ('free', 'Gratis', 0), ('pro', 'Pro', 19);
    insert into public.waitlist (email) values ('interesado@example.test');
    insert into public.audit_log (actor, action) values ('${A.id}', 'login');
    insert into storage.objects (bucket_id, name, owner) values
      ('invoices-pdf', '${A.id}/factura-1.pdf', '${A.id}'),
      ('invoices-pdf', '${B.id}/factura-9.pdf', '${B.id}');
  `;
}

// ───────────── JWT HS256 mínimo ─────────────
const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
export function firmarJwt(carga, secreto) {
  const datos = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(carga)}`;
  return `${datos}.${createHmac('sha256', secreto).update(datos).digest('base64url')}`;
}
function verificarJwt(token, secreto) {
  const [c, p, f] = String(token).split('.');
  if (!c || !p || !f) return null;
  const esperada = createHmac('sha256', secreto).update(`${c}.${p}`).digest();
  const recibida = Buffer.from(f, 'base64url');
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  try {
    return JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const idSql = (s) => `"${String(s).replace(/"/g, '""')}"`;
const esId = (s) => /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(s);

/**
 * Arranca la demo.
 * @param {{
 *   puerto?: number, corregida?: boolean,
 *   sql?: string[], usuarios?: Record<string, {id: string, correo: string, contrasena: string}>,
 *   sinPermisosPorDefecto?: boolean
 * }} [op]
 * `corregida` aplica además los arreglos. Con `sql` no se carga la app ficticia: se crean las
 * cuentas de `usuarios` y se ejecutan esos scripts (así se ensaya en local el guion de
 * validación/, con `sinPermisosPorDefecto` para imitar un proyecto Supabase actual).
 */
export async function iniciarDemo(op = {}) {
  const secreto = randomBytes(32).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const claveAnon = firmarJwt({ iss: 'supabase', ref: 'clientiademo', role: 'anon', exp }, secreto);
  // Clave con formato de proveedor de IA, inventada en cada arranque.
  const claveIa = `sk-proj-${randomBytes(30).toString('base64url')}`;

  const usuarios = op.usuarios ?? USUARIOS;
  const db = new PGlite();
  await db.exec(PRELUDIO);
  if (!op.sinPermisosPorDefecto) await db.exec(PERMISOS_HISTORICOS);
  if (op.sql) {
    for (const u of Object.values(usuarios)) await db.query('insert into auth.users (id, email) values ($1, $2)', [u.id, u.correo]);
    for (const script of op.sql) await db.exec(script);
  } else {
    const dirMig = join(APP, 'supabase', 'migrations');
    for (const f of readdirSync(dirMig).filter((x) => x.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dirMig, f), 'utf8'));
    if (op.corregida) await db.exec(readFileSync(join(AQUI, 'arreglos.sql'), 'utf8'));
    await db.exec(semilla());
  }

  let url = '';
  const paginaInicio = readFileSync(join(APP, 'index.html'), 'utf8');
  const bundle = () =>
    readFileSync(join(APP, 'assets', 'index.plantilla.js'), 'utf8')
      .replace('__SUPABASE_URL__', url)
      .replace('__ANON_KEY__', claveAnon)
      .replace('__CLAVE_IA__', op.corregida ? '' : claveIa);

  /** Ejecuta `fn` dentro de una transacción con el rol y las claims de quien llama. */
  async function comoRol(claims, fn) {
    const rol = ['anon', 'authenticated', 'service_role'].includes(claims.role) ? claims.role : 'anon';
    return db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.exec(`set local role ${rol}`);
      return fn(tx);
    });
  }

  function identificar(req) {
    const apikey = req.headers.apikey;
    if (!apikey || !verificarJwt(apikey, secreto)) return null;
    const portador = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    return (portador && verificarJwt(portador, secreto)) || verificarJwt(apikey, secreto);
  }

  const enviar = (res, estado, cuerpo, cabeceras = {}) => {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    res.writeHead(estado, { 'Content-Type': typeof cuerpo === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', ...cabeceras });
    res.end(texto);
  };
  const leerCuerpo = (req) =>
    new Promise((ok) => {
      let d = '';
      req.on('data', (c) => (d += c));
      req.on('end', () => {
        try {
          ok(JSON.parse(d || '{}'));
        } catch {
          ok({});
        }
      });
    });

  async function rest(req, res, u, claims) {
    const tabla = u.pathname.slice('/rest/v1/'.length);
    if (!tabla) return enviar(res, 401, { message: 'Access to the OpenAPI spec requires a secret key', code: 'PGRST301' });
    const existe = esId(tabla) && (await db.query("select 1 from information_schema.tables where table_schema = 'public' and table_name = $1", [tabla])).rows.length;
    if (!existe) return enviar(res, 404, { code: 'PGRST205', message: `Could not find the table 'public.${tabla}' in the schema cache` });

    // Filtros del tipo columna=eq.valor
    const filtros = [];
    for (const [k, v] of u.searchParams) {
      if (['select', 'limit', 'offset', 'order'].includes(k)) continue;
      if (!esId(k) || !v.startsWith('eq.')) return enviar(res, 400, { code: 'PGRST100', message: 'Filtro no soportado por la demo' });
      filtros.push([k, v.slice(3)]);
    }
    const donde = filtros.length ? ` where ${filtros.map(([k], i) => `${idSql(k)}::text = $${i + 1}`).join(' and ')}` : '';
    const valores = filtros.map(([, v]) => v);
    const limite = Math.min(Number(u.searchParams.get('limit') ?? 1000) || 1000, 1000);

    try {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const { filas, total } = await comoRol(claims, async (tx) => ({
          filas: (await tx.query(`select * from public.${idSql(tabla)}${donde} limit ${limite}`, valores)).rows,
          total: Number((await tx.query(`select count(*)::int as n from public.${idSql(tabla)}${donde}`, valores)).rows[0].n),
        }));
        const rango = filas.length ? `0-${filas.length - 1}/${total}` : `*/${total}`;
        return enviar(res, 200, req.method === 'HEAD' ? '' : filas, { 'Content-Range': rango, 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (req.method === 'PATCH') {
        const cuerpo = await leerCuerpo(req);
        const cols = Object.keys(cuerpo).filter(esId);
        if (!cols.length) return enviar(res, 400, { code: 'PGRST102', message: 'Cuerpo vacío' });
        const asigna = cols.map((c, i) => `${idSql(c)} = $${valores.length + i + 1}`).join(', ');
        const filas = await comoRol(claims, async (tx) => (await tx.query(`update public.${idSql(tabla)} set ${asigna}${donde} returning *`, [...valores, ...cols.map((c) => cuerpo[c])])).rows);
        return enviar(res, 200, filas);
      }
      return enviar(res, 405, { message: 'Método no soportado por la demo' });
    } catch (e) {
      if (e.code === '42501') return enviar(res, claims.role === 'anon' ? 401 : 403, { code: '42501', message: e.message });
      return enviar(res, 400, { code: e.code ?? 'XX000', message: e.message });
    }
  }

  const servidor = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      const ruta = u.pathname;

      if (ruta.startsWith('/rest/v1/') || ruta.startsWith('/auth/v1/') || ruta.startsWith('/storage/v1/')) {
        const claims = identificar(req);
        if (!claims) return enviar(res, 401, { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' });

        if (ruta === '/auth/v1/settings') return enviar(res, 200, { external: { email: true }, disable_signup: false, mailer_autoconfirm: !op.corregida });
        if (ruta === '/auth/v1/token' && req.method === 'POST') {
          const { email, password } = await leerCuerpo(req);
          const usuario = Object.values(usuarios).find((x) => x.correo === email && x.contrasena === password);
          if (!usuario) return enviar(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
          const token = firmarJwt({ iss: 'supabase', sub: usuario.id, role: 'authenticated', email, user_metadata: {}, exp }, secreto);
          return enviar(res, 200, { access_token: token, token_type: 'bearer', expires_in: 3600, user: { id: usuario.id, email } });
        }
        if (ruta.startsWith('/storage/v1/object/list/') && req.method === 'POST') {
          const bucket = decodeURIComponent(ruta.slice('/storage/v1/object/list/'.length));
          const { limit = 100 } = await leerCuerpo(req);
          const filas = await comoRol(claims, async (tx) => (await tx.query('select name from storage.objects where bucket_id = $1 limit $2', [bucket, Math.min(Number(limit) || 100, 100)])).rows);
          return enviar(res, 200, filas);
        }
        if (ruta.startsWith('/rest/v1/')) return rest(req, res, u, claims);
        return enviar(res, 404, { message: 'No encontrado' });
      }

      if (ruta === '/assets/index-4f3a9c.js') return enviar(res, 200, bundle(), { 'Content-Type': 'text/javascript; charset=utf-8' });
      if (ruta === '/assets/index-4f3a9c.js.map' && !op.corregida) {
        return enviar(res, 200, { version: 3, file: 'index-4f3a9c.js', sources: ['../src/main.tsx'], mappings: '' });
      }
      if (ruta === '/assets/vendor-1b2c3d.js') return enviar(res, 200, 'export const createClient=()=>({});', { 'Content-Type': 'text/javascript; charset=utf-8' });
      // Como cualquier SPA, responde con index.html a las rutas que no conoce (incluida /.env).
      const seguras = op.corregida
        ? { 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }
        : {};
      return enviar(res, 200, paginaInicio, seguras);
    } catch (e) {
      enviar(res, 500, { message: String(e?.message ?? e) });
    }
  });

  await new Promise((ok) => servidor.listen(op.puerto ?? 0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${servidor.address().port}`;
  return {
    url,
    claveAnon,
    usuarios,
    db,
    cerrar: async () => {
      await new Promise((ok) => servidor.close(ok));
      await db.close();
    },
  };
}

// Ejecución directa: `npm run demo:servidor`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const demo = await iniciarDemo({ puerto: Number(process.env.PUERTO ?? 54321), corregida: process.argv.includes('--corregida') });
  process.stdout.write(
    `App ficticia vulnerable en ${demo.url}  (Ctrl+C para parar)\n\n` +
      `Pruébala en otra terminal (es tu propia máquina, de ahí --permitir-local):\n` +
      `  node bin/cerrojo.js web ${demo.url} --autorizo --permitir-local --salida salida/web.json\n` +
      `  CERROJO_A_CORREO=${USUARIOS.A.correo} CERROJO_A_CONTRASENA=${USUARIOS.A.contrasena} \\\n` +
      `  CERROJO_B_CORREO=${USUARIOS.B.correo} CERROJO_B_CONTRASENA=${USUARIOS.B.contrasena} \\\n` +
      `  node bin/cerrojo.js aislamiento --autorizo --permitir-local --desde salida/web.json \\\n` +
      `    --probar-escritura --base-desechable --salida salida/aislamiento.json\n` +
      `  node bin/cerrojo.js repo demo/app-vulnerable --salida salida/repo.json\n` +
      `  node bin/cerrojo.js informe salida/web.json salida/aislamiento.json salida/repo.json --salida salida/informe.html\n\n` +
      `La base de datos de esta demo está en memoria y desaparece al parar el servidor: por eso\n` +
      `aquí sí se puede usar --probar-escritura.\n`,
  );
}
