# cerrojo

Auditoría de seguridad para aplicaciones hechas con IA (Lovable, Bolt, Cursor…) sobre
Supabase. Comprueba si el aislamiento entre usuarios **funciona**, no solo si RLS está
"activado", y genera un informe entregable con el arreglo de cada hallazgo.

> **Estado: MVP sin validar en producción.** Funciona de principio a fin contra la app
> ficticia incluida y tiene 60 pruebas automáticas, pero **todavía no se ha ejecutado contra
> un proyecto Supabase real** ni se ha usado con ningún cliente. Antes de ofrecerlo, lee
> [docs/LIMITACIONES.md](docs/LIMITACIONES.md).

## Qué problema resuelve

Las apps generadas con IA suelen guardar los datos en Supabase y hablar con la base de datos
directamente desde el navegador. La única barrera entre un usuario y los datos de otro son las
políticas RLS (Row Level Security). El fallo más común no es que RLS falte, sino que esté
activado con una política que deja pasar a cualquiera que haya iniciado sesión:

```sql
alter table clients enable row level security;                              -- "RLS activado" ✓
create policy "..." on clients for all using (auth.uid() is not null);     -- …para todo el mundo
```

Todos los paneles muestran esa tabla como protegida. Un escáner que mire desde fuera, sin
sesión, tampoco ve nada. Pero cualquier persona que se registre lee y modifica los datos de
todos los demás.

`cerrojo` lo comprueba iniciando sesión con dos cuentas de prueba y mirando si cada una
recibe filas de la otra.

## Qué hace

| Orden | Qué comprueba | Qué necesita |
|---|---|---|
| `cerrojo web <url>` | Lo que la app desplegada expone a un visitante sin sesión: tablas legibles con la clave pública, secretos en el JavaScript, buckets listables, registro sin verificar, `.env` o `.git` servidos. | La URL y autorización del titular. |
| `cerrojo aislamiento` | Si un usuario registrado recibe filas de otro. | Dos cuentas de prueba con datos. |
| `cerrojo repo <carpeta>` | Las migraciones SQL (tablas sin RLS, políticas abiertas o que solo exigen sesión, políticas basadas en metadatos editables, columnas de privilegio editables, vistas y funciones que se saltan RLS) y el código (secretos, Edge Functions sin comprobar identidad…). | El repositorio. No usa la red. |
| `cerrojo informe` | Une los resultados en un informe HTML imprimible, en español o inglés. | Los `.json` anteriores. |

Las tres comprobaciones se complementan: cada una encuentra cosas que las otras no ven. En la
app de demostración, por ejemplo, la política basada en `user_metadata` solo la detecta `repo`;
el bucket listable solo lo detecta `web`; y que `clients` se filtra entre usuarios solo lo
demuestra `aislamiento`.

## Probarlo en un minuto (sin tocar ningún sistema real)

Requiere Node.js 20 o superior.

```bash
npm install
npm run demo
```

`npm run demo` arranca en tu máquina una app ficticia y deliberadamente vulnerable
("Clientia"), la audita por las tres vías y deja el informe en `salida/demo-informe.html`
(y `salida/demo-report.html` en inglés). Hay una copia ya generada en
[docs/ejemplo-informe.html](docs/ejemplo-informe.html).

La demo no simula la autorización: detrás hay un PostgreSQL real (PGlite, Postgres compilado a
WebAssembly) con roles `anon`/`authenticated` y las políticas RLS de la migración de la app.
Lo que sí es una emulación es la capa HTTP de Supabase (ver límites).

Para usar la línea de comandos paso a paso contra esa misma demo:

```bash
npm run demo:servidor          # deja la app escuchando en http://127.0.0.1:54321
```

y, en otra terminal, las órdenes que imprime el servidor.

## Uso en una aplicación real

**Solo sobre aplicaciones tuyas o con autorización escrita de su titular.** Hay una plantilla
en [docs/AUTORIZACION.md](docs/AUTORIZACION.md).

```bash
# 1. Qué se ve desde fuera, sin sesión
node bin/cerrojo.js web https://app-del-cliente.example --autorizo --salida salida/web.json

# 2. Aislamiento entre dos cuentas de prueba (credenciales por variables de entorno)
export CERROJO_A_CORREO=... CERROJO_A_CONTRASENA=...
export CERROJO_B_CORREO=... CERROJO_B_CONTRASENA=...
node bin/cerrojo.js aislamiento --autorizo --desde salida/web.json --salida salida/aislamiento.json

# 3. Repositorio (local, sin red)
node bin/cerrojo.js repo ../repo-del-cliente --salida salida/repo.json

# 4. Informe
node bin/cerrojo.js informe salida/web.json salida/aislamiento.json salida/repo.json \
  --cliente "Nombre del cliente" --auditor "Tu nombre" --salida salida/informe.html
```

`node bin/cerrojo.js ayuda` muestra todas las opciones. La carpeta `salida/` está en
`.gitignore`: los resultados de una auditoría real no deben acabar en un repositorio.

Las herramientas automáticas son la mitad del trabajo. La otra mitad es la revisión manual
descrita en [docs/GUIA-REVISION-MANUAL.md](docs/GUIA-REVISION-MANUAL.md).

## Qué datos toca la herramienta (léelo antes de usarla)

Para saber si una tabla es accesible hay que pedirle filas. No hay forma de comprobarlo sin
descargarlas.

- **`web`** pide **una fila por tabla** con la clave pública. Si la tabla es legible, esa fila
  llega completa a tu máquina.
- **`aislamiento`** descarga **filas completas: hasta 1.000 por cuenta y por tabla**
  (2.000 por tabla en total). Si las políticas fallan, entre ellas habrá **datos de otros
  usuarios**, no solo de las cuentas de prueba: precisamente eso es lo que se está
  comprobando. `--limite <n>` reduce el número; no se puede subir de 1.000.
- En ambos casos las filas se analizan **en memoria** y se descartan. En los `.json` y en el
  informe solo quedan recuentos, nombres de columna y nombres de tabla; hay una prueba
  automática que lo verifica. Que no se guarden no cambia el hecho de que se han descargado.

**Recomendación:** haz la prueba de aislamiento en un entorno de pruebas (staging) o sobre una
base cargada con **datos ficticios**. Si solo existe producción, acuérdalo por escrito con el
titular, usa cuentas de prueba creadas para la ocasión, baja `--limite` y trata tu máquina
como un equipo que ha tenido acceso a datos personales. Si descubres que hay datos reales
expuestos, el titular tiene obligaciones que valorar (ver la nota de protección de datos del
informe); no es asesoramiento jurídico.

## Salvaguardas

- **Autorización explícita.** `web` y `aislamiento` no hacen ninguna petición sin
  `--autorizo`, y la declaración queda registrada en el resultado.
- **Sin escrituras en proyectos reales.** La herramienta solo lee. La única excepción,
  `--probar-escritura`, ejecuta un `UPDATE` real: asigna a una columna el valor que ya tiene,
  pero **dispara triggers** (`updated_at`, auditoría, webhooks, correos), emite eventos de
  Realtime y puede dejar la base distinta de como estaba. Por eso está **limitada a una base
  local y desechable**: exige a la vez `--permitir-local`, `--base-desechable` y un Supabase
  en `127.0.0.1`/`localhost`, y contra un proyecto alojado se niega a ejecutarse. En
  producción, la escritura se evalúa leyendo las políticas con `cerrojo repo`.
- **No se conecta a tu red interna.** La URL que auditas, sus redirecciones y lo que su código
  declara como backend son datos controlados por un tercero. La herramienta rechaza
  `localhost`, direcciones privadas o internas (`10.x`, `172.16–31.x`, `192.168.x`,
  `169.254.x`, IPv6 local, `*.local`, `*.internal`…) y las formas alternativas de escribirlas,
  también cuando se llega a ellas por una redirección. La IP se resuelve una vez, se valida y
  la conexión queda fijada a ella. Las redes privadas se rechazan siempre.
- **`--permitir-local` abre toda tu máquina, no solo la demo.** Hace falta para auditar la
  demo o un Supabase local, pero mientras está puesta la herramienta acepta como destino
  **cualquier servicio que escuche en `localhost`** (bases de datos, paneles de
  administración, otros servidores de desarrollo), también si una página redirige hacia
  ellos. Úsala solo con una URL que conozcas y nunca al auditar la app de un tercero.
- **Descargas acotadas.** El límite de tamaño se aplica mientras se descarga y sobre los bytes
  descomprimidos, así que una respuesta enorme no se carga en memoria.
- **Credenciales fuera de las redirecciones.** Si una respuesta redirige a otro origen, se
  retiran `apikey`, `Authorization` y `Cookie`.
- **Tráfico moderado.** Peticiones espaciadas (150 ms) y con un máximo por ejecución.
- **Nada que ejecutar a ciegas.** Las funciones RPC y las Edge Functions detectadas se listan
  para revisarlas a mano; nunca se invocan.
- **Solo la clave pública.** Si se le pasa una clave secreta (`sb_secret_…` o un JWT
  `service_role`), se niega a conectarse.
- **Secretos enmascarados.** Un secreto encontrado se cita como `abcdef…wxyz (N caracteres)`.
- **Sin dependencias en ejecución.** La herramienta usa solo Node.js. PGlite es una
  dependencia de desarrollo, para la demo y las pruebas.

## Pruebas

```bash
npm test
```

60 pruebas: lectura de SQL y evaluación de políticas, extracción desde código público,
integración contra la app ficticia (vulnerable y con los arreglos aplicados, para comprobar que
los hallazgos desaparecen), falsos positivos conocidos, privacidad de los resultados, las
salvaguardas descritas arriba y el ensayo en local del guion de validación.

## Estructura

```
bin/cerrojo.js           punto de entrada
src/cli.js               órdenes y opciones
src/http.js              cliente HTTP con las salvaguardas de red
src/web.js               auditoría de la app desplegada
src/extraer.js           qué revela el JavaScript público
src/supabase.js          llamadas a PostgREST, Auth y Storage
src/aislamiento.js       prueba con dos cuentas
src/sql.js, src/repo.js  revisión de migraciones y código
src/catalogo.js          textos de los hallazgos (ES/EN) y sus arreglos
src/informe.js           informe HTML
demo/                    app ficticia vulnerable, servidor local y arreglos de ejemplo
validacion/              guion, SQL y validador de solo lectura para un Supabase de pruebas
test/                    pruebas
docs/                    investigación, límites, oferta, guía de revisión, lanzamiento
```

## Documentación

- [docs/INVESTIGACION.md](docs/INVESTIGACION.md) — por qué esta oportunidad, con fuentes y fechas.
- [docs/LIMITACIONES.md](docs/LIMITACIONES.md) — qué no hace y qué falta por validar.
- [validacion/GUION.md](validacion/GUION.md) — guion para validarla contra un proyecto Supabase
  de pruebas con datos sintéticos (preparado; aún no ejecutado).
- [docs/OFERTA.md](docs/OFERTA.md) — servicio, hipótesis de precio y textos de presentación.
- [docs/GUIA-REVISION-MANUAL.md](docs/GUIA-REVISION-MANUAL.md) — cómo hacer la parte que no se automatiza.
- [docs/AUTORIZACION.md](docs/AUTORIZACION.md) — plantilla de autorización escrita.
- [docs/LANZAMIENTO.md](docs/LANZAMIENTO.md) — material de lanzamiento preparado y lista previa a publicar.
- [DECISIONES.md](DECISIONES.md) — registro de decisiones y estado.

## Uso responsable

Ejecutar estas comprobaciones contra sistemas ajenos sin permiso puede ser delito (en España,
art. 197 bis del Código Penal). La herramienta existe para que el titular de una aplicación, o
quien él autorice, encuentre sus fallos antes que otros.

## Licencia

MIT. Ver [LICENSE](LICENSE).
