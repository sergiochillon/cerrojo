// Utilidades compartidas: JWT, enmascarado de secretos, clasificación de datos sensibles.

/** Decodifica (sin verificar la firma) un JWT. Devuelve null si no lo es. */
export function decodificarJwt(token) {
  if (typeof token !== 'string' || token.length > 8192) return null;
  try {
    const partes = token.split('.');
    // Buffer.from ignora en silencio los caracteres que no son base64url: se exige el formato.
    if (partes.length !== 3 || !partes.slice(0, 2).every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
    const leer = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    const cabecera = leer(partes[0]);
    const carga = leer(partes[1]);
    const esObjeto = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    return esObjeto(cabecera) && esObjeto(carga) ? { cabecera, carga } : null;
  } catch {
    return null;
  }
}

/**
 * ¿Es una clave que NO debe usarse desde fuera? (sb_secret_…, o un JWT cuyo rol no es "anon":
 * service_role, supabase_admin…). Estas claves se saltan RLS: con ellas todo parecería una
 * fuga, y no hay ningún motivo para dárselas a esta herramienta.
 */
export function esClaveSecreta(clave) {
  if (typeof clave !== 'string') return false;
  const s = clave;
  if (s.startsWith('sb_secret_')) return true;
  const rol = decodificarJwt(s)?.carga?.role;
  return Boolean(rol) && rol !== 'anon';
}

export const AVISO_CLAVE_SECRETA =
  'La clave indicada es SECRETA (sb_secret_… o un JWT con rol distinto de "anon"). cerrojo solo trabaja con la clave pública. No se ha hecho ninguna petición. Si esa clave ha quedado en un archivo o en el historial de la terminal, revócala en el panel de Supabase.';

/** Enmascara un secreto para poder citarlo en un informe sin revelarlo. */
export function enmascarar(valor) {
  if (typeof valor !== 'string') return '';
  const s = valor;
  if (s.length <= 12) return '•'.repeat(s.length);
  return `${s.slice(0, 6)}…${s.slice(-4)} (${s.length} caracteres)`;
}

/** Niveles de gravedad, de mayor a menor. */
export const GRAVEDADES = ['critica', 'alta', 'media', 'baja', 'info'];
export const pesoGravedad = (g) => GRAVEDADES.indexOf(g);

// Patrones de nombres de columna/tabla que sugieren datos sensibles.
// Son heurísticas: sirven para priorizar, no para afirmar qué contiene una tabla.
const CATEGORIAS = [
  // "token" solo cuenta como credencial cuando es un token de acceso, no un recuento (max_tokens).
  { id: 'credenciales', re: /(pass(word)?|contrase|secret|api_?key|private_?key|otp|recovery|(access|refresh|auth|session|reset|bearer|api|id)_?token|(^|_)token$|(^|_)tokens$(?<!(max|num|total|used|input|output|prompt|completion)_tokens)|token_hash|(^|_)hash$)/i },
  { id: 'pago', re: /(iban|card_|_card|tarjeta|cvv|billing|payment|pago|invoice|factura|salary|salario|balance|saldo|stripe_(customer|secret|account))/i },
  { id: 'salud', re: /(health|salud|medical|medic|diagnos|patient|paciente|allerg|alerg|treatment|tratamiento)/i },
  { id: 'identidad', re: /(dni|(^|_)nif|(^|_)nie($|_)|passport|pasaporte|ssn|national_?id|birth|nacimiento)/i },
  { id: 'contacto', re: /(e?mail|correo|phone|telefono|tel[eé]fono|mobile|movil|address|direccion|street|calle|postal|zip)/i },
  { id: 'personal', re: /(first_?name|last_?name|full_?name|nombre|apellido|avatar|gender|genero|location|ubicacion|lat(itude)?$|lng$|lon(gitude)?$|ip(_address)?$)/i },
  { id: 'privado', re: /(message|mensaje|chat|note|nota|document|private|privad)/i },
];

/** Devuelve las categorías sensibles que sugieren los nombres dados. */
export function categoriasSensibles(nombres) {
  const encontradas = new Set();
  for (const n of nombres) {
    for (const c of CATEGORIAS) if (c.re.test(n)) encontradas.add(c.id);
  }
  return [...encontradas];
}

/** Gravedad orientativa de una exposición de lectura según las categorías detectadas. */
export function gravedadPorCategorias(cats) {
  if (cats.includes('credenciales')) return 'critica';
  if (cats.some((c) => ['pago', 'salud', 'identidad', 'contacto'].includes(c))) return 'alta';
  if (cats.length) return 'alta';
  return 'media';
}

// Columnas cuyo cambio por parte del propio usuario supone escalar privilegios.
export const RE_COLUMNA_PRIVILEGIO =
  /^(role|rol|roles|is_?admin|admin|is_?staff|is_?superuser|plan|tier|subscription(_.*)?|credits?|creditos|balance|saldo|quota|is_?premium|premium|verified|is_?verified|permissions?)$/i;

// Nombres habituales de la columna que apunta al dueño de una fila.
export const RE_COLUMNA_DUENO = /^(user_?id|owner(_?id)?|author(_?id)?|created_?by|profile_?id|account_?id|uid|usuario_?id|propietario(_?id)?)$/i;

export const esUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Nombre de tabla seguro para usarlo en una URL de PostgREST. */
export const esIdentificador = (s) => /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(s);

/**
 * Quita los caracteres de control de un texto que va a la terminal. Nombres de tabla, de
 * archivo o mensajes de error los controla un tercero y podrían llevar secuencias de escape
 * que borren la pantalla o falseen lo que se lee.
 */
export function sinControl(texto) {
  // eslint-disable-next-line no-control-regex
  return String(texto).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '?');
}

export function ahoraIso() {
  return new Date().toISOString();
}
