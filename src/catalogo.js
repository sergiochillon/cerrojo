// Catálogo de hallazgos. Cada comprobación produce instancias {id, gravedad, donde, datos};
// aquí vive el texto (ES/EN) que las explica y cómo se arreglan.
// Regla de redacción: decir lo que se ha observado, no lo que se supone.

const lista = (xs) => xs.join(', ');

export const CATALOGO = {
  // ───────────── Aplicación desplegada ─────────────
  'W-CLAVE-SERVICIO': {
    titulo: { es: 'Clave de servicio de Supabase publicada en el navegador', en: 'Supabase service key shipped to the browser' },
    porque: {
      es: 'La clave de servicio se salta todas las políticas RLS. Cualquiera que abra la web puede copiarla y leer, modificar o borrar toda la base de datos.',
      en: 'The service key bypasses every RLS policy. Anyone who opens the site can copy it and read, modify or delete the whole database.',
    },
    arreglo: {
      es: 'Revoca la clave ahora (Settings → API Keys) y genera otra. Úsala solo en servidor (Edge Functions), nunca en variables VITE_/NEXT_PUBLIC_. Revisa los registros de acceso por si ya se ha usado.',
      en: 'Revoke the key now (Settings → API Keys) and create a new one. Use it server-side only (Edge Functions), never in VITE_/NEXT_PUBLIC_ variables. Review access logs for prior use.',
    },
    detalle: (d, L) => (L === 'es' ? `Clave ${d.tipo} encontrada en ${d.archivo}: ${d.muestra}` : `${d.tipo} key found in ${d.archivo}: ${d.muestra}`),
  },
  'W-SECRETO-TERCERO': {
    titulo: { es: 'Secreto de un servicio externo publicado en el navegador', en: 'Third-party secret shipped to the browser' },
    porque: {
      es: 'Una clave secreta en el código del navegador es pública. Puede usarse a tu costa (consumo de API, cobros) o para acceder a datos de ese servicio.',
      en: 'A secret key in browser code is public. It can be used at your expense (API usage, charges) or to access data in that service.',
    },
    arreglo: {
      es: 'Revoca la clave en el panel del proveedor y crea otra. Mueve la llamada a una Edge Function o a tu servidor y guarda la clave como secreto de servidor.',
      en: 'Revoke the key in the provider dashboard and create a new one. Move the call to an Edge Function or your server and store the key as a server secret.',
    },
    detalle: (d, L) => (L === 'es' ? `${d.tipo} en ${d.archivo}: ${d.muestra}` : `${d.tipo} in ${d.archivo}: ${d.muestra}`),
  },
  'W-ENV-EXPUESTO': {
    titulo: { es: 'Archivo de entorno descargable desde la web', en: 'Environment file downloadable from the site' },
    porque: {
      es: 'El archivo de entorno suele contener claves. Si se sirve públicamente, todas ellas deben considerarse comprometidas.',
      en: 'Environment files usually hold keys. If served publicly, all of them must be considered compromised.',
    },
    arreglo: {
      es: 'Elimina el archivo del despliegue, bloquea las rutas que empiezan por punto y rota todas las claves que contenga.',
      en: 'Remove the file from the deployment, block dot-paths and rotate every key it contains.',
    },
    detalle: (d, L) => (L === 'es' ? `${d.ruta} responde 200 con ${d.variables} líneas tipo CLAVE=valor.` : `${d.ruta} returns 200 with ${d.variables} KEY=value lines.`),
  },
  'W-GIT-EXPUESTO': {
    titulo: { es: 'Repositorio Git accesible desde la web', en: 'Git repository reachable from the site' },
    porque: {
      es: 'Con la carpeta .git pública se puede reconstruir el código fuente y su historial, incluidos secretos borrados después.',
      en: 'A public .git folder lets anyone rebuild the source code and its history, including secrets removed later.',
    },
    arreglo: { es: 'No despliegues la carpeta .git y bloquea las rutas que empiezan por punto.', en: 'Do not deploy the .git folder and block dot-paths.' },
    detalle: (d) => `${d.ruta} → 200`,
  },
  'W-MAPAS-FUENTE': {
    titulo: { es: 'Mapas de código fuente públicos', en: 'Public source maps' },
    porque: {
      es: 'Permiten leer el código original con comentarios y nombres. No es un fallo por sí solo, pero facilita encontrar otros.',
      en: 'They expose the original code with comments and names. Not a flaw by itself, but it makes finding others easier.',
    },
    arreglo: { es: 'Desactiva los source maps en producción (en Vite: build.sourcemap = false) o no los publiques.', en: 'Disable production source maps (Vite: build.sourcemap = false) or do not publish them.' },
    detalle: (d, L) => (L === 'es' ? `${d.total} mapa(s) accesible(s), p. ej. ${d.ejemplo}` : `${d.total} reachable map(s), e.g. ${d.ejemplo}`),
  },
  'W-CABECERAS': {
    titulo: { es: 'Faltan cabeceras de seguridad HTTP', en: 'Missing HTTP security headers' },
    porque: {
      es: 'Son una segunda línea de defensa frente a XSS, clickjacking y degradación a HTTP. Su ausencia no es explotable por sí sola.',
      en: 'They are a second line of defence against XSS, clickjacking and HTTP downgrade. Their absence is not exploitable on its own.',
    },
    arreglo: {
      es: 'Añádelas en la configuración del alojamiento (Vercel/Netlify/Cloudflare): Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy y frame-ancestors.',
      en: 'Add them in your hosting config (Vercel/Netlify/Cloudflare): Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy and frame-ancestors.',
    },
    detalle: (d, L) => (L === 'es' ? `Ausentes: ${lista(d.faltan)}` : `Missing: ${lista(d.faltan)}`),
  },

  // ───────────── Supabase, sin sesión ─────────────
  'S-TABLA-LEGIBLE-ANON': {
    titulo: { es: 'Tabla legible sin iniciar sesión', en: 'Table readable without signing in' },
    porque: {
      es: 'Cualquiera con la URL y la clave pública (ambas están en la web) puede descargar estas filas. Si la tabla no es deliberadamente pública, es una fuga de datos.',
      en: 'Anyone with the URL and the public key (both are in the site) can download these rows. Unless the table is public on purpose, this is a data leak.',
    },
    arreglo: {
      es: 'Activa RLS y limita la lectura al dueño de cada fila:\nalter table public.{tabla} enable row level security;\ncreate policy "leer lo propio" on public.{tabla} for select to authenticated using ((select auth.uid()) = user_id);\nSi la tabla debe ser pública, expón solo las columnas necesarias mediante una vista.',
      en: 'Enable RLS and restrict reads to each row owner:\nalter table public.{tabla} enable row level security;\ncreate policy "read own" on public.{tabla} for select to authenticated using ((select auth.uid()) = user_id);\nIf the table must be public, expose only the needed columns through a view.',
    },
    detalle: (d, L) => {
      const cols = d.columnas?.length ? lista(d.columnas) : '—';
      const cats = d.categorias?.length ? lista(d.categorias) : L === 'es' ? 'ninguna detectada por nombre' : 'none detected by name';
      return L === 'es'
        ? `${d.filas ?? '≥1'} fila(s) visibles sin sesión. Columnas: ${cols}. Categorías sensibles por nombre de columna: ${cats}. Para comprobarlo se descargó una fila; sus valores no se han guardado.`
        : `${d.filas ?? '≥1'} row(s) visible without a session. Columns: ${cols}. Sensitive categories by column name: ${cats}. One row was downloaded to check this; its values were not stored.`;
    },
  },
  'S-ESQUEMA-PUBLICO': {
    titulo: { es: 'El esquema de la base de datos se puede consultar con la clave pública', en: 'Database schema can be queried with the public key' },
    porque: {
      es: 'Revela nombres de tablas, columnas y funciones a cualquiera. No expone datos, pero da el mapa completo a un atacante. Supabase retiró este acceso en 2026; que siga abierto sugiere una configuración antigua o autoalojada.',
      en: 'It reveals table, column and function names to anyone. It exposes no data but hands an attacker the full map. Supabase removed this access in 2026; if still open it suggests an old or self-hosted setup.',
    },
    arreglo: { es: 'Actualiza el proyecto y migra a las claves publishable/secret. En autoalojado, restringe la ruta raíz de PostgREST.', en: 'Update the project and migrate to publishable/secret keys. If self-hosted, restrict the PostgREST root path.' },
    detalle: (d, L) => (L === 'es' ? `${d.tablas} tabla(s) y ${d.funciones} función(es) listadas.` : `${d.tablas} table(s) and ${d.funciones} function(s) listed.`),
  },
  'S-BUCKET-LISTABLE': {
    titulo: { es: 'Archivos de un bucket listables sin iniciar sesión', en: 'Bucket files can be listed without signing in' },
    porque: {
      es: 'Cualquiera puede enumerar los archivos subidos (y normalmente descargarlos). Es grave si contienen documentos o imágenes privadas.',
      en: 'Anyone can enumerate uploaded files (and usually download them). Serious if they hold private documents or images.',
    },
    arreglo: {
      es: 'Crea políticas en storage.objects que limiten select a la carpeta del usuario:\ncreate policy "leer lo propio" on storage.objects for select to authenticated using (bucket_id = \'{tabla}\' and (storage.foldername(name))[1] = (select auth.uid())::text);',
      en: 'Create storage.objects policies limiting select to the user folder:\ncreate policy "read own" on storage.objects for select to authenticated using (bucket_id = \'{tabla}\' and (storage.foldername(name))[1] = (select auth.uid())::text);',
    },
    detalle: (d, L) => (L === 'es' ? `Se listaron ${d.objetos} objeto(s) sin sesión (solo se contó, no se descargó nada).` : `${d.objetos} object(s) listed without a session (counted only, nothing downloaded).`),
  },
  'S-REGISTRO-SIN-VERIFICAR': {
    titulo: { es: 'El registro no exige confirmar el correo', en: 'Sign-up does not require e-mail confirmation' },
    porque: {
      es: 'Cualquiera puede crear cuentas con correos ajenos o inventados. Combinado con políticas que solo exigen "estar autenticado", equivale a acceso público.',
      en: 'Anyone can create accounts with fake or third-party e-mails. Combined with policies that only require "being authenticated", it amounts to public access.',
    },
    arreglo: { es: 'Activa "Confirm email" en Authentication → Providers → Email.', en: 'Enable "Confirm email" under Authentication → Providers → Email.' },
    detalle: (d, L) => (L === 'es' ? 'El endpoint público de configuración indica mailer_autoconfirm = true.' : 'The public settings endpoint reports mailer_autoconfirm = true.'),
  },
  'S-CLAVE-HEREDADA': {
    titulo: { es: 'La app usa la clave anónima antigua (JWT)', en: 'The app uses the legacy anon key (JWT)' },
    porque: {
      es: 'No es un fallo de seguridad. Supabase ha anunciado la retirada de las claves anon/service_role para finales de 2026; conviene migrar antes de que dejen de funcionar.',
      en: 'Not a security flaw. Supabase announced the retirement of anon/service_role keys by end of 2026; migrate before they stop working.',
    },
    arreglo: { es: 'Crea una clave publishable (Settings → API Keys), sustitúyela en la app y desactiva las antiguas.', en: 'Create a publishable key (Settings → API Keys), swap it in the app and disable the legacy ones.' },
    detalle: () => '',
  },

  // ───────────── Aislamiento entre usuarios ─────────────
  'A-LECTURA-CRUZADA': {
    titulo: { es: 'Un usuario puede leer filas de otros usuarios', en: 'A user can read other users’ rows' },
    porque: {
      es: 'Comprobado con dos cuentas de prueba: una de ellas recibe filas que pertenecen a la otra. Cualquier usuario registrado puede ver datos ajenos. RLS puede estar "activado" y aun así permitirlo.',
      en: 'Verified with two test accounts: one receives rows that belong to the other. Any registered user can see other people’s data. RLS may be "enabled" and still allow it.',
    },
    arreglo: {
      es: 'Sustituye la política de lectura por una que compare con el dueño:\ndrop policy if exists "<política actual>" on public.{tabla};\ncreate policy "leer lo propio" on public.{tabla} for select to authenticated using ((select auth.uid()) = {columna});\nVuelve a ejecutar esta prueba después.',
      en: 'Replace the read policy with one that compares against the owner:\ndrop policy if exists "<current policy>" on public.{tabla};\ncreate policy "read own" on public.{tabla} for select to authenticated using ((select auth.uid()) = {columna});\nRe-run this test afterwards.',
    },
    detalle: (d, L) => {
      const frases = d.lecturas.map((x) =>
        L === 'es'
          ? `la cuenta ${x.quien} recibe ${x.ajenas} fila(s) que no son suyas (${x.delOtro} de la otra cuenta de prueba)`
          : `account ${x.quien} receives ${x.ajenas} row(s) it does not own (${x.delOtro} from the other test account)`,
      );
      return L === 'es'
        ? `Columna dueño: ${d.columna}. Resultado: ${frases.join('; ')}. Columnas de la tabla: ${lista(d.columnas)}. Las filas se descargaron para compararlas; sus valores no se han guardado.`
        : `Owner column: ${d.columna}. Result: ${frases.join('; ')}. Table columns: ${lista(d.columnas)}. Rows were downloaded for comparison; their values were not stored.`;
    },
  },
  'A-ESCRITURA-CRUZADA': {
    titulo: { es: 'Un usuario puede modificar filas de otros usuarios', en: 'A user can modify other users’ rows' },
    porque: {
      es: 'Comprobado en una base local desechable: una cuenta de prueba ejecutó con éxito un UPDATE sobre filas de la otra. Un usuario puede alterar o sabotear datos ajenos.',
      en: 'Verified on a disposable local database: one test account successfully ran an UPDATE on the other’s rows. A user can tamper with other people’s data.',
    },
    arreglo: {
      es: 'Limita update/delete al dueño:\ncreate policy "modificar lo propio" on public.{tabla} for update to authenticated using ((select auth.uid()) = {columna}) with check ((select auth.uid()) = {columna});',
      en: 'Restrict update/delete to the owner:\ncreate policy "modify own" on public.{tabla} for update to authenticated using ((select auth.uid()) = {columna}) with check ((select auth.uid()) = {columna});',
    },
    detalle: (d, L) => {
      const frases = d.escrituras.map((x) => (L === 'es' ? `la cuenta ${x.quien} actualizó ${x.filas} fila(s) de la otra` : `account ${x.quien} updated ${x.filas} row(s) of the other`));
      return L === 'es'
        ? `Columna dueño: ${d.columna}. Resultado: ${frases.join('; ')}. El UPDATE asignó a la columna el valor que ya tenía, pero es una escritura real: dispara triggers y puede haber cambiado columnas derivadas.`
        : `Owner column: ${d.columna}. Result: ${frases.join('; ')}. The UPDATE set the column to its existing value, but it is a real write: it fires triggers and may have changed derived columns.`;
    },
  },

  // ───────────── Migraciones SQL ─────────────
  'R-SIN-RLS': {
    titulo: { es: 'Tabla sin RLS activado', en: 'Table without RLS enabled' },
    porque: {
      es: 'Sin RLS, cualquier petición con la clave pública puede leer y escribir la tabla entera si tiene permisos de API (lo habitual en proyectos anteriores a 2026).',
      en: 'Without RLS, any request with the public key can read and write the whole table if it has API grants (the norm in pre-2026 projects).',
    },
    arreglo: {
      es: 'alter table public.{tabla} enable row level security;\nDespués crea las políticas mínimas que la app necesite (sin políticas, solo el servidor podrá acceder).',
      en: 'alter table public.{tabla} enable row level security;\nThen create the minimum policies the app needs (with none, only the server can access).',
    },
    detalle: (d, L) => (L === 'es' ? `Creada en ${d.archivo}. Columnas: ${lista(d.columnas) || '—'}.` : `Created in ${d.archivo}. Columns: ${lista(d.columnas) || '—'}.`),
  },
  'R-RLS-DESACTIVADO': {
    titulo: { es: 'RLS desactivado expresamente en una migración', en: 'RLS explicitly disabled in a migration' },
    porque: { es: 'Alguien (o el asistente de IA) desactivó RLS, a menudo "para que funcione". La tabla queda abierta.', en: 'Someone (or the AI assistant) disabled RLS, often "to make it work". The table is left open.' },
    arreglo: { es: 'alter table public.{tabla} enable row level security; y corrige la política que fallaba en lugar de quitar la protección.', en: 'alter table public.{tabla} enable row level security; and fix the failing policy instead of removing protection.' },
    detalle: (d) => `${d.archivo}`,
  },
  'R-RLS-SIN-POLITICAS': {
    titulo: { es: 'RLS activado sin ninguna política', en: 'RLS enabled with no policies' },
    porque: { es: 'Es seguro (nadie accede salvo el servidor), pero si la app lee esta tabla desde el navegador no funcionará, y la tentación es "arreglarlo" con una política abierta.', en: 'It is safe (nobody but the server gets in), but if the app reads this table from the browser it will not work, and the temptation is to "fix" it with an open policy.' },
    arreglo: { es: 'Confirma que solo se usa desde servidor. Si no, añade políticas por dueño.', en: 'Confirm it is server-only. Otherwise add owner-based policies.' },
    detalle: (d) => `${d.archivo}`,
  },
  'R-POLITICA-LECTURA-ABIERTA': {
    titulo: { es: 'Política que permite leer toda la tabla a cualquiera', en: 'Policy lets anyone read the whole table' },
    porque: { es: 'La condición es siempre verdadera y aplica también a visitantes sin sesión. Solo es correcto en tablas de contenido realmente público.', en: 'The condition is always true and also applies to visitors without a session. Only correct for genuinely public content.' },
    arreglo: {
      es: 'Si no es contenido público:\ndrop policy "{politica}" on public.{tabla};\ncreate policy "leer lo propio" on public.{tabla} for select to authenticated using ((select auth.uid()) = user_id);',
      en: 'If it is not public content:\ndrop policy "{politica}" on public.{tabla};\ncreate policy "read own" on public.{tabla} for select to authenticated using ((select auth.uid()) = user_id);',
    },
    detalle: (d, L) => (L === 'es' ? `Política "${d.politica}" (${d.comando}, roles: ${lista(d.roles)}) con condición: ${d.expresion}. ${d.archivo}` : `Policy "${d.politica}" (${d.comando}, roles: ${lista(d.roles)}) with condition: ${d.expresion}. ${d.archivo}`),
  },
  'R-POLITICA-ESCRITURA-ABIERTA': {
    titulo: { es: 'Política que permite escribir sin restricción', en: 'Policy allows unrestricted writes' },
    porque: { es: 'Con una condición siempre verdadera en insert/update/delete, quien alcance la tabla puede crear, alterar o borrar filas de cualquiera.', en: 'With an always-true condition on insert/update/delete, whoever reaches the table can create, alter or delete anyone’s rows.' },
    arreglo: {
      es: 'drop policy "{politica}" on public.{tabla};\nCrea políticas separadas por operación con using/with check ((select auth.uid()) = user_id).',
      en: 'drop policy "{politica}" on public.{tabla};\nCreate separate per-operation policies with using/with check ((select auth.uid()) = user_id).',
    },
    detalle: (d, L) => (L === 'es' ? `Política "${d.politica}" (${d.comando}, roles: ${lista(d.roles)}) con condición: ${d.expresion}. ${d.archivo}` : `Policy "${d.politica}" (${d.comando}, roles: ${lista(d.roles)}) with condition: ${d.expresion}. ${d.archivo}`),
  },
  'R-POLITICA-SOLO-AUTENTICADO': {
    titulo: { es: 'Política que solo exige estar registrado', en: 'Policy only requires being signed in' },
    porque: {
      es: 'Es el fallo más frecuente: RLS aparece como "activado" en todos los paneles, pero cualquier usuario registrado accede a las filas de todos. Registrarse suele ser gratis.',
      en: 'The most common flaw: RLS shows as "enabled" everywhere, but any registered user reaches everyone’s rows. Signing up is usually free.',
    },
    arreglo: {
      es: 'drop policy "{politica}" on public.{tabla};\ncreate policy "leer lo propio" on public.{tabla} for select to authenticated using ((select auth.uid()) = user_id);\ncreate policy "crear lo propio" on public.{tabla} for insert to authenticated with check ((select auth.uid()) = user_id);\ncreate policy "modificar lo propio" on public.{tabla} for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);\ncreate policy "borrar lo propio" on public.{tabla} for delete to authenticated using ((select auth.uid()) = user_id);\nCrea solo las que la app necesite y verifícalo con la prueba de aislamiento (cerrojo aislamiento).',
      en: 'drop policy "{politica}" on public.{tabla};\ncreate policy "read own" on public.{tabla} for select to authenticated using ((select auth.uid()) = user_id);\ncreate policy "insert own" on public.{tabla} for insert to authenticated with check ((select auth.uid()) = user_id);\ncreate policy "update own" on public.{tabla} for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);\ncreate policy "delete own" on public.{tabla} for delete to authenticated using ((select auth.uid()) = user_id);\nCreate only the ones the app needs and verify with the isolation test (cerrojo aislamiento).',
    },
    detalle: (d, L) => (L === 'es' ? `Política "${d.politica}" (${d.comando}, roles: ${lista(d.roles)}) con condición: ${d.expresion}. ${d.archivo}` : `Policy "${d.politica}" (${d.comando}, roles: ${lista(d.roles)}) with condition: ${d.expresion}. ${d.archivo}`),
  },
  'R-POLITICA-METADATOS-USUARIO': {
    titulo: { es: 'Política basada en metadatos que el usuario puede editar', en: 'Policy relies on user-editable metadata' },
    porque: {
      es: 'user_metadata (raw_user_meta_data) lo puede modificar el propio usuario con supabase.auth.updateUser(). Si una política concede permisos según ese campo, cualquiera puede declararse administrador.',
      en: 'user_metadata (raw_user_meta_data) can be changed by the user via supabase.auth.updateUser(). If a policy grants access based on it, anyone can make themselves admin.',
    },
    arreglo: { es: 'Guarda los roles en una tabla propia protegida por RLS o en app_metadata (solo editable desde servidor) y consulta eso en la política.', en: 'Store roles in a dedicated RLS-protected table or in app_metadata (server-editable only) and check that in the policy.' },
    detalle: (d, L) => (L === 'es' ? `Política "${d.politica}": ${d.expresion}. ${d.archivo}` : `Policy "${d.politica}": ${d.expresion}. ${d.archivo}`),
  },
  'R-COLUMNA-PRIVILEGIO-EDITABLE': {
    titulo: { es: 'El usuario puede editar una fila propia que contiene columnas de privilegio', en: 'Users can edit their own row, which holds privilege columns' },
    porque: {
      es: 'RLS filtra filas, no columnas. Si la política de update permite al usuario modificar su fila y esa fila guarda su rol, plan o saldo, puede cambiarlos desde la consola del navegador.',
      en: 'RLS filters rows, not columns. If the update policy lets users modify their row and that row stores role, plan or balance, they can change them from the browser console.',
    },
    arreglo: {
      es: 'Mueve esas columnas a otra tabla sin política de update, o revoca el update de columna:\nrevoke update on public.{tabla} from authenticated;\ngrant update (<columnas inofensivas>) on public.{tabla} to authenticated;',
      en: 'Move those columns to another table with no update policy, or revoke column update:\nrevoke update on public.{tabla} from authenticated;\ngrant update (<harmless columns>) on public.{tabla} to authenticated;',
    },
    detalle: (d, L) => {
      const disp = d.disparadores?.length ? (L === 'es' ? ` Hay disparadores BEFORE UPDATE (${lista(d.disparadores)}): comprueba si impiden cambiar estas columnas.` : ` There are BEFORE UPDATE triggers (${lista(d.disparadores)}): check whether they prevent changing these columns.`) : '';
      return L === 'es'
        ? `Columnas: ${lista(d.columnas)}. Política de modificación: "${d.politica}". Las migraciones no retiran a los usuarios el permiso de UPDATE sobre estas columnas.${disp}`
        : `Columns: ${lista(d.columnas)}. Modifying policy: "${d.politica}". The migrations do not revoke users’ UPDATE permission on these columns.${disp}`;
    },
  },
  'R-FUNCION-DEFINER': {
    titulo: { es: 'Función SECURITY DEFINER sin search_path fijo', en: 'SECURITY DEFINER function without a fixed search_path' },
    porque: { es: 'Se ejecuta con los permisos de su creador y se salta RLS. Sin search_path fijo puede ser engañada para ejecutar objetos de otro esquema; además, si está en public es invocable por API.', en: 'It runs with its creator’s rights and bypasses RLS. Without a fixed search_path it can be tricked into running objects from another schema; and if in public it is callable via the API.' },
    arreglo: { es: 'Añade "set search_path = \'\'" y califica los nombres con esquema. Comprueba dentro de la función quién llama (auth.uid()). Revoca execute a anon si no es necesario.', en: 'Add "set search_path = \'\'" and schema-qualify names. Check the caller inside the function (auth.uid()). Revoke execute from anon if unneeded.' },
    detalle: (d) => `${d.funcion} — ${d.archivo}`,
  },
  'R-VISTA-SIN-INVOKER': {
    titulo: { es: 'Vista que puede saltarse RLS', en: 'View that may bypass RLS' },
    porque: { es: 'Por defecto una vista consulta las tablas con los permisos de su creador, ignorando las políticas RLS del usuario que la lee.', en: 'By default a view queries tables with its creator’s rights, ignoring the reading user’s RLS policies.' },
    arreglo: { es: 'create or replace view public.{tabla} with (security_invoker = on) as ...', en: 'create or replace view public.{tabla} with (security_invoker = on) as ...' },
    detalle: (d, L) => (d.materializada ? (L === 'es' ? `Vista materializada (RLS no se aplica a su contenido). ${d.archivo}` : `Materialized view (RLS does not apply to its contents). ${d.archivo}`) : `${d.archivo}`),
  },
  'R-BUCKET-PUBLICO': {
    titulo: { es: 'Bucket de almacenamiento creado como público', en: 'Storage bucket created as public' },
    porque: { es: 'Cualquiera con la URL de un archivo puede descargarlo sin sesión. Correcto para avatares o imágenes públicas; un problema para documentos.', en: 'Anyone with a file URL can download it without a session. Fine for avatars or public images; a problem for documents.' },
    arreglo: { es: 'Si guarda archivos privados: update storage.buckets set public = false where id = \'{tabla}\'; y sirve los archivos con URLs firmadas.', en: 'If it stores private files: update storage.buckets set public = false where id = \'{tabla}\'; and serve files through signed URLs.' },
    detalle: (d) => `${d.archivo}`,
  },

  // ───────────── Código del repositorio ─────────────
  'C-SECRETO-EN-REPO': {
    titulo: { es: 'Secreto escrito en el código del repositorio', en: 'Secret hard-coded in the repository' },
    porque: { es: 'Todo el que tenga acceso al repositorio (o a su historial) tiene la clave. Si el código acaba en el navegador, es pública.', en: 'Everyone with access to the repository (or its history) has the key. If the code ends up in the browser, it is public.' },
    arreglo: { es: 'Rota la clave, sácala del código y cárgala como secreto de servidor. Borrarla del archivo no la borra del historial de Git.', en: 'Rotate the key, remove it from code and load it as a server secret. Deleting it from the file does not remove it from Git history.' },
    detalle: (d) => `${d.tipo} — ${d.archivo}:${d.linea} — ${d.muestra}`,
  },
  'C-ENV-PUBLICA-SECRETA': {
    titulo: { es: 'Variable de entorno pública con nombre de secreto', en: 'Public environment variable named like a secret' },
    porque: { es: 'Las variables con prefijo VITE_, NEXT_PUBLIC_ o similar se incrustan en el JavaScript que recibe cada visitante.', en: 'Variables prefixed VITE_, NEXT_PUBLIC_ or similar are embedded in the JavaScript every visitor receives.' },
    arreglo: { es: 'Quita el prefijo público, usa la variable solo en servidor y rota el valor.', en: 'Drop the public prefix, use the variable server-side only and rotate the value.' },
    detalle: (d) => `${d.variable} — ${d.archivo}:${d.linea}`,
  },
  'C-ENV-EN-GIT': {
    titulo: { es: 'Archivo .env dentro del repositorio', en: '.env file inside the repository' },
    porque: { es: 'Los archivos de entorno no deberían versionarse: quedan en el historial y se filtran al compartir o publicar el repositorio.', en: 'Environment files should not be versioned: they stay in history and leak when the repository is shared or published.' },
    arreglo: { es: 'Añade .env* a .gitignore, ejecuta git rm --cached sobre el archivo y rota lo que contuviera si no eran solo claves públicas.', en: 'Add .env* to .gitignore, git rm --cached the file and rotate its contents unless they were public keys only.' },
    detalle: (d, L) => (L === 'es' ? `${d.archivo} (${d.variables} variables; ${d.ignorado ? 'está en .gitignore' : 'no está en .gitignore'})` : `${d.archivo} (${d.variables} variables; ${d.ignorado ? 'listed in .gitignore' : 'not in .gitignore'})`),
  },
  'C-FUNCION-SIN-JWT': {
    titulo: { es: 'Edge Function con verificación de JWT desactivada', en: 'Edge Function with JWT verification disabled' },
    porque: { es: 'Cualquiera en internet puede invocarla. Es correcto para webhooks que validan su propia firma; peligroso si la función confía en quien llama.', en: 'Anyone on the internet can invoke it. Fine for webhooks that verify their own signature; dangerous if the function trusts its caller.' },
    arreglo: { es: 'Activa verify_jwt o valida dentro de la función (firma del webhook o supabase.auth.getUser con el token recibido).', en: 'Enable verify_jwt or validate inside the function (webhook signature or supabase.auth.getUser with the received token).' },
    detalle: (d) => `[functions.${d.funcion}] verify_jwt = false — ${d.archivo}`,
  },
  'C-FUNCION-SERVICIO-SIN-AUTH': {
    titulo: { es: 'Edge Function usa la clave de servicio sin comprobar quién llama', en: 'Edge Function uses the service key without checking the caller' },
    porque: { es: 'La función actúa con permisos totales. Si no identifica al usuario ni comprueba que el recurso es suyo, cualquiera puede pedirle que lea o modifique datos ajenos.', en: 'The function acts with full rights. If it does not identify the user or check resource ownership, anyone can ask it to read or modify other people’s data.' },
    arreglo: { es: 'Obtén el usuario con supabase.auth.getUser(token) al principio y filtra todas las consultas por su id; no aceptes un user_id enviado en el cuerpo.', en: 'Get the user with supabase.auth.getUser(token) first and filter every query by their id; never accept a user_id from the request body.' },
    detalle: (d, L) => (L === 'es' ? `${d.archivo}: usa SERVICE_ROLE y no se ha encontrado ninguna comprobación de identidad (heurística; revisar a mano).` : `${d.archivo}: uses SERVICE_ROLE and no identity check was found (heuristic; review manually).`),
  },
  'C-CORS-ABIERTO': {
    titulo: { es: 'Edge Function con CORS abierto a cualquier origen', en: 'Edge Function with CORS open to any origin' },
    porque: { es: 'Cualquier web puede llamar a la función desde el navegador de un usuario. Es la plantilla por defecto; conviene restringirla en funciones sensibles.', en: 'Any website can call the function from a user’s browser. It is the default template; restrict it for sensitive functions.' },
    arreglo: { es: 'Sustituye "*" por el dominio de tu aplicación.', en: 'Replace "*" with your application domain.' },
    detalle: (d) => `${d.archivo}`,
  },
  'C-ADMIN-EN-CLIENTE': {
    titulo: { es: 'Permisos de administrador decididos en el navegador', en: 'Admin rights decided in the browser' },
    porque: { es: 'Lo que se comprueba en el navegador se puede cambiar desde la consola. Ocultar un botón no protege los datos: la autorización real debe estar en RLS o en el servidor.', en: 'Anything checked in the browser can be changed from the console. Hiding a button does not protect data: real authorization must live in RLS or on the server.' },
    arreglo: { es: 'Mantén la comprobación visual si quieres, pero asegúrate de que cada tabla y función de administración verifica el rol en servidor.', en: 'Keep the visual check if you like, but make sure every admin table and function verifies the role server-side.' },
    detalle: (d) => `${d.archivo}:${d.linea} — ${d.fragmento}`,
  },
  'C-HTML-SIN-SANEAR': {
    titulo: { es: 'HTML insertado sin sanear', en: 'Unsanitised HTML injection' },
    porque: { es: 'Si el contenido viene de usuarios, permite ejecutar JavaScript en el navegador de otros (XSS) y robar su sesión.', en: 'If the content comes from users, it allows running JavaScript in other people’s browsers (XSS) and stealing their session.' },
    arreglo: { es: 'Sanea con DOMPurify antes de insertar, o renderiza como texto.', en: 'Sanitise with DOMPurify before inserting, or render as text.' },
    detalle: (d) => `${d.archivo}:${d.linea}`,
  },
};

export const ETIQUETA_GRAVEDAD = {
  es: { critica: 'Crítica', alta: 'Alta', media: 'Media', baja: 'Baja', info: 'Informativa' },
  en: { critica: 'Critical', alta: 'High', media: 'Medium', baja: 'Low', info: 'Info' },
};

/** Crea una instancia de hallazgo validando que el identificador existe. */
export function hallazgo(id, gravedad, donde, datos = {}) {
  if (!CATALOGO[id]) throw new Error(`Hallazgo desconocido: ${id}`);
  return { id, gravedad, donde, datos };
}
