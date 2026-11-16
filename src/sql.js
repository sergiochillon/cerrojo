// Lectura tolerante de migraciones SQL de Supabase para reconstruir el estado de RLS:
// qué tablas existen, cuáles tienen RLS y qué permite cada política.
//
// No es un analizador completo de PostgreSQL: reconoce las sentencias que afectan a la
// autorización y deja pasar el resto. Lo que no entiende no lo inventa.
//
// El SQL viene del repositorio de un tercero. Todo el recorrido es de coste lineal y las
// sentencias desmesuradas (volcados de datos) se saltan en vez de analizarse.

const MAX_SENTENCIA = 100_000; // caracteres; más allá es un volcado de datos, no un esquema
const MAX_EXPRESION = 5_000;
const RE_DOLAR = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;

// Las expresiones se componen a partir de ID y NOMBRE; se compilan una sola vez.
const compiladas = new Map();
function rx(fuente, banderas = '') {
  const clave = `${banderas}/${fuente}`;
  let r = compiladas.get(clave);
  if (!r) compiladas.set(clave, (r = new RegExp(fuente, banderas)));
  return r;
}
// Solo estas sentencias pueden afectar a la autorización; el resto ni se mira.
const RE_INTERESA = /^(create|alter|drop|insert|update|grant|revoke)\s/i;

/** Divide un script en sentencias respetando cadenas, comentarios (anidados) y bloques $$...$$. */
export function dividirSentencias(sql) {
  const sentencias = [];
  const trozos = [];
  let desde = 0; // inicio del tramo de texto "normal" aún no volcado
  let i = 0;
  const n = sql.length;
  const volcar = (hasta) => {
    if (hasta > desde) trozos.push(sql.slice(desde, hasta));
  };
  const cerrar = () => {
    const s = trozos.join('').trim();
    if (s) sentencias.push(s);
    trozos.length = 0;
  };
  while (i < n) {
    const c = sql.charCodeAt(i);
    if (c === 45 /* - */ && sql.charCodeAt(i + 1) === 45) {
      volcar(i);
      const fin = sql.indexOf('\n', i);
      i = fin === -1 ? n : fin;
      trozos.push(' ');
      desde = i;
    } else if (c === 47 /* / */ && sql.charCodeAt(i + 1) === 42 /* * */) {
      // PostgreSQL admite comentarios de bloque anidados.
      volcar(i);
      let nivel = 1;
      i += 2;
      while (i < n && nivel > 0) {
        const abre = sql.indexOf('/*', i);
        const cierra = sql.indexOf('*/', i);
        if (cierra === -1) {
          i = n;
          break;
        }
        if (abre !== -1 && abre < cierra) {
          nivel++;
          i = abre + 2;
        } else {
          nivel--;
          i = cierra + 2;
        }
      }
      trozos.push(' ');
      desde = i;
    } else if (c === 39 /* ' */ || c === 34 /* " */) {
      const comilla = sql[i];
      let j = i + 1;
      for (;;) {
        j = sql.indexOf(comilla, j);
        if (j === -1) {
          j = n - 1;
          break;
        }
        if (sql[j + 1] === comilla) j += 2;
        else break;
      }
      i = j + 1;
    } else if (c === 36 /* $ */) {
      RE_DOLAR.lastIndex = i;
      const m = RE_DOLAR.exec(sql);
      if (m) {
        const fin = sql.indexOf(m[0], i + m[0].length);
        i = fin === -1 ? n : fin + m[0].length;
      } else {
        i++;
      }
    } else if (c === 59 /* ; */) {
      volcar(i);
      cerrar();
      i++;
      desde = i;
    } else {
      i++;
    }
  }
  volcar(n);
  cerrar();
  return sentencias;
}

// Identificador: sin comillas, o entre comillas dobles (con "" como comilla escapada).
const ID = String.raw`(?:"(?:[^"]|""){1,128}"|[A-Za-z_][A-Za-z0-9_$]{0,127})`;
const NOMBRE = String.raw`(?:(${ID})\s*\.\s*)?(${ID})`;
const sinComillas = (s) => (s?.startsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s?.toLowerCase());
const completo = (esquema, nombre) => `${sinComillas(esquema) ?? 'public'}.${sinComillas(nombre)}`;

/** Devuelve el texto entre el paréntesis que abre en `desde` y su pareja. */
function entreParentesis(texto, desde) {
  let nivel = 0;
  let enCadena = null;
  for (let i = desde; i < texto.length; i++) {
    const c = texto[i];
    if (enCadena) {
      if (c === enCadena) enCadena = null;
      continue;
    }
    if (c === "'" || c === '"') enCadena = c;
    else if (c === '(') nivel++;
    else if (c === ')') {
      nivel--;
      if (nivel === 0) return { dentro: texto.slice(desde + 1, i), fin: i + 1 };
    }
  }
  return null;
}

/** Parte por un separador (coma, o una palabra como "or"/"and") solo en el nivel exterior. */
function partirExterior(texto, separador) {
  const partes = [];
  const esComa = separador === ',';
  const palabra = esComa ? null : separador.toLowerCase();
  const bajo = esComa ? null : texto.toLowerCase();
  let nivel = 0;
  let enCadena = null;
  let inicio = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enCadena) {
      if (c === enCadena) enCadena = null;
      continue;
    }
    if (c === "'" || c === '"') enCadena = c;
    else if (c === '(') nivel++;
    else if (c === ')') nivel--;
    else if (nivel === 0) {
      if (esComa && c === ',') {
        partes.push(texto.slice(inicio, i).trim());
        inicio = i + 1;
      } else if (palabra && /\s/.test(c) && bajo.startsWith(palabra, i + 1) && /\s/.test(texto[i + 1 + palabra.length] ?? '')) {
        partes.push(texto.slice(inicio, i).trim());
        inicio = i + 1 + palabra.length;
        i = inicio - 1;
      }
    }
  }
  partes.push(texto.slice(inicio).trim());
  return partes.filter((p) => p !== '');
}
const partirPorComas = (texto) => partirExterior(texto, ',');

function clausula(resto, palabra) {
  const m = resto.match(rx(String.raw`\b${palabra}\s{0,20}\(`, 'i'));
  if (!m) return null;
  const r = entreParentesis(resto, m.index + m[0].length - 1);
  return r ? r.dentro.replace(/\s+/g, ' ').trim() : null;
}

/** Quita los cuerpos $tag$…$tag$ (recorrido lineal). */
function sinCuerpos(s) {
  let salida = '';
  let i = 0;
  for (;;) {
    const d = s.indexOf('$', i);
    if (d === -1) return salida + s.slice(i);
    RE_DOLAR.lastIndex = d;
    const m = RE_DOLAR.exec(s);
    if (!m) {
      salida += s.slice(i, d + 1);
      i = d + 1;
      continue;
    }
    const fin = s.indexOf(m[0], d + m[0].length);
    salida += `${s.slice(i, d)} `;
    if (fin === -1) return salida;
    i = fin + m[0].length;
  }
}

/** Estado vacío del modelo. */
export function modeloVacio() {
  return { tablas: new Map(), vistas: new Map(), funciones: [], buckets: [], omitidas: 0 };
}

function tabla(modelo, nombre, archivo) {
  if (!modelo.tablas.has(nombre)) {
    modelo.tablas.set(nombre, {
      nombre,
      archivo,
      columnas: [],
      rls: false,
      rlsVisto: false, // ¿alguna migración menciona RLS para esta tabla?
      rlsDesactivado: null,
      politicas: [],
      updateRevocado: false, // se revocó UPDATE a authenticated/public
      updateColumnas: null, // columnas con UPDATE concedido expresamente
      disparadoresUpdate: [],
      declarada: false,
    });
  }
  return modelo.tablas.get(nombre);
}

const nombreDePolitica = (id) => (id.startsWith('"') ? id.slice(1, -1).replace(/""/g, '"') : id);
const rolesDe = (texto) => texto.split(',').map((r) => r.trim().replace(/"/g, '').toLowerCase()).filter(Boolean);

/**
 * Aplica un archivo de migración al modelo.
 * @param {ReturnType<typeof modeloVacio>} modelo
 */
export function aplicarMigracion(modelo, sql, archivo) {
  for (const cruda of dividirSentencias(sql)) {
    if (cruda.length > MAX_SENTENCIA) {
      modelo.omitidas++;
      continue;
    }
    if (!RE_INTERESA.test(cruda)) continue;
    const s = cruda.replace(/\s+/g, ' ').trim();
    let m;

    if ((m = s.match(rx(String.raw`^create\s+(?:(?:global\s+|local\s+)?(?:temp|temporary)\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${NOMBRE}\s*(.*)$`, 'i')))) {
      if (/^create\s+(?:global\s+|local\s+)?temp/i.test(s)) continue; // las temporales no se exponen
      const t = tabla(modelo, completo(m[1], m[2]), archivo);
      t.declarada = true;
      t.archivo = archivo;
      // Tres formas: "(columnas…)", "partition of padre …" y "as select …".
      if (m[3].startsWith('(')) {
        const cuerpo = entreParentesis(m[3], 0);
        if (cuerpo) {
          for (const parte of partirPorComas(cuerpo.dentro)) {
            const col = parte.match(rx(`^(${ID})`));
            if (col && !/^(constraint|primary|foreign|unique|check|exclude|like)$/i.test(col[1])) t.columnas.push(sinComillas(col[1]));
          }
        }
      }
    } else if ((m = s.match(rx(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${NOMBRE}\s+(.*)$`, 'i')))) {
      const t = tabla(modelo, completo(m[1], m[2]), archivo);
      // Un ALTER TABLE puede llevar varias acciones separadas por comas: se aplican en orden.
      for (const accion of partirPorComas(m[3])) {
        if (/^enable\s+row\s+level\s+security/i.test(accion)) {
          t.rls = true;
          t.rlsVisto = true;
          t.rlsDesactivado = null;
        } else if (/^disable\s+row\s+level\s+security/i.test(accion)) {
          t.rls = false;
          t.rlsVisto = true;
          t.rlsDesactivado = archivo;
        } else {
          // (FORCE ROW LEVEL SECURITY no activa RLS por sí solo: no cambia el estado.)
          const col = accion.match(rx(String.raw`^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(${ID})`, 'i'));
          if (col && !/^(constraint|primary|foreign|unique|check)$/i.test(col[1])) t.columnas.push(sinComillas(col[1]));
        }
      }
    } else if ((m = s.match(/^drop\s+table\s+(?:if\s+exists\s+)?(.+?)(?:\s+(?:cascade|restrict))?$/i))) {
      for (const parte of partirPorComas(m[1])) {
        const q = parte.match(rx(`^${NOMBRE}$`));
        if (q) modelo.tablas.delete(completo(q[1], q[2]));
      }
    } else if ((m = s.match(rx(String.raw`^create\s+policy\s+(${ID})\s+on\s+${NOMBRE}\s*(.*)$`, 'i')))) {
      const t = tabla(modelo, completo(m[2], m[3]), archivo);
      const resto = m[4];
      // AS / FOR / TO solo se buscan antes de las condiciones, para no confundirlos con su contenido.
      const cabecera = resto.split(/\busing\s*\(|\bwith\s+check\s*\(/i)[0];
      const roles = cabecera.match(/\bto\s+(.+?)\s*$/i);
      const nombre = nombreDePolitica(m[1]);
      t.politicas = t.politicas.filter((p) => p.nombre !== nombre);
      t.politicas.push({
        nombre,
        archivo,
        restrictiva: /\bas\s+restrictive\b/i.test(cabecera),
        comando: (cabecera.match(/\bfor\s+(all|select|insert|update|delete)\b/i)?.[1] ?? 'all').toLowerCase(),
        roles: roles ? rolesDe(roles[1]) : ['public'],
        using: clausula(resto, 'using'),
        check: clausula(resto, String.raw`with\s+check`),
      });
    } else if ((m = s.match(rx(String.raw`^alter\s+policy\s+(${ID})\s+on\s+${NOMBRE}\s*(.*)$`, 'i')))) {
      const t = tabla(modelo, completo(m[2], m[3]), archivo);
      const p = t.politicas.find((x) => x.nombre === nombreDePolitica(m[1]));
      if (p) {
        const cabecera = m[4].split(/\busing\s*\(|\bwith\s+check\s*\(/i)[0];
        const renombrada = cabecera.match(rx(String.raw`^rename\s+to\s+(${ID})`, 'i'));
        const roles = renombrada ? null : cabecera.match(/\bto\s+(.+?)\s*$/i);
        const u = clausula(m[4], 'using');
        const c = clausula(m[4], String.raw`with\s+check`);
        if (renombrada) p.nombre = nombreDePolitica(renombrada[1]);
        if (roles) p.roles = rolesDe(roles[1]);
        if (u) p.using = u;
        if (c) p.check = c;
        p.archivo = archivo;
      }
    } else if ((m = s.match(rx(String.raw`^drop\s+policy\s+(?:if\s+exists\s+)?(${ID})\s+on\s+${NOMBRE}`, 'i')))) {
      const t = modelo.tablas.get(completo(m[2], m[3]));
      if (t) t.politicas = t.politicas.filter((p) => p.nombre !== nombreDePolitica(m[1]));
    } else if ((m = s.match(rx(String.raw`^create\s+(?:or\s+replace\s+)?(materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?${NOMBRE}\s*(.*)$`, 'i')))) {
      const antesDeAs = m[4].split(/\bas\b/i)[0];
      modelo.vistas.set(completo(m[2], m[3]), {
        nombre: completo(m[2], m[3]),
        archivo,
        materializada: Boolean(m[1]),
        invoker: !m[1] && /security_invoker\s*=\s*(on|true|1|'on'|'true')/i.test(antesDeAs),
      });
    } else if ((m = s.match(rx(String.raw`^alter\s+view\s+(?:if\s+exists\s+)?${NOMBRE}\s+set\s*\(([^)]{0,500})\)`, 'i')))) {
      const v = modelo.vistas.get(completo(m[1], m[2]));
      if (v && !v.materializada && /security_invoker\s*=\s*(on|true|1|'on'|'true')/i.test(m[3])) v.invoker = true;
    } else if ((m = s.match(rx(String.raw`^drop\s+(?:materialized\s+)?view\s+(?:if\s+exists\s+)?${NOMBRE}`, 'i')))) {
      modelo.vistas.delete(completo(m[1], m[2]));
    } else if ((m = s.match(rx(String.raw`^create\s+(?:or\s+replace\s+)?function\s+${NOMBRE}\s*\(`, 'i')))) {
      // Las cláusulas pueden ir antes o después del cuerpo; se excluye el cuerpo $$...$$.
      const fuera = sinCuerpos(s);
      const nombre = completo(m[1], m[2]);
      modelo.funciones = modelo.funciones.filter((f) => f.nombre !== nombre);
      modelo.funciones.push({ nombre, archivo, definer: /\bsecurity\s+definer\b/i.test(fuera), searchPath: /\bset\s+search_path\b/i.test(fuera) });
    } else if ((m = s.match(/^insert\s+into\s+storage\.buckets\s*\(([^)]{0,500})\)\s*values\s*(.*)$/i))) {
      const cols = m[1].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase());
      const iPublico = cols.indexOf('public');
      const iId = cols.indexOf('id');
      let resto = m[2];
      let pos;
      let vueltas = 0;
      while ((pos = resto.indexOf('(')) !== -1 && vueltas++ < 200) {
        const tupla = entreParentesis(resto, pos);
        if (!tupla) break;
        const valores = partirPorComas(tupla.dentro);
        const id = (valores[iId >= 0 ? iId : 0] ?? '').replace(/^'|'$/g, '');
        if (id) modelo.buckets.push({ id, archivo, publico: iPublico >= 0 && /^true$/i.test(valores[iPublico] ?? '') });
        resto = resto.slice(tupla.fin);
      }
    } else if (/^update\s+storage\.buckets\s+set\s/i.test(s)) {
      const publico = s.match(/\bpublic\s*=\s*(true|false)\b/i);
      const donde = s.match(/\bwhere\s+(?:id|name)\s*=\s*'([^']{1,200})'/i);
      const b = publico && donde && modelo.buckets.find((x) => x.id === donde[1]);
      if (b) b.publico = publico[1].toLowerCase() === 'true';
    } else if ((m = s.match(rx(String.raw`^(grant|revoke)\s+(.{1,2000}?)\s+on\s+(?:table\s+)?${NOMBRE}\s+(?:to|from)\s+(.+)$`, 'i')))) {
      const t = modelo.tablas.get(completo(m[3], m[4]));
      const privilegios = m[2];
      const afectaAUsuarios = /\b(authenticated|public)\b/i.test(m[5]);
      if (t && afectaAUsuarios && /\b(update|all)\b/i.test(privilegios)) {
        const columnas = privilegios.match(/\bupdate\s*\(([^)]{1,1000})\)/i);
        if (/^revoke/i.test(m[1]) && !columnas) {
          // Se retira UPDATE sobre toda la tabla a los usuarios registrados.
          t.updateRevocado = true;
          t.updateColumnas = [];
        } else if (/^grant/i.test(m[1]) && columnas) {
          t.updateColumnas = [...(t.updateColumnas ?? []), ...columnas[1].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase())];
        } else if (/^grant/i.test(m[1])) {
          // GRANT UPDATE/ALL sobre la tabla entera: vuelve a estar abierta.
          t.updateRevocado = false;
          t.updateColumnas = null;
        }
      }
    } else if (/^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s/i.test(s)) {
      const cab = s.slice(0, 600);
      // Una sola clase de caracteres (sin alternativas solapadas) para que no haya retroceso.
      m = cab.match(rx(String.raw`trigger\s+(${ID})\s+before\s+([A-Za-z0-9_", ]{1,300}?)\s+on\s+${NOMBRE}`, 'i'));
      if (m && /\bupdate\b/i.test(m[2])) {
        const t = modelo.tablas.get(completo(m[3], m[4]));
        const funcion = s.match(rx(String.raw`execute\s+(?:function|procedure)\s+${NOMBRE}`, 'i'));
        if (t) t.disparadoresUpdate.push({ nombre: sinComillas(m[1]), funcion: funcion ? sinComillas(funcion[2]) : '' });
      }
    }
  }
  return modelo;
}

// ───────────── Evaluación de expresiones de política ─────────────

/** Normaliza una expresión: minúsculas, sin espacios, sin conversiones de tipo ni paréntesis superfluos. */
export function normalizar(expr) {
  if (expr == null) return null;
  if (expr.length > MAX_EXPRESION) return expr.toLowerCase();
  let e = expr.toLowerCase().replace(/\s+/g, '');
  let previa;
  let vueltas = 0;
  do {
    previa = e;
    e = e
      .replace(/::[a-z_]+(\[\])?/g, '') // (true)::boolean → (true)
      .replace(/\(select([^()]*(?:\(\))?[^()]*)\)/g, '$1') // (select auth.uid()) → auth.uid()
      .replace(/\(([a-z_.]+\(\)(?:->>?'[a-z_]+')?)\)/g, '$1') // (auth.jwt()->>'role') → auth.jwt()->>'role'
      .replace(/\((true|false|null|'[^']*'|\d+)\)/g, '$1'); // (true) → true
    while (e.startsWith('(') && entreParentesis(e, 0)?.fin === e.length) e = e.slice(1, -1);
  } while (e !== previa && vueltas++ < 50);
  return e;
}

const CIERTAS = new Set(['true', '1=1', 'true=true', "'a'='a'", 'nottrue=false', 'notfalse', '1<>0', '1!=0', '0=0', 'trueisnotfalse', 'trueistrue']);
const FALSAS = new Set(['false', '1=0', 'nottrue', '0=1', 'null']);
const SOLO_SESION = new Set([
  'auth.uid()isnotnull',
  "auth.role()='authenticated'",
  "'authenticated'=auth.role()",
  "auth.role()in('authenticated')",
  'auth.jwt()isnotnull',
  "auth.jwt()->>'role'='authenticated'",
  "auth.jwt()->>'sub'isnotnull",
  "auth.jwt()->'sub'isnotnull",
  'auth.email()isnotnull',
  "auth.jwt()->>'email'isnotnull",
  "current_setting('request.jwt.claims',true)isnotnull",
]);

/**
 * Clasifica una condición de política:
 *   'cierta'  → deja pasar a cualquiera a quien aplique la política;
 *   'sesion'  → solo exige haber iniciado sesión;
 *   'falsa'   → no deja pasar a nadie;
 *   'otra'    → cualquier otra cosa (se supone que restringe; no se analiza más).
 * Entiende combinaciones con OR y AND de esas mismas piezas.
 */
export function clasificarCondicion(expr, profundidad = 0) {
  if (expr == null) return 'cierta'; // en PostgreSQL, sin condición equivale a "true"
  if (expr.length > MAX_EXPRESION || profundidad > 8) return 'otra';
  const n = normalizar(expr);
  if (CIERTAS.has(n)) return 'cierta';
  if (FALSAS.has(n)) return 'falsa';
  if (SOLO_SESION.has(n)) return 'sesion';
  // Se parte por OR / AND en el nivel exterior, quitando antes los paréntesis que lo envuelven todo.
  let texto = expr.trim();
  while (texto.startsWith('(') && entreParentesis(texto, 0)?.fin === texto.length) texto = texto.slice(1, -1).trim();
  const disyuntos = partirExterior(texto, 'or');
  if (disyuntos.length > 1) {
    const clases = disyuntos.map((d) => clasificarCondicion(d, profundidad + 1));
    if (clases.includes('cierta')) return 'cierta';
    if (clases.includes('sesion') && clases.every((c) => c === 'sesion' || c === 'falsa')) return 'sesion';
    if (clases.every((c) => c === 'falsa')) return 'falsa';
    return clases.includes('sesion') ? 'sesion-o-mas' : 'otra';
  }
  const conjuntos = partirExterior(texto, 'and');
  if (conjuntos.length > 1) {
    const clases = conjuntos.map((d) => clasificarCondicion(d, profundidad + 1));
    if (clases.includes('falsa')) return 'falsa';
    if (clases.every((c) => c === 'cierta')) return 'cierta';
    if (clases.every((c) => c === 'cierta' || c === 'sesion')) return 'sesion';
    return 'otra';
  }
  return 'otra';
}

export const esSiempreCierta = (expr) => expr != null && clasificarCondicion(expr) === 'cierta';
// "X or auth.uid() is not null": cualquier usuario registrado pasa, aunque haya otra rama.
export const soloExigeSesion = (expr) => expr != null && ['sesion', 'sesion-o-mas'].includes(clasificarCondicion(expr));

export const usaMetadatosDeUsuario = (expr) => /user_metadata|raw_user_meta_data/i.test(expr ?? '');
