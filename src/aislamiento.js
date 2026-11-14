// Prueba de aislamiento entre usuarios.
//
// Es la comprobación que los escáneres automáticos no hacen: en lugar de mirar si RLS está
// "activado", inicia sesión con dos cuentas de prueba (A y B) y comprueba si cada una recibe
// filas de la otra. Las filas se procesan en memoria y solo se conservan recuentos y nombres
// de columna.

import { Cliente } from './http.js';
import { Supabase } from './supabase.js';
import { hallazgo } from './catalogo.js';
import { ahoraIso, categoriasSensibles, gravedadPorCategorias, pesoGravedad, RE_COLUMNA_DUENO, esUuid, esIdentificador } from './util.js';

/**
 * @param {{
 *   supabaseUrl: string, clave: string,
 *   usuarioA: {correo: string, contrasena: string}, usuarioB: {correo: string, contrasena: string},
 *   tablas: string[], probarEscritura?: boolean, limite?: number,
 *   cliente?: Cliente, avisar?: (s: string) => void
 * }} op
 */
export async function probarAislamiento(op) {
  const cliente = op.cliente ?? new Cliente();
  const avisar = op.avisar ?? (() => {});
  const limite = op.limite ?? 1000;
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

  const hallazgos = [];
  const superadas = [];
  const notas = [];
  const matriz = [];

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
      matriz.push({ tabla, resultado: inaccesible === 'no_existe' ? 'no_existe' : 'denegada' });
      continue;
    }

    const filas = [...vistas.A.filas, ...vistas.B.filas];
    const columnas = Object.keys(filas[0] ?? {});
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
      // Una fila "tiene que ver" con un usuario si alguna de sus columnas contiene su id.
      // Así no se marca como fuga lo que es legítimo: p. ej. un mensaje que B envió a A.
      const relacionada = (f, id) => columnas.some((c) => f[c] === id);
      const lecturas = [];
      for (const [quien, otro] of [['A', 'B'], ['B', 'A']]) {
        const mias = sesiones[quien].id;
        const suyas = sesiones[otro].id;
        const vis = vistas[quien].filas;
        propias[quien] = vis.filter((f) => f[columnaDueno] === mias).length;
        const filasAjenas = vis.filter((f) => f[columnaDueno] != null && !relacionada(f, mias));
        const delOtro = filasAjenas.filter((f) => relacionada(f, suyas)).length;
        if (filasAjenas.length > 0) lecturas.push({ quien, ajenas: filasAjenas.length, delOtro });
      }
      if (lecturas.length) {
        fuga = true;
        const g = gravedadPorCategorias(categorias);
        hallazgos.push(hallazgo('A-LECTURA-CRUZADA', pesoGravedad(g) > pesoGravedad('alta') ? 'alta' : g, `public.${tabla}`, { tabla, columna: columnaDueno, lecturas, columnas, categorias }));
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
        for (const [quien, otro] of [['A', 'B'], ['B', 'A']]) {
          const r = await sb.actualizarSinCambios(tabla, columnaDueno, sesiones[otro].id, sesiones[quien].token);
          if (r.estado === 'ok' && r.filas > 0) escrituras.push({ quien, filas: r.filas });
        }
        if (escrituras.length) hallazgos.push(hallazgo('A-ESCRITURA-CRUZADA', 'critica', `public.${tabla}`, { tabla, columna: columnaDueno, escrituras }));
        fila.escritura = escrituras.length ? 'fuga' : 'aislada';
      }
    }
    if ((vistas.A.total ?? 0) > limite || (vistas.B.total ?? 0) > limite) {
      notas.push({ es: `public.${tabla}: se analizaron las primeras ${limite} filas de cada cuenta.`, en: `public.${tabla}: only the first ${limite} rows per account were analysed.` });
    }
    matriz.push(fila);
  }

  const sinDatos = matriz.filter((m) => m.resultado === 'sin_datos').map((m) => m.tabla);
  if (sinDatos.length) {
    notas.push({
      es: `No concluyente en: ${sinDatos.join(', ')}. Ninguna de las cuentas de prueba tiene filas propias ahí; crea datos con ambas cuentas y repite la prueba.`,
      en: `Inconclusive for: ${sinDatos.join(', ')}. Neither test account owns rows there; create data with both accounts and re-run.`,
    });
  }
  const sinDueno = matriz.filter((m) => m.resultado === 'sin_dueno').map((m) => `${m.tabla} (A: ${m.A}, B: ${m.B})`);
  if (sinDueno.length) {
    notas.push({
      es: `Sin columna de dueño identificable en: ${sinDueno.join('; ')}. Ambas cuentas leen filas; hay que confirmar a mano si es contenido común.`,
      en: `No identifiable owner column in: ${sinDueno.join('; ')}. Both accounts read rows; confirm manually whether this is shared content.`,
    });
  }
  if (!op.probarEscritura) {
    notas.push({ es: 'No se probó la escritura cruzada (opción --probar-escritura).', en: 'Cross-user writes were not tested (option --probar-escritura).' });
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
    matriz,
  };
}

/** Columna que identifica al dueño: preferimos una cuyo valor coincide con el id de A o B. */
function detectarColumnaDueno(filas, columnas, sesiones) {
  const ids = [sesiones.A.id, sesiones.B.id];
  const conCoincidencia = columnas.filter((c) => filas.some((f) => ids.includes(f[c])));
  const porNombre = (cs) => cs.find((c) => RE_COLUMNA_DUENO.test(c));
  return (
    porNombre(conCoincidencia) ??
    conCoincidencia[0] ??
    columnas.find((c) => RE_COLUMNA_DUENO.test(c) && filas.some((f) => esUuid(f[c]))) ??
    null
  );
}
