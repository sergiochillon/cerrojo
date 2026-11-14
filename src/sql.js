// Lectura tolerante de migraciones SQL de Supabase para reconstruir el estado de RLS:
// qué tablas existen, cuáles tienen RLS y qué permite cada política.
//
// No es un analizador completo de PostgreSQL: reconoce las sentencias que afectan a la
// autorización y deja pasar el resto. Lo que no entiende no lo inventa.

/** Divide un script en sentencias respetando cadenas, comentarios y bloques $$...$$. */
export function dividirSentencias(sql) {
  const sentencias = [];
  let actual = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const dos = sql.slice(i, i + 2);
    if (dos === '--') {
      const fin = sql.indexOf('\n', i);
      i = fin === -1 ? n : fin;
      actual += ' ';
    } else if (dos === '/*') {
      const fin = sql.indexOf('*/', i + 2);
      i = fin === -1 ? n : fin + 2;
      actual += ' ';
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j++;
      }
      actual += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '$') {
      const m = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        const fin = sql.indexOf(m[0], i + m[0].length);
        const hasta = fin === -1 ? n : fin + m[0].length;
        actual += sql.slice(i, hasta);
        i = hasta;
      } else {
        actual += c;
        i++;
      }
    } else if (c === ';') {
      if (actual.trim()) sentencias.push(actual.trim());
      actual = '';
      i++;
    } else {
      actual += c;
      i++;
    }
  }
  if (actual.trim()) sentencias.push(actual.trim());
  return sentencias;
}

const ID = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const NOMBRE = String.raw`(?:(${ID})\s*\.\s*)?(${ID})`;
const sinComillas = (s) => (s?.startsWith('"') ? s.slice(1, -1) : s?.toLowerCase());
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

function partirPorComas(texto) {
  const partes = [];
  let nivel = 0;
  let enCadena = null;
  let actual = '';
  for (const c of texto) {
    if (enCadena) {
      actual += c;
      if (c === enCadena) enCadena = null;
      continue;
    }
    if (c === "'" || c === '"') enCadena = c;
    if (c === '(') nivel++;
    if (c === ')') nivel--;
    if (c === ',' && nivel === 0) {
      partes.push(actual.trim());
      actual = '';
    } else actual += c;
  }
  if (actual.trim()) partes.push(actual.trim());
  return partes;
}

function clausula(resto, palabra) {
  const m = resto.match(new RegExp(String.raw`\b${palabra}\s*\(`, 'i'));
  if (!m) return null;
  const r = entreParentesis(resto, m.index + m[0].length - 1);
  return r ? r.dentro.replace(/\s+/g, ' ').trim() : null;
}

/** Estado vacío del modelo. */
export function modeloVacio() {
  return { tablas: new Map(), vistas: new Map(), funciones: [], buckets: [] };
}

function tabla(modelo, nombre, archivo) {
  if (!modelo.tablas.has(nombre)) {
    modelo.tablas.set(nombre, { nombre, archivo, columnas: [], rls: false, rlsDesactivado: null, politicas: [], restriccionColumnas: false, disparadorUpdate: false, declarada: false });
  }
  return modelo.tablas.get(nombre);
}

/**
 * Aplica un archivo de migración al modelo.
 * @param {ReturnType<typeof modeloVacio>} modelo
 */
export function aplicarMigracion(modelo, sql, archivo) {
  for (const cruda of dividirSentencias(sql)) {
    const s = cruda.replace(/\s+/g, ' ').trim();
    let m;

    if ((m = s.match(new RegExp(String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?${NOMBRE}\s*\(`, 'i')))) {
      const t = tabla(modelo, completo(m[1], m[2]), archivo);
      t.declarada = true;
      t.archivo = archivo;
      const cuerpo = entreParentesis(s, m[0].length - 1);
      if (cuerpo) {
        for (const parte of partirPorComas(cuerpo.dentro)) {
          const col = parte.match(new RegExp(`^(${ID})`));
          if (col && !/^(constraint|primary|foreign|unique|check|exclude|like)$/i.test(col[1])) t.columnas.push(sinComillas(col[1]));
        }
      }
    } else if ((m = s.match(new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${NOMBRE}\s+(.*)$`, 'i')))) {
      const t = tabla(modelo, completo(m[1], m[2]), archivo);
      const accion = m[3];
      if (/\b(enable|force)\s+row\s+level\s+security/i.test(accion)) {
        t.rls = true;
        t.rlsDesactivado = null;
      }
      if (/\bdisable\s+row\s+level\s+security/i.test(accion)) {
        t.rls = false;
        t.rlsDesactivado = archivo;
      }
      for (const a of accion.matchAll(new RegExp(String.raw`\badd\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(${ID})`, 'gi'))) {
        if (!/^(constraint|primary|foreign|unique|check)$/i.test(a[1])) t.columnas.push(sinComillas(a[1]));
      }
    } else if ((m = s.match(new RegExp(String.raw`^drop\s+table\s+(?:if\s+exists\s+)?(.+?)(?:\s+(?:cascade|restrict))?$`, 'i')))) {
      for (const parte of partirPorComas(m[1])) {
        const q = parte.match(new RegExp(`^${NOMBRE}$`));
        if (q) modelo.tablas.delete(completo(q[1], q[2]));
      }
    } else if ((m = s.match(new RegExp(String.raw`^create\s+policy\s+(${ID})\s+on\s+${NOMBRE}\s*(.*)$`, 'i')))) {
      const t = tabla(modelo, completo(m[2], m[3]), archivo);
      const resto = m[4];
      // AS / FOR / TO solo se buscan antes de las condiciones, para no confundirlos con su contenido.
      const cabecera = resto.split(/\busing\s*\(|\bwith\s+check\s*\(/i)[0];
      const roles = cabecera.match(/\bto\s+(.+?)\s*$/i);
      const nombre = m[1].startsWith('"') ? m[1].slice(1, -1) : m[1];
      t.politicas = t.politicas.filter((p) => p.nombre !== nombre);
      t.politicas.push({
        nombre,
        archivo,
        restrictiva: /\bas\s+restrictive\b/i.test(cabecera),
        comando: (cabecera.match(/\bfor\s+(all|select|insert|update|delete)\b/i)?.[1] ?? 'all').toLowerCase(),
        roles: roles ? roles[1].split(',').map((r) => r.trim().replace(/"/g, '').toLowerCase()).filter(Boolean) : ['public'],
        using: clausula(resto, 'using'),
        check: clausula(resto, String.raw`with\s+check`),
      });
    } else if ((m = s.match(new RegExp(String.raw`^alter\s+policy\s+(${ID})\s+on\s+${NOMBRE}\s*(.*)$`, 'i')))) {
      const t = tabla(modelo, completo(m[2], m[3]), archivo);
      const nombre = m[1].startsWith('"') ? m[1].slice(1, -1) : m[1];
      const p = t.politicas.find((x) => x.nombre === nombre);
      if (p) {
        const u = clausula(m[4], 'using');
        const c = clausula(m[4], String.raw`with\s+check`);
        if (u) p.using = u;
        if (c) p.check = c;
        p.archivo = archivo;
      }
    } else if ((m = s.match(new RegExp(String.raw`^drop\s+policy\s+(?:if\s+exists\s+)?(${ID})\s+on\s+${NOMBRE}`, 'i')))) {
      const t = modelo.tablas.get(completo(m[2], m[3]));
      const nombre = m[1].startsWith('"') ? m[1].slice(1, -1) : m[1];
      if (t) t.politicas = t.politicas.filter((p) => p.nombre !== nombre);
    } else if ((m = s.match(new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?view\s+${NOMBRE}\s*(.*)$`, 'i')))) {
      modelo.vistas.set(completo(m[1], m[2]), { nombre: completo(m[1], m[2]), archivo, invoker: /security_invoker\s*=\s*(on|true|1|'on'|'true')/i.test(m[3].split(/\bas\b/i)[0]) });
    } else if ((m = s.match(new RegExp(String.raw`^alter\s+view\s+(?:if\s+exists\s+)?${NOMBRE}\s+set\s*\(([^)]*)\)`, 'i')))) {
      const v = modelo.vistas.get(completo(m[1], m[2]));
      if (v && /security_invoker\s*=\s*(on|true|1|'on'|'true')/i.test(m[3])) v.invoker = true;
    } else if ((m = s.match(new RegExp(String.raw`^drop\s+view\s+(?:if\s+exists\s+)?${NOMBRE}`, 'i')))) {
      modelo.vistas.delete(completo(m[1], m[2]));
    } else if ((m = s.match(new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?function\s+${NOMBRE}\s*\(`, 'i')))) {
      // Las cláusulas pueden ir antes o después del cuerpo; se excluye el cuerpo $$...$$.
      const sinCuerpo = s.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, ' ');
      const nombre = completo(m[1], m[2]);
      modelo.funciones = modelo.funciones.filter((f) => f.nombre !== nombre);
      modelo.funciones.push({ nombre, archivo, definer: /\bsecurity\s+definer\b/i.test(sinCuerpo), searchPath: /\bset\s+search_path\b/i.test(sinCuerpo) });
    } else if ((m = s.match(/^insert\s+into\s+storage\.buckets\s*\(([^)]*)\)\s*values\s*(.*)$/i))) {
      const cols = m[1].split(',').map((c) => c.trim().replace(/"/g, '').toLowerCase());
      const iPublico = cols.indexOf('public');
      const iId = cols.indexOf('id');
      let resto = m[2];
      let pos;
      while ((pos = resto.indexOf('(')) !== -1) {
        const tupla = entreParentesis(resto, pos);
        if (!tupla) break;
        const valores = partirPorComas(tupla.dentro);
        const id = (valores[iId >= 0 ? iId : 0] ?? '').replace(/^'|'$/g, '');
        if (id) modelo.buckets.push({ id, archivo, publico: iPublico >= 0 && /^true$/i.test(valores[iPublico] ?? '') });
        resto = resto.slice(tupla.fin);
      }
    } else if ((m = s.match(/^update\s+storage\.buckets\s+set\s+(.*?)\bpublic\s*=\s*(true|false)\b.*?\bwhere\s+(?:id|name)\s*=\s*'([^']+)'/i))) {
      const b = modelo.buckets.find((x) => x.id === m[3]);
      if (b) b.publico = m[2].toLowerCase() === 'true';
    } else if ((m = s.match(new RegExp(String.raw`^(?:grant|revoke)\s+(.+?)\s+on\s+(?:table\s+)?${NOMBRE}\s+(?:to|from)\s+(.+)$`, 'i')))) {
      const t = modelo.tablas.get(completo(m[2], m[3]));
      const privilegios = m[1];
      if (t && /\bupdate\b/i.test(privilegios) && /\b(authenticated|public|anon)\b/i.test(m[4])) {
        if (/^revoke/i.test(s) || /\bupdate\s*\(/i.test(privilegios)) t.restriccionColumnas = true;
      }
    } else if ((m = s.match(new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+${ID}\s+before\s+[a-z\s]*\bupdate\b.*?\bon\s+${NOMBRE}`, 'i')))) {
      const t = modelo.tablas.get(completo(m[1], m[2]));
      if (t) t.disparadorUpdate = true;
    }
  }
  return modelo;
}

// ───────────── Evaluación de expresiones de política ─────────────

/** Normaliza una expresión: minúsculas, sin espacios, sin (select x) ni paréntesis exteriores. */
export function normalizar(expr) {
  if (expr == null) return null;
  let e = expr.toLowerCase().replace(/\s+/g, '');
  let previa;
  do {
    previa = e;
    e = e.replace(/\(select([a-z_.]+\(\))\)/g, '$1');
    while (e.startsWith('(') && entreParentesis(e, 0)?.fin === e.length) e = e.slice(1, -1);
  } while (e !== previa);
  return e;
}

export const esSiempreCierta = (expr) => ['true', '1=1', 'true=true', "'a'='a'"].includes(normalizar(expr));

const SOLO_AUTENTICADO = new Set([
  'auth.uid()isnotnull',
  "auth.role()='authenticated'",
  "'authenticated'=auth.role()",
  'auth.jwt()isnotnull',
  "auth.jwt()->>'role'='authenticated'",
  "(auth.jwt()->>'role')='authenticated'",
]);
export const soloExigeSesion = (expr) => SOLO_AUTENTICADO.has(normalizar(expr));

export const usaMetadatosDeUsuario = (expr) => /user_metadata|raw_user_meta_data/i.test(expr ?? '');
