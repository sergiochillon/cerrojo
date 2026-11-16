// Prueba de aislamiento entre usuarios.
//
// Es la comprobación que los escáneres automáticos no hacen: en lugar de mirar si RLS está
// "activado", inicia sesión con dos cuentas de prueba (A y B) y comprueba si cada una recibe
// filas de la otra.
//
// Qué datos toca, sin eufemismos:
// - LEE filas completas: hasta `limite` (máximo 1.000) por cuenta y por tabla. Esas filas
//   llegan a la memoria de este proceso con todos sus valores. No se escriben en disco ni en el
//   resultado (solo recuentos y nombres de columna), pero se han descargado. Por eso la prueba
//   debe hacerse con cuentas y datos ficticios, o en un entorno de pruebas.
// - La comprobación opcional de escritura ejecuta un UPDATE real. Asigna a una columna el valor
//   que ya tiene, pero para la base de datos es una escritura: dispara triggers (por ejemplo
//   los que actualizan updated_at o envían avisos), genera WAL y eventos de Realtime. Solo se
//   permite contra una base local y desechable.

import { Cliente, esLoopback } from './http.js';
import { Supabase } from './supabase.js';
import { hallazgo } from './catalogo.js';
import { ahoraIso, categoriasSensibles, gravedadPorCategorias, pesoGravedad, RE_COLUMNA_DUENO, esIdentificador, esClaveSecreta, AVISO_CLAVE_SECRETA, sinControl } from './util.js';

// Columnas de auditoría: que el id de una cuenta figure ahí no la hace partícipe de la fila.
const RE_COLUMNA_AUDITORIA = /^(updated|modified|deleted|approved|reviewed|edited|last_[a-z_]+)_by(_id)?$/i;
// Orden de preferencia al elegir la columna que identifica al dueño.
const DUENO_PREFERIDO = ['user_id', 'owner_id', 'owner', 'uid', 'usuario_id', 'propietario_id', 'profile_id', 'account_id', 'author_id', 'created_by'];

/**
 * @param {{
 *   supabaseUrl: string, clave: string,
 *   usuarioA: {correo: string, contrasena: string}, usuarioB: {correo: string, contrasena: string},
 *   tablas: string[], probarEscritura?: boolean, limite?: number,
 *   cliente?: Cliente, avisar?: (s: string) => void
 * }} op
 */
/** Tope de filas que se leen por cuenta y tabla. */
export const LIMITE_MAXIMO = 1000;

export async function probarAislamiento(op) {
  const cliente = op.cliente ?? new Cliente();
  const avisar = op.avisar ?? (() => {});
  const limite = Math.min(Math.max(Math.trunc(Number(op.limite ?? LIMITE_MAXIMO)) || LIMITE_MAXIMO, 1), LIMITE_MAXIMO);
  if (esClaveSecreta(op.clave)) throw new Error(AVISO_CLAVE_SECRETA);
  // La escritura se decide antes de hacer ninguna petición y no depende de quien llame a esta
  // función: fuera de una base local declarada desechable, no se ejecuta.
  if (op.probarEscritura && !(esLoopback(op.supabaseUrl) && op.baseDesechable === true)) {
    throw new Error(
      'La prueba de escritura ejecuta un UPDATE real (puede disparar triggers aunque no cambie valores). ' +
        'Solo está disponible contra una base local y desechable: Supabase en 127.0.0.1/localhost, ' +
        'con --permitir-local y --base-desechable. Contra un proyecto alojado no se ejecuta.',
    );
  }
  let filasLeidas = 0;
  const inicio = ahoraIso();
  const sb = new Supabase(cliente, op.supabaseUrl, op.clave);

  const sesiones = {};
  for (const [nombre, u] of [['A', op.usuarioA], ['B', op.usuarioB]]) {
    const s = await sb.iniciarSesion(u.correo, u.contrasena);
    if (!s.ok) throw new Error(`No se pudo iniciar sesión con el usuario ${nombre}: ${s.mensaje}`);
    sesiones[nombre] = s;
  }
  if (sesiones.A.id === sesiones.B.id) throw new Error('Los usuarios A y B son la misma cuenta; hacen falta dos cuentas distintas.');
  avisar('Sesión iniciada con las dos cuentas de prueba');
  avisar(`Se leerán hasta ${limite} filas completas por cuenta y tabla (en memoria; no se guardan sus valores)`);

  const hallazgos = [];
  const superadas = [];
  const notas = [];
  const avisos = []; // lo que impide concluir; el informe lo destaca
  const matriz = [];
  const conError = [];

  for (const tabla of [...new Set(op.tablas)].filter(esIdentificador).sort()) {
    const vistas = {};
    let inaccesible = null;
    for (const quien of ['A', 'B']) {
      const r = await sb.leer(tabla, { token: sesiones[quien].token, limite });
      if (r.estado !== 'ok') {
        inaccesible = r.estado;
        break;
      }
      vistas[quien] = r;
    }
    if (inaccesible) {
      // Un error del servidor, un límite de frecuencia o una respuesta cortada NO equivalen a
      // "acceso denegado": no se sabe qué habría devuelto la tabla.
      const resultado = inaccesible === 'no_existe' ? 'no_existe' : inaccesible === 'denegado' ? 'denegada' : 'error';
      if (resultado === 'error') conError.push(tabla);
      matriz.push({ tabla, resultado });
      continue;
    }

    const filas = [...vistas.A.filas, ...vistas.B.filas];
    filasLeidas += filas.length;
    const columnas = Object.keys(filas[0] ?? {}).slice(0, 200);
    const columnaDueno = detectarColumnaDueno(filas, columnas, sesiones);
    const fila = { tabla, columnaDueno, A: vistas.A.total ?? vistas.A.filas.length, B: vistas.B.total ?? vistas.B.filas.length, resultado: 'no_concluyente' };

    if (!filas.length) {
      fila.resultado = 'sin_datos';
    } else if (!columnaDueno) {
      fila.resultado = 'sin_dueno';
    } else {
      const categorias = categoriasSensibles([tabla, ...columnas]);
      const propias = {};
      let fuga = false;
      // Una fila "tiene que ver" con un usuario si su id figura en alguna columna que no sea
      // de auditoría. Así no se marca como fuga lo legítimo (un mensaje que B envió a A), pero
      // tampoco se oculta una fuga solo porque la cuenta aparezca en updated_by.
      const columnasRelacion = columnas.filter((c) => !RE_COLUMNA_AUDITORIA.test(c));
      const relacionada = (f, id) => columnasRelacion.some((c) => f[c] === id);
      const lecturas = [];
      let compartidas = 0;
      let sinDuenoVisibles = 0;
      for (const [quien, otro] of [['A', 'B'], ['B', 'A']]) {
        const mias = sesiones[quien].id;
        const suyas = sesiones[otro].id;
        const vis = vistas[quien].filas;
        propias[quien] = vis.filter((f) => f[columnaDueno] === mias).length;
        const filasAjenas = vis.filter((f) => f[columnaDueno] != null && !relacionada(f, mias));
        const delOtro = filasAjenas.filter((f) => relacionada(f, suyas)).length;
        if (filasAjenas.length > 0) lecturas.push({ quien, ajenas: filasAjenas.length, delOtro });
        // Lo que NO se cuenta como fuga, pero tampoco debe pasar en silencio:
        compartidas += vis.filter((f) => f[columnaDueno] != null && f[columnaDueno] !== mias && relacionada(f, mias)).length;
        sinDuenoVisibles = Math.max(sinDuenoVisibles, vis.filter((f) => f[columnaDueno] == null).length);
      }
      if (compartidas) {
        notas.push({
          es: `public.${tabla}: ${compartidas} lectura(s) de filas de otro dueño que NO se cuentan como fuga porque el id de quien las lee figura en otra columna de la fila. Es lo normal en datos compartidos (mensajes, miembros); confirma que aquí lo es.`,
          en: `public.${tabla}: ${compartidas} read(s) of rows owned by someone else that are NOT counted as a leak because the reader’s id appears in another column of the row. Normal for shared data (messages, members); confirm that is the case here.`,
        });
      }
      if (sinDuenoVisibles) {
        avisos.push({
          es: `public.${tabla}: hay ${sinDuenoVisibles} fila(s) visibles con la columna de dueño (${columnaDueno}) vacía. No se puede saber de quién son: confirma a mano si deben ser comunes.`,
          en: `public.${tabla}: ${sinDuenoVisibles} visible row(s) have an empty owner column (${columnaDueno}). Whose they are cannot be determined: confirm manually whether they should be shared.`,
        });
      }
      if (lecturas.length) {
        fuga = true;
        const g = gravedadPorCategorias(categorias);
        hallazgos.push(hallazgo('A-LECTURA-CRUZADA', pesoGravedad(g) > pesoGravedad('alta') ? 'alta' : g, `public.${tabla}`, { tabla, columna: sinControl(columnaDueno).slice(0, 80), lecturas, columnas: columnas.map((c) => sinControl(c).slice(0, 80)), categorias }));
      }
      if (fuga) {
        fila.resultado = 'fuga';
      } else if (propias.A + propias.B > 0) {
        fila.resultado = 'aislada';
        superadas.push({
          es: `public.${tabla}: A tiene ${propias.A} fila(s) propias y B ${propias.B}; ninguna cuenta ve filas de la otra.`,
          en: `public.${tabla}: A owns ${propias.A} row(s) and B ${propias.B}; neither account sees the other’s rows.`,
        });
      } else {
        fila.resultado = 'sin_datos';
      }

      if (op.probarEscritura) {
        const escrituras = [];
        let sinRespuestaClara = false;
        for (const [quien, otro] of [['A', 'B'], ['B', 'A']]) {
          const r = await sb.actualizarSinCambios(tabla, columnaDueno, sesiones[otro].id, sesiones[quien].token);
          if (r.estado === 'ok' && r.filas > 0) escrituras.push({ quien, filas: r.filas });
          else if (r.estado === 'error') sinRespuestaClara = true;
        }
        if (escrituras.length) hallazgos.push(hallazgo('A-ESCRITURA-CRUZADA', 'critica', `public.${tabla}`, { tabla, columna: columnaDueno, escrituras }));
        fila.escritura = escrituras.length ? 'fuga' : sinRespuestaClara ? 'no_concluyente' : 'aislada';
      }
    }
    if ((vistas.A.total ?? 0) > limite || (vistas.B.total ?? 0) > limite) {
      notas.push({ es: `public.${tabla}: se analizaron las primeras ${limite} filas de cada cuenta.`, en: `public.${tabla}: only the first ${limite} rows per account were analysed.` });
    }
    matriz.push(fila);
  }

  if (conError.length) {
    avisos.push({
      es: `No se pudo comprobar (error del servidor, límite de frecuencia o respuesta demasiado grande): ${conError.join(', ')}. Esas tablas NO figuran como protegidas; repite la prueba, si hace falta con un --limite menor.`,
      en: `Could not be checked (server error, rate limit or oversized response): ${conError.join(', ')}. Those tables are NOT reported as protected; re-run, with a smaller --limite if needed.`,
    });
  }
  const sinDatos = matriz.filter((m) => m.resultado === 'sin_datos').map((m) => m.tabla);
  if (sinDatos.length) {
    avisos.push({
      es: `No concluyente en: ${sinDatos.join(', ')}. Ninguna de las cuentas de prueba tiene filas propias ahí; crea datos con ambas cuentas y repite la prueba.`,
      en: `Inconclusive for: ${sinDatos.join(', ')}. Neither test account owns rows there; create data with both accounts and re-run.`,
    });
  }
  const sinDueno = matriz.filter((m) => m.resultado === 'sin_dueno').map((m) => `${m.tabla} (A: ${m.A}, B: ${m.B})`);
  if (sinDueno.length) {
    avisos.push({
      es: `Sin columna de dueño identificable en: ${sinDueno.join('; ')}. Ambas cuentas leen filas; hay que confirmar a mano si es contenido común.`,
      en: `No identifiable owner column in: ${sinDueno.join('; ')}. Both accounts read rows; confirm manually whether this is shared content.`,
    });
  }
  notas.push({
    es: `Para la prueba de aislamiento se descargaron ${filasLeidas} fila(s) completas (tope: ${limite} por cuenta y tabla). Se procesaron en memoria; en este informe solo constan recuentos y nombres de columna.`,
    en: `The isolation test downloaded ${filasLeidas} full row(s) (cap: ${limite} per account and table). They were processed in memory; this report only holds counts and column names.`,
  });
  if (op.probarEscritura) {
    notas.push({
      es: 'La prueba de escritura ejecutó sentencias UPDATE reales sobre una base local declarada desechable. Asignan a una columna el valor que ya tenía, pero disparan triggers y pueden haber modificado columnas derivadas (p. ej. updated_at).',
      en: 'The write test ran real UPDATE statements against a local database declared disposable. They set a column to its existing value, but fire triggers and may have modified derived columns (e.g. updated_at).',
    });
  } else {
    notas.push({
      es: 'No se probó la escritura cruzada. Esa comprobación solo se ejecuta contra una base local desechable; en un proyecto alojado, la escritura se evalúa revisando las políticas.',
      en: 'Cross-user writes were not tested. That check only runs against a disposable local database; on a hosted project, writes are assessed by reviewing the policies.',
    });
  }

  return {
    herramienta: 'cerrojo',
    tipo: 'aislamiento',
    objetivo: op.supabaseUrl,
    inicio,
    fin: ahoraIso(),
    peticiones: cliente.hechas,
    hallazgos,
    superadas,
    notas,
    avisos,
    matriz,
    lectura: { limitePorCuentaYTabla: limite, filasDescargadas: filasLeidas },
    escrituraProbada: !!op.probarEscritura,
  };
}

/**
 * Columna que identifica al dueño de cada fila. Solo se acepta una columna en la que aparezca
 * el id de alguna de las dos cuentas de prueba: es la única evidencia de que guarda usuarios.
 * Una columna que solo "suena" a dueño (account_id, profile_id…) puede apuntar a otra cosa
 * —una organización, por ejemplo— y tomarla por dueño convertiría cada fila en una falsa fuga.
 */
function detectarColumnaDueno(filas, columnas, sesiones) {
  const ids = [sesiones.A.id, sesiones.B.id];
  const conCoincidencia = columnas.filter((c) => !RE_COLUMNA_AUDITORIA.test(c) && filas.some((f) => ids.includes(f[c])));
  return DUENO_PREFERIDO.find((c) => conCoincidencia.includes(c)) ?? conCoincidencia.find((c) => RE_COLUMNA_DUENO.test(c)) ?? conCoincidencia[0] ?? null;
}
