# Guion de validación contra un proyecto Supabase de pruebas

Procedimiento para comprobar, por primera vez, cómo se comporta `cerrojo` frente a un Supabase
de verdad. Todo lo de esta carpeta está **preparado y ensayado en local, pero no ejecutado
contra ningún servicio remoto**.

## Reglas

1. **Solo un proyecto creado para esto**, vacío, con **datos sintéticos**. Nunca un proyecto
   de producción ni uno que contenga datos de alguien.
2. **Solo lectura.** El validador no modifica datos y no tiene ninguna opción para hacerlo.
   `--probar-escritura` sigue limitado a bases locales desechables y **no forma parte de este
   guion**: contra un proyecto alojado la herramienta se niega a ejecutarla.
3. **Solo la clave pública** (publishable). La clave secreta no hace falta en ningún paso.
4. **Nada de esto sube a Git.** `validacion/.env` y `salida/` están en `.gitignore`.
5. Si algo no cuadra con lo que describe este guion, **para** y no improvises sobre el
   proyecto: anota lo que has visto.

## Qué se comprueba de verdad y qué sigue simulado

Hasta hoy, la herramienta solo ha hablado con una emulación local de la API de Supabase. Esta
tabla dice qué parte de cada pieza valida este guion.

| Pieza de `cerrojo` | Estado actual | ¿Lo valida este guion? |
|---|---|---|
| Lectura de una tabla (`GET /rest/v1/<tabla>?select=*&limit=N`, `Prefer: count=exact`) | Emulada | **Sí.** Códigos HTTP, cabecera `Content-Range`, recuento total. |
| Cabeceras con la clave nueva `sb_publishable_…` (solo `apikey`) | Emulada con clave antigua | **Sí.** |
| Distinguir "protegida por RLS", "sin permisos" (42501), "no existe" y "clave no válida" | Emulado | **Sí.** Es el riesgo principal: un error mal clasificado parecería "tabla protegida". |
| Inicio de sesión (`POST /auth/v1/token?grant_type=password`) | Emulado | **Sí.** |
| Lectura con sesión y lógica de aislamiento (fuga, aislada, no concluyente) | Lógica real; API emulada | **Sí**, en 11 casos. |
| Tope de 1.000 filas y recuento con más filas que el máximo | Emulado | **Sí** (caso `cv_volumen`). |
| Vistas con y sin `security_invoker` | PostgreSQL real en local | **Sí**, con los roles reales de Supabase. |
| Esquema OpenAPI no accesible con clave pública | Emulado | **Sí.** |
| Campos de `/auth/v1/settings` | Emulados | **Sí** (que existen y son booleanos). |
| Listado de un bucket (`POST /storage/v1/object/list/<bucket>`) | Emulado | **Sí**, si haces el paso opcional. |
| `cerrojo web` de principio a fin | Emulado | **Sí**, si haces el paso opcional de la página. |
| Extracción desde el JavaScript de una app real (Lovable, Bolt…) | Probada con texto de ejemplo | **No.** Hace falta una app real. |
| `cerrojo repo` sobre un repositorio real | Probado con la app ficticia | **No.** No usa Supabase. |
| Prueba de escritura | Solo en local | **No**, a propósito. |
| Edge Functions, RPC, GraphQL, Realtime | No cubiertos por la herramienta | **No.** |
| Claves antiguas (`anon` JWT) | Emuladas | Solo si el proyecto de pruebas aún las ofrece (repetición opcional). |

## Requisitos

- Node.js 20.6 o superior (por `--env-file`). Compruébalo con `node --version`.
- Dependencias instaladas y pruebas en verde:

```bash
npm install
```

```bash
npm test
```

`npm test` incluye el ensayo de este guion: aplica estos mismos scripts SQL a un PostgreSQL
real en local y comprueba que el validador obtiene lo esperado. Si falla aquí, no sigas.

---

## Paso 1 · Crear a mano el proyecto de pruebas

Los nombres de los menús del panel de Supabase cambian con el tiempo; si alguno no coincide,
busca el equivalente y no sigas hasta estar seguro de dónde estás.

1. Entra en el panel de Supabase con tu cuenta. Si tienes proyectos reales, lo más seguro es
   crear antes una **organización aparte** solo para pruebas, de modo que el proyecto de
   validación no conviva con ellos.
2. Crea un proyecto nuevo:
   - **Nombre**: `cerrojo-validacion` seguido de la fecha, por ejemplo
     `cerrojo-validacion-20261115`. Un nombre inconfundible evita borrar otro por error.
   - **Contraseña de la base de datos**: genera una aleatoria y guárdala en tu gestor de
     contraseñas. **No la necesita ningún paso de este guion**: no la copies a ningún archivo.
   - **Plan**: el gratuito. Comprueba en la pantalla de creación que no se activa ningún
     complemento de pago. Este guion no requiere ninguno.
   - Si aparece la casilla sobre exponer automáticamente las tablas nuevas a la API, da igual
     cómo la dejes: los scripts conceden los permisos de forma explícita.
3. No importes datos, no conectes integraciones y no actives nada más.
4. Recomendado: en **Authentication**, desactiva el registro de usuarios nuevos. El proyecto va
   a tener tablas deliberadamente mal protegidas y no hace falta que nadie más pueda crear
   cuentas. Deja la confirmación de correo como venga por defecto.
5. Crea las **dos cuentas de prueba** en **Authentication → Users → Add user**:
   - correo `cerrojo-a@example.test` para la primera y `cerrojo-b@example.test` para la segunda;
   - una contraseña aleatoria distinta para cada una, creada solo para esto;
   - marca la opción de **confirmar automáticamente** al usuario, para que no se envíe ningún
     correo.

   Si el panel rechaza ese dominio, usa una dirección tuya con un alias, por ejemplo
   `tucorreo+cerrojo-a@tudominio`. Lo obligatorio es que el correo sea `cerrojo-a@…` o termine
   en `+cerrojo-a@…` (y lo mismo con `b`): los scripts y el validador solo aceptan esas dos
   formas. No uses la cuenta de ninguna otra persona.
6. Abre el **SQL Editor** y ejecuta, por este orden, el contenido completo de:
   1. [01_esquema.sql](01_esquema.sql) — tablas, vistas y políticas.
   2. [01b_storage_opcional.sql](01b_storage_opcional.sql) — solo si vas a hacer el paso de
      Storage.
   3. [02_datos.sql](02_datos.sql) — datos sintéticos.

   Cada script lleva salvaguardas y se detiene, sin crear nada, con un mensaje claro si el
   proyecto tiene tablas o vistas propias, cuentas que no son las de prueba o buckets de
   Storage; si ya se había ejecutado; o si faltan las cuentas. Las salvaguardas miran el
   esquema `public`, los usuarios y Storage: **no sustituyen a comprobar tú mismo que estás en
   el proyecto de pruebas** antes de pulsar "Run". Si tras un error aparece
   `current transaction is aborted`, ejecuta `rollback;` y vuelve a intentarlo.
7. Solo si hiciste el paso 01b: en **Storage**, sube un archivo de texto inventado (por
   ejemplo `sintetico.txt`, con cualquier frase) a `cv-listable` y otro a `cv-privado`.
8. Comprueba la carga con esta consulta en el SQL Editor:

```sql
select 'cv_marca' as tabla, count(*) from public.cv_marca
union all select 'cv_sin_rls', count(*) from public.cv_sin_rls
union all select 'cv_solo_sesion', count(*) from public.cv_solo_sesion
union all select 'cv_por_dueno', count(*) from public.cv_por_dueno
union all select 'cv_rls_sin_politicas', count(*) from public.cv_rls_sin_politicas
union all select 'cv_sin_permisos', count(*) from public.cv_sin_permisos
union all select 'cv_mensajes', count(*) from public.cv_mensajes
union all select 'cv_volumen', count(*) from public.cv_volumen;
```

   Debe devolver, en ese orden: 1, 5, 4, 3, 2, 2, 2 y 1200.

## Paso 2 · Preparar `validacion/.env`

```bash
cp validacion/.env.example validacion/.env
```

Rellena `validacion/.env` a mano:

| Variable | De dónde sale |
|---|---|
| `CERROJO_SUPABASE_URL` | La URL del proyecto de pruebas (`https://<20 caracteres>.supabase.co`). |
| `CERROJO_CLAVE` | La clave **publishable** (`sb_publishable_…`), en los ajustes de claves de API. |
| `CERROJO_A_CORREO`, `CERROJO_A_CONTRASENA` | La cuenta de prueba A. |
| `CERROJO_B_CORREO`, `CERROJO_B_CONTRASENA` | La cuenta de prueba B. |
| `CERROJO_VALIDACION_CONFIRMO` | Escribe `es-un-proyecto-de-pruebas-con-datos-sinteticos` solo después de comprobar que lo es. |
| `CERROJO_VALIDAR_STORAGE` | `1` si hiciste el paso de Storage; si no, `0`. |

**No copies la clave secreta** (`sb_secret_…` o `service_role`) a este archivo ni a ningún
otro. Si la pegas por error, el validador se niega a arrancar; aun así, revócala en el panel.

El validador comprueba todo esto antes de hacer ninguna petición y no arranca si la URL no es
de `supabase.co`, si la clave no es pública, si los correos no son los de prueba o si falta la
confirmación. Además, la propia herramienta (`cerrojo web`, `cerrojo aislamiento`) rechaza
cualquier clave secreta antes de conectarse.

## Paso 3 · Ejecutar la validación (solo lectura)

### 3.1 Validación principal

```bash
node --env-file=validacion/.env validacion/validar.js
```

Qué hace, en este orden:

1. Lee la tabla `cv_marca`. Si no encuentra la marca, **se detiene tras esa única petición**:
   es la defensa contra apuntar por error a otro proyecto.
2. Pide una fila de cada tabla sin sesión.
3. Hace una petición con una clave pública inventada, para ver cómo responde Supabase a una
   clave no válida.
4. Consulta el esquema y los ajustes públicos de autenticación.
5. Inicia sesión con las cuentas A y B y lee cada tabla con cada una, hasta 1.000 filas por
   cuenta y tabla. Con los datos de este guion son 1.036 filas en total, todas sintéticas.
6. Si `CERROJO_VALIDAR_STORAGE=1`, lista los dos buckets sin sesión.

Son unas 40 peticiones espaciadas y tarda menos de un minuto. La única huella en el proyecto es
la inevitable: cada inicio de sesión crea una sesión en el servicio de autenticación.

Al terminar imprime cada comprobación con ✔ o ✘ y la lista de peticiones con su código HTTP y
su `Content-Range`, y guarda dos archivos en `salida/`:

- `validacion-<fecha>.json`, con el detalle de las comprobaciones;
- `validacion-aislamiento.json`, el resultado de la prueba de aislamiento en el mismo formato
  que produce `cerrojo aislamiento`.

Ni la salida ni los archivos contienen claves, contraseñas, tokens ni valores de filas. De las
respuestas de error se guarda el código y el mensaje de la API (por ejemplo, "permission denied
for table…"), recortado y con cualquier cosa con forma de token, clave, correo o identificador
enmascarada.

Código de salida: `0` si todo coincide, `1` si alguna comprobación no coincide, `2` si no llegó
a empezar.

### 3.2 Opcional: generar el informe con los datos reales (sin red)

```bash
node bin/cerrojo.js informe salida/validacion-aislamiento.json --cliente "Validación" --salida salida/validacion-informe.html
```

Esta orden no hace ninguna petición: solo convierte el resultado del paso anterior en el
informe HTML. Debe mostrar tres hallazgos de lectura cruzada (`cv_sin_rls`, `cv_solo_sesion` y
`cv_vista_sin_invoker`), la tabla de aislamiento con los 11 casos y, en los límites, la nota de
que no se probó la escritura.

En este guion **no se ejecuta `cerrojo aislamiento` directamente** contra el proyecto: esa
orden es la de uso general y no comprueba la marca de validación, así que con un `.env`
equivocado leería filas de otro proyecto. El validador hace la misma prueba, con la misma
función, después de comprobar la marca. Por la misma razón, **no hay ningún paso con
`--probar-escritura`**.

### 3.3 Opcional: `cerrojo web` de principio a fin

`cerrojo web` necesita una página que auditar. Este paso sirve en tu máquina una página mínima
que contiene la URL y la clave pública del proyecto de pruebas, como haría una app real.

> **Aviso sobre `--permitir-local`.** Para auditar una página servida en tu equipo hay que
> pasar `--permitir-local`. Esa opción **no se limita a la demo ni a esta página**: mientras
> está puesta, la herramienta acepta como destino **cualquier servicio que escuche en tu
> máquina** (bases de datos, paneles de administración, otros servidores de desarrollo), y
> también si una página redirige hacia ellos. Úsala solo con la URL exacta de este paso, solo
> para esta orden, y no la guardes en alias ni scripts. Las redes privadas siguen bloqueadas
> siempre.

En una terminal:

```bash
node --env-file=validacion/.env validacion/pagina.js
```

Antes de servir nada, este programa aplica las mismas comprobaciones que el validador y lee la
marca del proyecto; si no la encuentra, no arranca.

En otra:

```bash
node bin/cerrojo.js web http://127.0.0.1:8787/ --autorizo --permitir-local --salida salida/validacion-web.json
```

Al acabar, para la página con Ctrl+C.

Resultado esperado:

| Hallazgo | Dónde | Gravedad |
|---|---|---|
| Tabla legible sin iniciar sesión | `public.cv_sin_rls` | Crítica |
| Tabla legible sin iniciar sesión | `public.cv_vista_sin_invoker` | Alta |
| Tabla legible sin iniciar sesión | `public.cv_marca` | Media |
| Archivos de un bucket listables | `storage/cv-listable` | Media (solo con el paso de Storage) |
| Faltan cabeceras de seguridad | la página local | Baja (es de la página de pruebas, no del proyecto) |

No deben aparecer: esquema público, clave de servicio ni secretos. "Registro sin verificar"
solo aparece si el proyecto tiene desactivada la confirmación de correo y el registro abierto.

## Cómo interpretar cada resultado

Una ✘ no es un fracaso de la validación: es exactamente la información que se busca. **No
cambies los valores esperados para que pase.** Guarda el archivo de `salida/` y anota la
diferencia; cada una se traduce en una corrección de `src/supabase.js` acompañada de una prueba
que reproduzca la respuesta real en la emulación.

| Comprobación | Esperado | Si no coincide, qué significa |
|---|---|---|
| Se detiene con "No encuentro la marca" | — | No es el proyecto de pruebas, falta `01_esquema.sql` o la clave no es válida. Revisa la URL antes que nada. |
| Sin sesión: `cv_marca`, `cv_sin_rls`, `cv_vista_sin_invoker` | `ok`, total 1, 5 y 3 | `total` vacío: el recuento no llega como se esperaba; mira el `Content-Range` de esa petición. Otro estado: mira el código HTTP y el mensaje apuntados. |
| Sin sesión: `cv_solo_sesion`, `cv_por_dueno`, `cv_rls_sin_politicas`, `cv_vista_con_invoker`, `cv_mensajes`, `cv_volumen` | `ok`, total 0 | Si sale `denegado`, falta un `GRANT` (¿se ejecutó entero el script?). Si sale con filas, la política no está aplicada. |
| Sin sesión: `cv_sin_permisos` | `denegado` | Si sale `error`, Supabase responde con un código o estado que la herramienta no reconoce: hoy lo trataría como error genérico. Anota HTTP, código y mensaje. Si sale `ok`, la tabla sí tiene permisos. |
| Sin sesión: `cv_no_existe` | `no_existe` | Otro valor indica que el aviso de "tabla inexistente" llega con un formato distinto. |
| Una clave inexistente | `clave_invalida` | **La más importante.** Si sale `denegado`, la herramienta confundiría una clave caducada o mal copiada con "todo protegido" y daría un informe limpio falso. Anota el mensaje exacto. |
| Esquema no accesible | no accesible | Si es accesible, este proyecto todavía publica su esquema con la clave pública; la herramienta lo señalaría como hallazgo de gravedad baja. |
| Ajustes de autenticación | disponibles, dos booleanos | Si no están o han cambiado de nombre, el aviso de "registro sin verificar" no funciona. |
| Fallo al iniciar sesión | — | Contraseña mal copiada, cuenta sin confirmar o inicio de sesión por contraseña desactivado. El mensaje lo indica. |
| Entre cuentas: `cv_sin_rls`, `cv_solo_sesion`, `cv_vista_sin_invoker` | `fuga` con los recuentos indicados | Si sale `aislada`, la herramienta no detecta el fallo para el que existe: es un defecto grave. Si cambian solo los números, revisa la carga de datos. |
| Entre cuentas: `cv_por_dueno`, `cv_vista_con_invoker` | `aislada` | Si sale `fuga`, hay un falso positivo. |
| Entre cuentas: `cv_mensajes` | `aislada` | Si sale `fuga`, la herramienta toma por fuga algo legítimo. |
| Entre cuentas: `cv_rls_sin_politicas` | `sin_datos` | Es "no concluyente", no "aislada": correcto. |
| Entre cuentas: `cv_sin_permisos`, `cv_no_existe` | `denegada`, `no_existe` | Como en la lectura sin sesión, pero con el código que Supabase da a un usuario registrado. |
| Entre cuentas: `cv_volumen` | `aislada`, A = 1200, B = 0 | A = 1000: el recuento total no llega cuando hay más filas que el máximo. Otro número: el proyecto tiene un máximo de filas distinto de 1.000. |
| Filas descargadas (informativa, con `·`) | 1036 | Distinto si el máximo de filas del proyecto no es 1.000. No cuenta como fallo. |
| La prueba no ha escrito nada | sin escrituras | Debe coincidir siempre. Si no, no sigas y revisa qué se ejecutó. |
| Storage: `cv-listable` / `cv-privado` | lista / no lista | Si `cv-listable` no lista, comprueba que subiste el archivo; si es así, el listado real funciona de otra manera. |
| Estado HTTP 429 en la lista de peticiones | — | Límite de frecuencia. Espera unos minutos y repite. |

En la lista de peticiones conviene fijarse, aunque todo salga ✔, en tres cosas que la emulación
no puede saber: si las lecturas parciales devuelven **200 o 206**, el formato exacto del
`Content-Range`, y el **código HTTP** que acompaña al error 42501 sin sesión y con sesión.

### Repetición opcional con la clave antigua

Si el proyecto de pruebas todavía ofrece la clave `anon` antigua (un JWT que empieza por
`eyJ`), repite el paso 3.1 poniéndola en `CERROJO_CLAVE`. Es pública, igual que la
publishable. Si el proyecto ya no la ofrece, sáltate esto.

## Paso 4 · Limpieza

### Opción recomendada: borrar el proyecto entero

Es la más segura: no deja tablas mal protegidas, cuentas ni claves.

1. En el panel, abre el proyecto y **comprueba su nombre** (`cerrojo-validacion-…`). Borrar un
   proyecto no se puede deshacer; si tienes otros, asegúrate dos veces de cuál es.
2. Comprueba que es el de la validación: en el SQL Editor, `select * from public.cv_marca;`
   debe devolver la fila `cerrojo-validacion`.
3. En los ajustes generales del proyecto, elige borrarlo y confirma escribiendo su nombre.
4. Comprueba que ya no aparece en la lista de proyectos.

Pausar el proyecto no es limpiar: los datos y las claves siguen existiendo.

### Si quieres conservar el proyecto para repetir

1. Ejecuta [03_limpieza.sql](03_limpieza.sql) en el SQL Editor. Solo borra objetos `cv_` y se
   niega a ejecutarse si el proyecto tiene otras tablas.
2. En **Storage**, vacía y borra los buckets `cv-listable` y `cv-privado` **desde el panel**.
   No borres archivos con SQL: Supabase advierte de que quedarían huérfanos. El script de
   limpieza no toca los buckets; si los dejas, `01b_storage_opcional.sql` se puede volver a
   ejecutar sin error, pero mientras existan y tengan la política puesta seguirán siendo
   listables.
3. En **Authentication → Users**, borra las dos cuentas de prueba.

### En tu máquina, en ambos casos

```bash
rm -f validacion/.env
```

```bash
rm -f salida/validacion-*
```

Antes de borrar el archivo de resultados, copia a tus notas las diferencias que hayas
encontrado: son lo que hay que corregir. Borra también las contraseñas de las cuentas de prueba
de tu gestor y cierra las terminales donde las hayas usado.

## Qué valida este procedimiento, qué no y qué tienes que hacer tú

**Valida** que las peticiones que hace `cerrojo` a PostgREST, Auth y Storage reciben de un
Supabase real las respuestas que la herramienta espera, y que con ellas llega a las
conclusiones correctas en 11 casos conocidos: tres fugas, cuatro tablas bien aisladas, dos
accesos denegados o inexistentes, un caso no concluyente y una tabla sin dueño.

**No puede demostrar:**

- que la herramienta funcione con una aplicación real, cuyo esquema, volumen y forma de
  empaquetar el JavaScript no se parecen a este;
- nada sobre la escritura, que no se prueba en remoto;
- nada sobre modelos por organización, Edge Functions, RPC, GraphQL o Realtime;
- que no haya falsos negativos fuera de estos 11 casos;
- el comportamiento en proyectos con configuración distinta (dominio propio, máximo de filas
  cambiado, claves antiguas, versiones anteriores de la plataforma);
- que el servicio de auditoría sea viable: eso solo lo dirá la primera auditoría real.

**Revisión independiente.** Este guion y las salvaguardas se pasaron a Antigravity (`agy`) en
modo de solo lectura sobre una copia del proyecto. Señaló seis puntos y están corregidos: el
paso que usaba `cerrojo aislamiento` sin comprobar la marca (ahora el guion no lo ejecuta y la
herramienta rechaza claves secretas), salvaguardas SQL que solo miraban tablas, el paso de
Storage no repetible, mensajes de error guardados sin enmascarar, el descompresor que no se
detenía al cortar una descarga y una comprobación de correos demasiado laxa. Una revisión
automática no es una auditoría: no garantiza que no queden fallos.

**Tienes que hacer a mano:** crear el proyecto y las dos cuentas, ejecutar los scripts en el
SQL Editor, subir los archivos si haces el paso de Storage, rellenar `validacion/.env`, lanzar
las órdenes, anotar las diferencias y borrar el proyecto. Ningún paso de este guion crea,
modifica ni borra nada en Supabase por ti.
