# Limitaciones

Lo que `cerrojo` no hace, lo que no se ha validado y lo que puede dar un resultado engañoso.
Este documento manda sobre cualquier frase más optimista de otro sitio.

## 1. No se ha probado contra un Supabase real

Es la limitación principal.

- Todas las pruebas se han hecho contra la app ficticia de `demo/`. La **autorización** ahí es
  real: un PostgreSQL 17 (PGlite) con los roles `anon` y `authenticated` y las políticas RLS de
  la migración.
- La **capa HTTP** (PostgREST, Auth, Storage) está **emulada**, escrita a partir de la
  documentación pública de Supabase. Los detalles que pueden diferir en un proyecto real:
  códigos de estado y de error exactos, el formato de `Content-Range`, cómo se aceptan las
  claves nuevas `sb_publishable_…`, la respuesta de `/auth/v1/settings`, el listado de Storage
  y los límites de filas que impone el proyecto.
- Consecuencia práctica: contra un proyecto real la herramienta puede clasificar mal una
  respuesta (por ejemplo, tomar un error por "tabla protegida"). **Un resultado sin hallazgos
  obtenido antes de esa validación no significa nada.**

Qué falta: ejecutarla contra un Supabase de verdad y corregir lo que no coincida. Hay dos
procedimientos preparados, **ninguno ejecutado**:

- [../validacion/LOCAL.md](../validacion/LOCAL.md): contra un Supabase local con Docker. Sin
  nube ni cuenta; es el más corto y permite probar también la escritura.
- [../validacion/GUION.md](../validacion/GUION.md): contra un proyecto de pruebas alojado, con
  datos sintéticos. Comprueba además lo propio de la nube.

Mientras tanto, la herramienta está hecha para no engañar: si el proyecto rechaza la clave, si
una tabla devuelve un error o si no se detecta nada que comprobar, lo marca como **no
concluyente** en vez de darlo por protegido. Eso reduce el riesgo de un informe limpio falso,
pero no sustituye a la validación.

## 2. Qué clases de fallo cubre y cuáles no

Cubre exposición de datos por RLS, secretos publicados y errores de configuración típicos.

No cubre, y un informe debe decirlo:

- **Lógica de negocio**: precios manipulables, cupones, saltarse un pago, límites de plan.
- **Edge Functions y RPC**: se listan, no se ejecutan ni se analizan a fondo. La revisión de
  código por patrones solo detecta la ausencia evidente de comprobación de identidad.
- **Escritura en proyectos reales**: no se prueba. La comprobación de escritura solo se
  ejecuta en una base local desechable (por eso se recomienda trabajar sobre una
  [réplica local](REPLICA-LOCAL.md)); en producción la escritura se evalúa leyendo políticas.
- **Inserción con identidad ajena** (crear filas a nombre de otro usuario) y **borrado**: no se
  prueban dinámicamente en ningún caso.
- **Escalada de privilegios dinámica**: que un usuario pueda cambiar su propio rol se detecta
  solo en las migraciones, no se intenta.
- **Autenticación**: fuerza de contraseñas, recuperación de cuenta, OAuth mal configurado,
  sesiones, MFA.
- **XSS, CSRF, inyección, subida de archivos maliciosos, abuso de la API, denegación de
  servicio, dependencias vulnerables.** Hay un único aviso de HTML sin sanear, por patrón.
- **Apps que no usan Supabase** o que lo usan solo desde servidor: `web` y `aislamiento` no
  aportan nada ahí.
- **GraphQL, Realtime y esquemas distintos de `public`.**

## 3. Resultados que pueden engañar

**Falsos negativos**

- `web` solo conoce las tablas que aparecen en el JavaScript público. Una tabla que la app no
  menciona en el navegador no se comprueba (desde abril de 2026 Supabase ya no publica el
  esquema con la clave pública). Se pueden añadir con `--tablas`.
- Si la app carga el backend desde un dominio propio o un proxy, puede no detectarse el
  proyecto: hay que indicarlo con `--supabase-url` y `--clave`.
- `aislamiento` es concluyente **solo en tablas donde las cuentas de prueba tienen filas
  propias**. Sin datos, el resultado es "no concluyente", no "aislada".
- `aislamiento` identifica al dueño de una fila por una columna que contenga el id de usuario.
  Con modelos de organización o equipo (`org_id`, `team_id`) no reconoce a quién pertenece cada
  fila: lo marca como "sin columna de dueño" y hay que revisarlo a mano.
- Se analizan como mucho 1.000 filas por cuenta y tabla. Una fuga que solo aparezca más allá
  no se ve.
- `repo` refleja lo que dicen las migraciones, no el estado real de la base. Lo que se cambió
  desde el panel de Supabase no está en el repositorio.

**Falsos positivos**

- Las tablas deliberadamente públicas (planes, catálogo) se señalan con gravedad media para
  que alguien confirme que lo son.
- La gravedad se estima por los **nombres** de tablas y columnas (`email`, `token`…), no por su
  contenido.
- El análisis de SQL es tolerante, no un analizador completo de PostgreSQL. Reconoce las
  condiciones que dejan pasar a cualquiera o a cualquier usuario registrado, también escritas
  con conversiones de tipo, subconsultas triviales o combinadas con OR y AND. Una política
  incorrecta de otra clase (compara con la columna equivocada, consulta una tabla que el
  usuario puede modificar) **no la detecta**: para eso están la prueba con dos cuentas y la
  revisión manual. El SQL generado dinámicamente tampoco se analiza.
- Los avisos sobre código (Edge Function sin comprobación de identidad, permisos decididos en
  el navegador, HTML sin sanear) son heurísticos: hay que abrir el archivo antes de afirmarlos.

## 4. Datos que la herramienta descarga

- `web`: una fila por tabla legible con la clave pública.
- `aislamiento`: **hasta 1.000 filas completas por cuenta y por tabla**. Si hay una fuga,
  incluyen datos de otros usuarios.
- No se guardan valores en disco ni en el informe, pero han pasado por la memoria de la máquina
  del auditor y por su conexión. Hacer la prueba sobre producción con datos personales reales
  es un tratamiento de datos que debe acordarse con el titular. Lo recomendable es un entorno
  de pruebas o datos ficticios.

## 5. La prueba de escritura

`--probar-escritura` hace un `UPDATE` real. Asigna a una columna el valor que ya tiene, pero:

- dispara los triggers `BEFORE`/`AFTER UPDATE` (hay una prueba que lo demuestra: tras
  ejecutarla, las filas tienen otro `updated_at` y la tabla de rastro tiene entradas nuevas);
- puede provocar efectos externos si un trigger llama a un webhook o envía correos;
- emite eventos de Realtime y genera escritura en la base.

Por eso solo se ejecuta contra `127.0.0.1`/`localhost` y con `--base-desechable`. No hay
ninguna opción para forzarla sobre un proyecto alojado. Que la base local sea realmente
desechable lo declara quien ejecuta la orden; la herramienta no puede comprobarlo.

## 6. Protección frente a destinos internos

La defensa contra peticiones a la red interna cubre nombres, direcciones IP literales, formas
alternativas de escribirlas, resolución DNS con la IP fijada y redirecciones. Lo que queda
fuera:

- Un proxy HTTP configurado en el entorno no se usa (la herramienta se conecta directamente).
- No distingue una dirección pública que pertenezca a tu propia organización.
- `--permitir-local` abre el acceso a cualquier servicio que escuche en tu máquina, no solo al
  que quieres auditar. Úsalo solo con la demo o con un Supabase local.

## 7. Otros límites

- El informe es una foto de una fecha. Cada cambio en tablas o políticas puede introducir
  fallos nuevos.
- No es una certificación ni una prueba de penetración completa, y no acredita cumplimiento
  del RGPD ni de ninguna norma.
- La nota de protección de datos del informe es informativa, no asesoramiento jurídico.
- No se ha medido el rendimiento con aplicaciones grandes (muchos archivos JavaScript o
  cientos de tablas).
- Las únicas revisiones independientes han sido automáticas, con Antigravity: una del guion
  de validación y dos del código (ver [BITACORA.md](BITACORA.md)). Encontraron fallos reales,
  ya corregidos, lo que indica que probablemente quedan otros. No ha habido revisión humana.

## Antes de ofrecerlo a un cliente

1. Seguir [../validacion/LOCAL.md](../validacion/LOCAL.md) (Supabase local con Docker) y,
   si se quiere comprobar también la nube, [../validacion/GUION.md](../validacion/GUION.md).
2. Corregir en `src/supabase.js` cada diferencia con la emulación, con una prueba que la
   reproduzca, y repetir hasta que todo coincida.
3. Repetir con las claves nuevas (`sb_publishable_`) y con las antiguas (JWT `anon`).
4. Probar un caso con modelo de organización o equipo y decidir cómo tratarlo.
5. Hacer el trabajo completo una vez, gratis y con permiso, sobre una réplica local de una app
   real de alguien conocido ([REPLICA-LOCAL.md](REPLICA-LOCAL.md)), y medir cuántas horas lleva.
6. Tener firmada la autorización ([AUTORIZACION.md](AUTORIZACION.md)) y unas condiciones de
   servicio con limitación de responsabilidad revisadas por alguien que sepa de ello.
