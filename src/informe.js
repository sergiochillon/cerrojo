// Genera el informe entregable (HTML autocontenido, imprimible a PDF) a partir de uno o
// varios resultados de auditoría. Sin recursos externos: se puede enviar tal cual.

import { CATALOGO, ETIQUETA_GRAVEDAD } from './catalogo.js';
import { GRAVEDADES, pesoGravedad } from './util.js';

const T = {
  es: {
    titulo: 'Informe de comprobación de acceso a datos',
    para: 'Preparado para',
    por: 'Comprobación realizada por',
    fecha: 'Fecha',
    resumen: 'Resumen',
    hallazgos: 'Hallazgos',
    sinHallazgos: 'Las comprobaciones realizadas no han encontrado problemas. Lee la sección de límites: no encontrar fallos no equivale a que no existan.',
    veredictoGrave: 'Hay hallazgos de gravedad crítica o alta. Recomendación: corregirlos antes de abrir la aplicación a usuarios reales, o cuanto antes si ya está en uso.',
    veredictoMedio: 'No se han encontrado hallazgos críticos ni altos. Conviene revisar los de gravedad media antes de crecer en usuarios.',
    veredictoLeve: 'Solo se han encontrado mejoras de gravedad baja o informativas.',
    veredictoNoConcluyente: 'Resultado NO concluyente: parte de las comprobaciones no pudo hacerse (ver los avisos). La ausencia de hallazgos graves no permite afirmar nada sobre lo que quedó sin comprobar.',
    avisos: 'Avisos: lo que no se ha podido comprobar',
    descartados: 'Hallazgos automáticos descartados tras la revisión manual',
    motivo: 'Motivo',
    noRevisado: 'No revisado',
    alcance: 'Alcance: qué se ha comprobado',
    donde: 'Dónde',
    evidencia: 'Qué se ha observado',
    porque: 'Por qué importa',
    arreglo: 'Cómo arreglarlo',
    superadas: 'Comprobaciones superadas',
    matriz: 'Prueba de aislamiento entre usuarios',
    matrizIntro: 'Se inició sesión con dos cuentas de prueba (A y B) y se comprobó si cada una recibe filas de la otra.',
    inventario: 'Tablas según las migraciones del repositorio',
    superficie: 'Superficie pendiente de revisión manual',
    superficieIntro: 'Elementos detectados que la herramienta no invoca porque podrían tener efectos. Deben revisarse leyendo su código.',
    limites: 'Límites de este informe',
    rgpd: 'Nota sobre protección de datos',
    rgpdTexto:
      'Algunos hallazgos indican que datos de usuarios han podido ser accesibles para terceros. Si la aplicación trata datos personales de usuarios reales, esto puede constituir una brecha de seguridad en el sentido del RGPD (art. 33), que obliga al responsable a valorar su notificación a la autoridad de control en un plazo de 72 horas. Esta nota no es asesoramiento jurídico: consulta con tu delegado de protección de datos o asesor legal.',
    tabla: 'Tabla',
    resultado: 'Lectura',
    escritura: 'Escritura',
    dueno: 'Columna dueño',
    filasA: 'Filas que ve A',
    filasB: 'Filas que ve B',
    rls: 'RLS',
    politicas: 'Políticas',
    si: 'sí',
    no: 'no',
    autorizacion: 'Autorización',
    autorizacionTexto: 'Quien ejecutó la herramienta declaró ser titular de la aplicación o contar con autorización escrita de su titular.',
    peticiones: 'peticiones HTTP',
    tipo: { web: 'Aplicación desplegada (sin sesión)', aislamiento: 'Aislamiento entre usuarios (con dos cuentas de prueba)', repo: 'Repositorio (migraciones SQL y código)', manual: 'Revisión manual' },
    res: { fuga: 'FUGA', aislada: 'aislada', sin_datos: 'no concluyente (sin datos de prueba)', sin_dueno: 'sin columna de dueño', denegada: 'acceso denegado', no_existe: 'no existe', no_concluyente: 'no concluyente', error: 'no se pudo comprobar' },
    limitesLista: [
      'Es una revisión acotada en el tiempo, no una garantía de seguridad ni una certificación.',
      'Las comprobaciones automáticas detectan clases concretas de fallos (exposición de datos por RLS, secretos publicados, configuración). No cubren la lógica de negocio, pagos, ni ataques que requieran interacción.',
      'La prueba de aislamiento solo es concluyente en tablas donde las cuentas de prueba tienen datos propios.',
      'Para comprobar el acceso, la herramienta descarga filas de la base de datos (una por tabla sin sesión; hasta 1.000 por cuenta y tabla en la prueba de aislamiento) y las analiza en memoria. Sus valores no se guardan en este informe ni en disco.',
      'Las funciones RPC y Edge Functions no se ejecutan: su revisión es manual.',
      'El resultado refleja el estado en la fecha indicada. Cada cambio posterior en tablas o políticas puede introducir fallos nuevos.',
    ],
    pie: 'Generado con cerrojo',
  },
  en: {
    titulo: 'Data access check report',
    para: 'Prepared for',
    por: 'Check performed by',
    fecha: 'Date',
    resumen: 'Summary',
    hallazgos: 'Findings',
    sinHallazgos: 'The checks performed found no issues. Read the limits section: finding no flaws does not mean none exist.',
    veredictoGrave: 'There are critical or high severity findings. Recommendation: fix them before opening the application to real users, or as soon as possible if it is already in use.',
    veredictoMedio: 'No critical or high findings. Review the medium ones before growing your user base.',
    veredictoLeve: 'Only low-severity or informational improvements were found.',
    veredictoNoConcluyente: 'INCONCLUSIVE result: some checks could not be performed (see the warnings). The absence of serious findings says nothing about what was left unchecked.',
    avisos: 'Warnings: what could not be checked',
    descartados: 'Automated findings dismissed after manual review',
    motivo: 'Reason',
    noRevisado: 'Not reviewed',
    alcance: 'Scope: what was checked',
    donde: 'Where',
    evidencia: 'What was observed',
    porque: 'Why it matters',
    arreglo: 'How to fix it',
    superadas: 'Checks passed',
    matriz: 'User isolation test',
    matrizIntro: 'Two test accounts (A and B) were signed in to check whether each receives the other’s rows.',
    inventario: 'Tables according to the repository migrations',
    superficie: 'Surface pending manual review',
    superficieIntro: 'Detected elements the tool does not invoke because they may have side effects. They must be reviewed by reading their code.',
    limites: 'Limits of this report',
    rgpd: 'Data protection note',
    rgpdTexto:
      'Some findings indicate user data may have been accessible to third parties. If the application processes personal data of real users, this may constitute a personal data breach under the GDPR (Art. 33), which requires the controller to assess notifying the supervisory authority within 72 hours. This note is not legal advice: consult your data protection officer or legal counsel.',
    tabla: 'Table',
    resultado: 'Read',
    escritura: 'Write',
    dueno: 'Owner column',
    filasA: 'Rows A sees',
    filasB: 'Rows B sees',
    rls: 'RLS',
    politicas: 'Policies',
    si: 'yes',
    no: 'no',
    autorizacion: 'Authorization',
    autorizacionTexto: 'The person running the tool declared they own the application or hold written authorization from its owner.',
    peticiones: 'HTTP requests',
    tipo: { web: 'Deployed application (no session)', aislamiento: 'User isolation (two test accounts)', repo: 'Repository (SQL migrations and code)', manual: 'Manual review' },
    res: { fuga: 'LEAK', aislada: 'isolated', sin_datos: 'inconclusive (no test data)', sin_dueno: 'no owner column', denegada: 'access denied', no_existe: 'does not exist', no_concluyente: 'inconclusive', error: 'could not be checked' },
    limitesLista: [
      'This is a time-boxed review, not a security guarantee or certification.',
      'Automated checks detect specific classes of flaws (RLS data exposure, published secrets, configuration). They do not cover business logic, payments, or attacks requiring interaction.',
      'The isolation test is only conclusive for tables where the test accounts own data.',
      'To check access, the tool downloads database rows (one per table without a session; up to 1,000 per account and table in the isolation test) and analyses them in memory. Their values are not stored in this report or on disk.',
      'RPC and Edge Functions are not executed: they are reviewed manually.',
      'Results reflect the state on the stated date. Any later change to tables or policies can introduce new flaws.',
    ],
    pie: 'Generated with cerrojo',
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Sustituye {tabla}, {columna}… en el texto de arreglo con los datos del hallazgo. */
function rellenar(texto, datos) {
  return texto.replace(/\{(tabla|columna|politica|comando)\}/g, (todo, k) => {
    const v = datos?.[k];
    return v == null || v === 'all' ? (k === 'comando' ? 'select' : `<${k}>`) : String(v);
  });
}

/** El detalle se compone a partir de `datos`; si el archivo viene incompleto, no debe romper el informe. */
function detalleSeguro(c, datos, idioma) {
  try {
    return String(c.detalle(datos ?? {}, idioma) ?? '');
  } catch {
    return '';
  }
}
const clase = (v) => (/^[a-z_]{1,30}$/.test(String(v ?? '')) ? String(v) : '');
const numero = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? String(Number(v)) : '—');

/** Ordena y prepara los hallazgos de varios resultados para presentarlos. */
export function consolidar(resultados, idioma = 'es') {
  const todos = [];
  const descartados = [];
  // Un hallazgo automático se descarta solo si la revisión manual lo pide con su id y su
  // ubicación exactos; queda listado aparte, con el motivo, para que nada desaparezca en silencio.
  const aDescartar = resultados.flatMap((r) => r.descartar ?? []);
  for (const r of resultados) {
    for (const original of r.hallazgos ?? []) {
      // Los resultados se leen de archivos: no se da por bueno ningún campo.
      const h = { ...original, gravedad: GRAVEDADES.includes(original.gravedad) ? original.gravedad : 'info', donde: String(original.donde ?? '') };
      if (h.texto) {
        // Hallazgo escrito a mano por el auditor.
        todos.push({ ...h, origen: r.tipo, titulo: h.texto.titulo, porque: h.texto.porque ?? '', arreglo: h.texto.arreglo ?? '', detalle: h.texto.detalle ?? '' });
        continue;
      }
      const c = CATALOGO[h.id];
      if (!c) {
        todos.push({ ...h, origen: r.tipo, titulo: `Hallazgo ${String(h.id)}`, porque: '', arreglo: '', detalle: '' });
        continue;
      }
      const presentado = {
        ...h,
        origen: r.tipo,
        titulo: c.titulo[idioma],
        porque: c.porque[idioma],
        arreglo: rellenar(c.arreglo[idioma], h.datos),
        detalle: detalleSeguro(c, h.datos, idioma),
      };
      const descarte = aDescartar.find((d) => d.id === h.id && d.donde === h.donde);
      if (descarte) descartados.push({ ...presentado, motivo: descarte.motivo });
      else todos.push(presentado);
    }
  }
  todos.sort((a, b) => pesoGravedad(a.gravedad) - pesoGravedad(b.gravedad) || a.id.localeCompare(b.id) || String(a.donde).localeCompare(String(b.donde)));
  const cuenta = Object.fromEntries(GRAVEDADES.map((g) => [g, todos.filter((h) => h.gravedad === g).length]));
  return { hallazgos: todos, cuenta, descartados };
}

/**
 * @param {object[]} resultados Resultados de web/aislamiento/repo.
 * @param {{idioma?: 'es'|'en', cliente?: string, auditor?: string, app?: string, fecha?: string}} [meta]
 */
export function generarInforme(resultados, meta = {}) {
  const L = meta.idioma === 'en' ? 'en' : 'es';
  const t = T[L];
  const { hallazgos, cuenta, descartados } = consolidar(resultados, L);
  const fecha = meta.fecha ?? new Date().toISOString().slice(0, 10);
  const app = meta.app ?? resultados.find((r) => r.tipo === 'web')?.objetivo ?? resultados[0]?.objetivo ?? '';
  // Los textos pueden venir en los dos idiomas ({es, en}) o, si los escribió el auditor, como texto.
  const frases = (campo) => resultados.flatMap((r) => (Array.isArray(r[campo]) ? r[campo] : []).map((x) => (typeof x === 'string' ? x : String(x?.[L] ?? ''))).filter(Boolean));
  const avisos = frases('avisos');
  const hayGraves = cuenta.critica + cuenta.alta > 0;
  // Con avisos y sin hallazgos graves, lo honesto es decir que no se puede concluir.
  const veredicto = hayGraves ? t.veredictoGrave : avisos.length ? t.veredictoNoConcluyente : !hallazgos.length ? t.sinHallazgos : cuenta.media > 0 ? t.veredictoMedio : t.veredictoLeve;
  // Si se pasan varios resultados del mismo tipo, sus tablas se suman.
  const matriz = resultados.filter((r) => r.tipo === 'aislamiento').flatMap((r) => (Array.isArray(r.matriz) ? r.matriz : []));
  const inventario = resultados.filter((r) => r.tipo === 'repo').flatMap((r) => (Array.isArray(r.inventario) ? r.inventario : []));
  const web = resultados.find((r) => r.tipo === 'web');
  const hayDatosExpuestos = hallazgos.some((h) => ['S-TABLA-LEGIBLE-ANON', 'A-LECTURA-CRUZADA', 'A-ESCRITURA-CRUZADA', 'S-BUCKET-LISTABLE'].includes(h.id));
  const requiereAutorizacion = resultados.some((r) => r.tipo === 'web' || r.tipo === 'aislamiento');

  const chips = GRAVEDADES.map((g) => `<div class="chip g-${g}"><b>${cuenta[g]}</b><span>${esc(ETIQUETA_GRAVEDAD[L][g])}</span></div>`).join('');

  const tarjetas = hallazgos
    .map(
      (h, i) => `
    <article class="hallazgo g-${h.gravedad}">
      <header><span class="etq">${esc(ETIQUETA_GRAVEDAD[L][h.gravedad])}</span><h3>${i + 1}. ${esc(h.titulo)}</h3></header>
      <dl>
        <dt>${t.donde}</dt><dd><code>${esc(h.donde)}</code></dd>
        ${h.detalle ? `<dt>${t.evidencia}</dt><dd>${esc(h.detalle)}</dd>` : ''}
        <dt>${t.porque}</dt><dd>${esc(h.porque)}</dd>
        <dt>${t.arreglo}</dt><dd><pre>${esc(h.arreglo)}</pre></dd>
      </dl>
    </article>`,
    )
    .join('');

  const filasAlcance = resultados
    .map((r) => `<tr><td>${esc(t.tipo[r.tipo] ?? r.tipo)}</td><td><code>${esc(r.objetivo)}</code></td><td>${esc(String(r.fin ?? '').slice(0, 16).replace('T', ' '))} UTC${Number(r.peticiones) > 0 ? ` · ${numero(r.peticiones)} ${t.peticiones}` : ''}</td></tr>`)
    .join('');

  const seccionMatriz = matriz.length
    ? `<section><h2>${t.matriz}</h2><p>${t.matrizIntro}</p>
      <table><thead><tr><th>${t.tabla}</th><th>${t.dueno}</th><th>${t.filasA}</th><th>${t.filasB}</th><th>${t.resultado}</th><th>${t.escritura}</th></tr></thead><tbody>
      ${matriz
        .map(
          (m) =>
            `<tr><td><code>${esc(m.tabla)}</code></td><td>${m.columnaDueno ? `<code>${esc(m.columnaDueno)}</code>` : '—'}</td><td>${numero(m.A)}</td><td>${numero(m.B)}</td><td class="r-${clase(m.resultado)}">${esc(t.res[m.resultado] ?? m.resultado)}</td><td class="r-${clase(m.escritura)}">${m.escritura ? esc(t.res[m.escritura] ?? m.escritura) : '—'}</td></tr>`,
        )
        .join('')}
      </tbody></table></section>`
    : '';

  const seccionInventario = inventario.length
    ? `<section><h2>${t.inventario}</h2><table><thead><tr><th>${t.tabla}</th><th>${t.rls}</th><th>${t.politicas}</th></tr></thead><tbody>
      ${inventario.map((x) => `<tr><td><code>${esc(x.tabla)}</code></td><td class="${x.rls ? '' : 'r-fuga'}">${x.rls ? t.si : t.no}</td><td>${numero(x.politicas)}</td></tr>`).join('')}
      </tbody></table></section>`
    : '';

  const sup = web?.superficie;
  const itemsSuperficie = sup ? [['RPC', sup.rpc], ['Edge Functions', sup.funciones], ['Storage', sup.buckets]].filter(([, xs]) => Array.isArray(xs) && xs.length) : [];
  const seccionSuperficie = itemsSuperficie.length
    ? `<section><h2>${t.superficie}</h2><p>${t.superficieIntro}</p><ul>${itemsSuperficie.map(([n, xs]) => `<li><b>${n}:</b> ${xs.map((x) => `<code>${esc(x)}</code>`).join(', ')}</li>`).join('')}</ul></section>`
    : '';

  const superadas = frases('superadas');
  const notas = frases('notas');
  const noRevisado = frases('noRevisado').map((s) => `${t.noRevisado}: ${s}`);
  const seccionAvisos = avisos.length ? `<section><h2>${t.avisos}</h2><ul class="avisos">${avisos.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></section>` : '';
  const seccionDescartados = descartados.length
    ? `<section><h2>${t.descartados}</h2><div class="tabla-ancha"><table><thead><tr><th>${t.hallazgos}</th><th>${t.donde}</th><th>${t.motivo}</th></tr></thead><tbody>
      ${descartados.map((d) => `<tr><td>${esc(d.titulo)}</td><td><code>${esc(d.donde)}</code></td><td>${esc(d.motivo ?? '—')}</td></tr>`).join('')}
      </tbody></table></div></section>`
    : '';

  return `<!doctype html>
<html lang="${L}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(t.titulo)} — ${esc(app)}</title>
<style>
  :root { --tinta:#1b1f24; --suave:#5b6470; --linea:#d9dee4; --fondo:#f6f7f9; --papel:#fff;
    --critica:#b3261e; --alta:#c2570c; --media:#8a6d00; --baja:#2f6f9f; --info:#5b6470; --bien:#1f7a4d; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--fondo); color:var(--tinta); font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 40px 20px 64px; }
  h1 { font-size: 28px; line-height:1.2; margin: 0 0 4px; letter-spacing:-.01em; }
  h2 { font-size: 19px; margin: 40px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--tinta); }
  h3 { font-size: 16px; margin: 0; }
  p { margin: 0 0 12px; }
  code, pre { font: 13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  code { background:#eceff3; padding: 1px 5px; border-radius: 4px; overflow-wrap:anywhere; }
  pre { background:#12161b; color:#e7ebf0; padding: 12px 14px; border-radius: 6px; white-space: pre-wrap; overflow-wrap:anywhere; margin:0; }
  .meta { color:var(--suave); margin: 0 0 20px; }
  .meta b { color:var(--tinta); font-weight:600; }
  .objetivo { font-size:16px; margin:0 0 6px; overflow-wrap:anywhere; }
  .chips { display:grid; grid-template-columns: repeat(5, 1fr); gap:8px; margin: 16px 0; }
  .chip { background:var(--papel); border:1px solid var(--linea); border-top:4px solid var(--c); border-radius:6px; padding:10px 12px; }
  .chip b { display:block; font-size:24px; line-height:1.1; font-variant-numeric: tabular-nums; }
  .chip span { color:var(--suave); font-size:13px; }
  .g-critica { --c:var(--critica); } .g-alta { --c:var(--alta); } .g-media { --c:var(--media); } .g-baja { --c:var(--baja); } .g-info { --c:var(--info); }
  .veredicto { background:var(--papel); border:1px solid var(--linea); border-left:4px solid var(--tinta); border-radius:6px; padding:12px 16px; }
  .hallazgo { background:var(--papel); border:1px solid var(--linea); border-left:5px solid var(--c); border-radius:6px; padding:16px 18px; margin: 0 0 14px; break-inside: avoid; }
  .hallazgo header { display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; margin-bottom:10px; }
  .etq { background:var(--c); color:#fff; font-size:12px; font-weight:600; padding:2px 8px; border-radius:999px; text-transform:uppercase; letter-spacing:.04em; }
  dl { margin:0; display:grid; grid-template-columns: 150px 1fr; gap: 8px 14px; }
  dt { color:var(--suave); font-size:13px; padding-top:2px; }
  dd { margin:0; min-width:0; }
  table { width:100%; border-collapse:collapse; background:var(--papel); border:1px solid var(--linea); border-radius:6px; font-size:14px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--linea); vertical-align:top; }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--suave); }
  tr:last-child td { border-bottom:0; }
  .tabla-ancha { overflow-x:auto; }
  table code { white-space:nowrap; }
  .r-fuga { color:var(--critica); font-weight:700; } .r-aislada { color:var(--bien); font-weight:600; }
  ul { margin:0 0 12px; padding-left: 20px; } li { margin-bottom:6px; }
  .ok li::marker { content: "✓  "; color: var(--bien); }
  .avisos { background:#fff8e6; border:1px solid #e3c770; border-left:5px solid var(--media); border-radius:6px; padding:14px 18px 8px 36px; }
  footer { margin-top:48px; padding-top:12px; border-top:1px solid var(--linea); color:var(--suave); font-size:13px; }
  @media (max-width: 640px) { .chips { grid-template-columns: repeat(2, 1fr); } dl { grid-template-columns: 1fr; gap:2px 0; } dt { padding-top:8px; } }
  @media print { body { background:#fff; font-size:12px; } main { padding:0; max-width:none; } .hallazgo, .chip, table, .veredicto { box-shadow:none; } h2 { break-after: avoid; } }
</style>
</head>
<body>
<main>
  <h1>${esc(t.titulo)}</h1>
  <p class="objetivo"><code>${esc(app)}</code></p>
  <p class="meta">${t.fecha}: <b>${esc(fecha)}</b>${meta.cliente ? ` · ${t.para}: <b>${esc(meta.cliente)}</b>` : ''}${meta.auditor ? ` · ${t.por}: <b>${esc(meta.auditor)}</b>` : ''}</p>

  <section>
    <h2>${t.resumen}</h2>
    <div class="chips">${chips}</div>
    <p class="veredicto">${esc(veredicto)}</p>
  </section>

  ${seccionAvisos}

  <section>
    <h2>${t.alcance}</h2>
    <div class="tabla-ancha"><table><tbody>${filasAlcance}</tbody></table></div>
    ${requiereAutorizacion ? `<p style="margin-top:10px"><b>${t.autorizacion}:</b> ${t.autorizacionTexto}</p>` : ''}
  </section>

  <section>
    <h2>${t.hallazgos} (${hallazgos.length})</h2>
    ${tarjetas || `<p>${esc(t.sinHallazgos)}</p>`}
  </section>

  ${seccionMatriz.replace('<table>', '<div class="tabla-ancha"><table>').replace('</table>', '</table></div>')}
  ${seccionInventario}
  ${superadas.length ? `<section><h2>${t.superadas}</h2><ul class="ok">${superadas.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></section>` : ''}
  ${seccionSuperficie}
  ${seccionDescartados}
  ${hayDatosExpuestos ? `<section><h2>${t.rgpd}</h2><p>${esc(t.rgpdTexto)}</p></section>` : ''}

  <section>
    <h2>${t.limites}</h2>
    <ul>${[...t.limitesLista, ...notas, ...noRevisado].map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  </section>

  <footer>${t.pie} · ${esc(fecha)}</footer>
</main>
</body>
</html>
`;
}

/** Resumen en texto para la terminal. */
export function resumenTexto(resultado, idioma = 'es') {
  const { hallazgos, cuenta } = consolidar([resultado], idioma);
  const lineas = hallazgos.map((h) => `  [${ETIQUETA_GRAVEDAD[idioma][h.gravedad].toUpperCase().padEnd(11)}] ${h.titulo} — ${h.donde}`);
  const totales = GRAVEDADES.filter((g) => cuenta[g]).map((g) => `${cuenta[g]} ${ETIQUETA_GRAVEDAD[idioma][g].toLowerCase()}`).join(', ');
  const avisos = (resultado.avisos ?? []).map((a) => `  ! NO CONCLUYENTE: ${a[idioma]}`);
  // (Quien imprime esto en la terminal quita antes los caracteres de control.)
  return [`${hallazgos.length} hallazgo(s)${totales ? `: ${totales}` : ''}`, ...lineas, ...avisos].join('\n');
}
