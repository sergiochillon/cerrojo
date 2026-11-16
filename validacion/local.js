// Validación de cerrojo contra un Supabase LOCAL (el que levanta `supabase start` con Docker).
//
// Es la forma más barata de comprobar la herramienta contra los servicios reales de Supabase
// (su pasarela, PostgREST, Auth) sin crear nada en la nube: todo vive en contenedores de esta
// máquina y se destruye con `supabase stop --no-backup`.
//
// ESTADO: este programa NO se ha ejecutado todavía contra un Supabase local. Está escrito a
// partir de la documentación y ensayado solo en sus partes que no dependen de Docker. Es el
// paso manual pendiente; si algo falla, el mensaje dice qué hacer a mano (ver LOCAL.md).
//
// Qué hace, por orden:
//   1. Comprueba que el destino es esta máquina (127.0.0.1/localhost). Si no, no hace nada.
//   2. Deja la base de pruebas en un estado conocido: borra los objetos cv_ y las dos cuentas
//      de prueba de ejecuciones anteriores (solo eso) y aplica 01_esquema.sql.
//   3. Crea las dos cuentas de prueba con contraseñas aleatorias que solo existen en memoria.
//   4. Aplica 02_datos.sql.
//   5. Ejecuta las mismas comprobaciones de solo lectura que validar.js.
//   6. Como la base es local y desechable, ejecuta además la prueba de escritura.
//
// Uso (desde la carpeta donde hiciste `supabase init` y `supabase start`):
//   node /ruta/a/cerrojo/validacion/local.js
// La URL y la clave pública se leen de `supabase status`; también pueden darse con
// CERROJO_SUPABASE_URL y CERROJO_CLAVE.

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Cliente, esLoopback } from '../src/http.js';
import { probarAislamiento } from '../src/aislamiento.js';
import { esClaveSecreta } from '../src/util.js';
import { ejecutarValidacion, imprimir } from './validar.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const sql = (nombre) => readFileSync(join(AQUI, nombre), 'utf8');
const decir = (s) => process.stdout.write(`${s}\n`);

/** Lo que debe concluir la prueba de escritura en las tablas con dueño. */
export const ESPERADO_ESCRITURA = { cv_sin_rls: 'fuga', cv_solo_sesion: 'fuga', cv_por_dueno: 'aislada' };

/** Lee API_URL y la clave pública de la salida de `supabase status -o env`. */
export function leerEstado(texto) {
  const valor = (nombre) => texto.match(new RegExp(`^${nombre}="?([^"\\n]+)"?$`, 'm'))?.[1];
  return { url: valor('API_URL'), clave: valor('PUBLISHABLE_KEY') ?? valor('ANON_KEY') };
}

/** Motivos para no empezar. Aquí solo se admite la propia máquina. */
export function motivosLocales({ url, clave }) {
  const motivos = [];
  if (!url || !esLoopback(url)) motivos.push(`El destino debe ser un Supabase local (http://127.0.0.1:54321). Recibido: ${url ?? '(nada)'}. Este programa nunca se ejecuta contra un proyecto alojado.`);
  if (!clave) motivos.push('No encuentro la clave pública local. Ejecuta esto desde la carpeta del proyecto local, o define CERROJO_CLAVE con la clave "anon"/"publishable" que muestra `supabase status`.');
  else if (esClaveSecreta(clave)) motivos.push('La clave indicada es la secreta (service_role). Usa la pública (anon/publishable) que muestra `supabase status`.');
  return motivos;
}

function ejecutar(orden, args, entrada) {
  const r = spawnSync(orden, args, { input: entrada, encoding: 'utf8', maxBuffer: 20_000_000 });
  return { ok: r.status === 0, salida: `${r.stdout ?? ''}`, error: `${r.stderr ?? ''}${r.error ? r.error.message : ''}` };
}

async function principal() {
  // 1. Destino.
  let url = process.env.CERROJO_SUPABASE_URL;
  let clave = process.env.CERROJO_CLAVE;
  if (!url || !clave) {
    const estado = ejecutar('npx', ['-y', 'supabase', 'status', '-o', 'env']);
    if (estado.ok) {
      const leido = leerEstado(estado.salida);
      url ??= leido.url;
      clave ??= leido.clave;
    }
  }
  const motivos = motivosLocales({ url, clave });
  if (motivos.length) {
    process.stderr.write(`No se ha hecho nada.\n\n${motivos.map((m) => `  · ${m}`).join('\n')}\n\nSigue validacion/LOCAL.md.\n`);
    return 2;
  }
  url = url.replace(/\/+$/, '');

  // 2. Contenedor de la base de datos local.
  const contenedores = ejecutar('docker', ['ps', '--format', '{{.Names}}']);
  const candidatos = contenedores.salida.split('\n').filter((n) => /^supabase_db_/.test(n));
  const contenedor = process.env.CERROJO_LOCAL_CONTENEDOR ?? (candidatos.length === 1 ? candidatos[0] : null);
  if (!contenedor) {
    process.stderr.write(
      candidatos.length > 1
        ? `Hay varios Supabase locales en marcha (${candidatos.join(', ')}). Indica cuál con CERROJO_LOCAL_CONTENEDOR.\n`
        : 'No encuentro el contenedor de la base de datos (supabase_db_…). ¿Está Docker en marcha y has ejecutado `supabase start`?\n',
    );
    return 2;
  }
  const psql = (texto, nombre) => {
    const r = ejecutar('docker', ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], texto);
    if (!r.ok) throw new Error(`Falló ${nombre}:\n${r.error.trim().slice(0, 1500)}`);
  };

  try {
    decir(`Supabase local: ${url} · contenedor ${contenedor}`);
    // Estado conocido: fuera lo de ejecuciones anteriores (solo objetos cv_ y cuentas cerrojo-a/b).
    psql(
      `do $$ begin
         if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'cv_marca') then
           drop view if exists public.cv_vista_sin_invoker, public.cv_vista_con_invoker;
           drop table if exists public.cv_volumen, public.cv_mensajes, public.cv_sin_permisos, public.cv_rls_sin_politicas, public.cv_por_dueno, public.cv_solo_sesion, public.cv_sin_rls, public.cv_marca;
         end if;
       end $$;
       delete from auth.users where email ~* '^cerrojo-[ab]@example\\.test$';`,
      'la limpieza previa',
    );
    psql(sql('01_esquema.sql'), '01_esquema.sql');
    decir('✔ Esquema de validación aplicado');

    // 3. Cuentas de prueba, con contraseñas que no salen de este proceso.
    const cliente = new Cliente({ pausaMs: 50, permitirLocal: true, maxPeticiones: 150 });
    const cuentas = {};
    for (const letra of ['a', 'b']) {
      const correo = `cerrojo-${letra}@example.test`;
      const contrasena = randomBytes(18).toString('base64url');
      const r = await cliente.pedir(`${url}/auth/v1/signup`, { metodo: 'POST', cabeceras: { apikey: clave, 'Content-Type': 'application/json' }, cuerpo: JSON.stringify({ email: correo, password: contrasena }) });
      if (!r.ok) throw new Error(`No se pudo crear la cuenta ${correo} (HTTP ${r.estado}). Créala a mano en el panel local y usa validar.js; ver LOCAL.md.`);
      cuentas[letra] = { correo, contrasena };
    }
    decir('✔ Dos cuentas de prueba creadas');
    psql(sql('02_datos.sql'), '02_datos.sql');
    decir('✔ Datos sintéticos cargados\n');

    // 4. Las mismas comprobaciones de solo lectura que contra un proyecto alojado.
    const resultado = await ejecutarValidacion({ cliente, supabaseUrl: url, clave, usuarioA: cuentas.a, usuarioB: cuentas.b });

    // 5. Prueba de escritura: solo aquí, porque la base es local y desechable.
    const escritura = await probarAislamiento({ supabaseUrl: url, clave, tablas: Object.keys(ESPERADO_ESCRITURA), usuarioA: cuentas.a, usuarioB: cuentas.b, probarEscritura: true, baseDesechable: true, cliente });
    for (const [tabla, esperado] of Object.entries(ESPERADO_ESCRITURA)) {
      const observado = escritura.matriz.find((m) => m.tabla === tabla)?.escritura ?? '(sin resultado)';
      resultado.comprobaciones.push({ id: `escritura/${tabla}`, descripcion: `Escritura entre cuentas: ${tabla}`, esperado, observado, ok: esperado === observado });
    }

    const fallos = imprimir(resultado, decir);
    const carpeta = join(AQUI, '..', 'salida');
    mkdirSync(carpeta, { recursive: true });
    const { aislamiento, ...validacion } = resultado;
    writeFileSync(join(carpeta, 'validacion-local.json'), JSON.stringify(validacion, null, 2));
    writeFileSync(join(carpeta, 'validacion-local-aislamiento.json'), JSON.stringify(aislamiento, null, 2));
    decir(`\nDetalle guardado en ${join(carpeta, 'validacion-local.json')}`);
    decir('Para dejarlo todo como estaba: npx supabase stop --no-backup');
    return fallos ? 1 : 0;
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await principal());
}
