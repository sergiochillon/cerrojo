# cerrojo

[English summary](README.en.md)

Comprueba si los usuarios de una aplicación hecha con IA (Lovable, Bolt, Cursor…) sobre
Supabase pueden ver o cambiar datos de otros usuarios. No mira si RLS está "activado": inicia
sesión con dos cuentas de prueba y compara lo que recibe cada una. Genera un informe con el
arreglo de cada hallazgo.

> **Estado: primera versión, sin validar contra un Supabase real.** Funciona de principio a
> fin contra la app ficticia incluida y tiene 121 pruebas automáticas, pero hasta ahora solo
> ha hablado con una emulación local de la API de Supabase, y no se ha usado con ningún
> cliente. La validación pendiente está preparada en
> [validacion/LOCAL.md](validacion/LOCAL.md). Antes de fiarte de un resultado, lee
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

## Qué hace

| Orden | Qué comprueba | Qué necesita |
|---|---|---|
| `cerrojo web <url>` | Lo que la app desplegada expone a un visitante sin sesión: tablas legibles con la clave pública, secretos en el JavaScript, buckets listables, registro sin verificar, `.env` o `.git` servidos. | La URL y autorización del titular. |
| `cerrojo aislamiento` | Si un usuario registrado recibe filas de otro (y, en una base local desechable, si puede modificarlas). | Dos cuentas de prueba con datos. |
| `cerrojo repo <carpeta>` | Las migraciones SQL (tablas sin RLS, políticas abiertas o que solo exigen sesión, `WITH CHECK` abiertos, políticas basadas en metadatos editables, columnas de privilegio editables, vistas y funciones que se saltan RLS) y el código (secretos, Edge Functions sin comprobar identidad…). | El repositorio. No usa la red. |
| `cerrojo informe` | Une los resultados y la revisión manual en un informe HTML imprimible, en español o inglés. | Los `.json` anteriores. |

Las comprobaciones se complementan: cada una encuentra cosas que las otras no ven. En la app
de demostración, la política basada en `user_metadata` solo la detecta `repo`; el bucket
listable solo lo detecta `web`; y que `clients` se filtra entre usuarios solo lo demuestra
`aislamiento`.

**Cuando algo no se puede comprobar, lo dice.** Una clave rechazada, un error del servidor,
una tabla sin datos de prueba o un proyecto que no se detecta no se presentan como "todo
protegido": van a una sección de avisos y el informe se declara no concluyente.

## Probarlo en un minuto (sin tocar ningún sistema real)

Requiere Node.js 20.6 o superior.

```bash
npm install
npm run demo
```

`npm run demo` arranca en tu máquina una app ficticia y deliberadamente vulnerable
("Clientia"), la audita por las tres vías y deja el informe en `salida/demo-informe.html`.
Hay una copia ya generada en [docs/ejemplo-informe.html](docs/ejemplo-informe.html).

La demo no simula la autorización: detrás hay un PostgreSQL real (PGlite, Postgres compilado a
WebAssembly) con roles `anon`/`authenticated` y las políticas RLS de la migración de la app.
Lo que sí es una emulación es la capa HTTP de Supabase.

Para usar la línea de comandos paso a paso contra esa misma demo, `npm run demo:servidor` y,
en otra terminal, las órdenes que imprime.

## Uso

**Solo sobre aplicaciones tuyas o con autorización escrita de su titular**
([docs/AUTORIZACION.md](docs/AUTORIZACION.md)).

La forma recomendada de revisar la app de otra persona es **sobre una réplica local** de su
proyecto, con datos inventados, sin tocar su base de datos:
[docs/REPLICA-LOCAL.md](docs/REPLICA-LOCAL.md).

Sobre un proyecto desplegado:

```bash
# 1. Qué se ve desde fuera, sin sesión
node bin/cerrojo.js web https://app.example --autorizo --salida salida/web.json

# 2. Aislamiento entre dos cuentas de prueba (credenciales por variables de entorno)
export CERROJO_A_CORREO=... CERROJO_A_CONTRASENA=...
export CERROJO_B_CORREO=... CERROJO_B_CONTRASENA=...
node bin/cerrojo.js aislamiento --autorizo --desde salida/web.json --salida salida/aislamiento.json

# 3. Repositorio (local, sin red)
node bin/cerrojo.js repo ../repo --salida salida/repo.json

# 4. Informe, con lo que aporte la revisión manual
node bin/cerrojo.js informe salida/web.json salida/aislamiento.json salida/repo.json \
  --manual revision-manual.json --cliente "Nombre" --auditor "Tu nombre" --salida salida/informe.html
```

`node bin/cerrojo.js ayuda` muestra todas las opciones. `--manual` añade hallazgos propios,
hallazgos automáticos descartados (con su motivo) y lo que quedó sin revisar; plantilla en
[docs/revision-manual.ejemplo.json](docs/revision-manual.ejemplo.json). La carpeta `salida/`
está en `.gitignore`.

Las herramientas son la mitad del trabajo. La otra mitad es la revisión manual:
[docs/GUIA-REVISION-MANUAL.md](docs/GUIA-REVISION-MANUAL.md).

## Qué datos toca la herramienta (léelo antes de usarla)

Para saber si una tabla es accesible hay que pedirle filas. No hay forma de comprobarlo sin
descargarlas.

- **`web`** pide **una fila por tabla** con la clave pública. Si la tabla es legible, esa fila
  llega completa a tu máquina.
- **`aislamiento`** descarga **filas completas: hasta 1.000 por cuenta y por tabla**. Si las
  políticas fallan, entre ellas habrá **datos de otros usuarios**: eso es lo que se comprueba.
  `--limite <n>` reduce el número; no se puede subir de 1.000.
- En ambos casos las filas se analizan **en memoria** y se descartan. En los `.json` y en el
  informe solo quedan recuentos y nombres de columna y de tabla; hay pruebas automáticas que
  lo verifican. Que no se guarden no cambia el hecho de que se han descargado.

**Recomendación:** trabaja sobre una réplica local o un entorno de pruebas con **datos
ficticios**. Si solo existe producción, acuérdalo por escrito con el titular, usa cuentas de
prueba creadas para la ocasión y baja `--limite`.

## Salvaguardas

- **Autorización explícita.** `web` y `aislamiento` no hacen ninguna petición sin `--autorizo`.
- **Solo la clave pública.** Con una clave secreta (`sb_secret_…` o `service_role`) se niega a
  conectarse.
- **Sin escrituras en proyectos reales.** La única escritura, `--probar-escritura`, es un
  `UPDATE` real que dispara triggers aunque no cambie valores. Está limitada a una base
  **local y desechable** (`--permitir-local`, `--base-desechable`, Supabase en `127.0.0.1`);
  contra un proyecto alojado se niega a ejecutarse.
- **No se conecta a tu red interna.** La URL que auditas, sus redirecciones y lo que su código
  declara como backend son datos de un tercero. Se rechazan `localhost`, redes privadas e
  internas (IPv4 e IPv6, incluidas las formas alternativas de escribirlas y los mecanismos de
  transición), también tras una redirección. La IP se resuelve una vez, se valida y la
  conexión queda fijada a ella.
- **`--permitir-local` abre toda tu máquina, no solo la demo.** Mientras está puesta, la
  herramienta acepta como destino **cualquier servicio que escuche en `localhost`**. Úsala
  solo con una URL que conozcas y nunca al auditar la app de un tercero.
- **Entradas hostiles.** El HTML, el JavaScript, el SQL y las respuestas que procesa los
  escribe un tercero: las descargas están acotadas mientras se reciben, el análisis es de coste
  lineal, no se siguen enlaces simbólicos y lo que se imprime en la terminal o en el informe
  va saneado.
- **Credenciales fuera de las redirecciones** entre orígenes.
- **Tráfico moderado.** Peticiones espaciadas y con un máximo por ejecución.
- **Nada que ejecutar a ciegas.** Las funciones RPC y Edge Functions se listan; nunca se invocan.
- **Sin dependencias en ejecución.** Solo Node.js. PGlite es una dependencia de desarrollo.

## Pruebas

```bash
npm test
```

121 pruebas: lectura de SQL y evaluación de políticas, extracción desde código público,
integración contra la app ficticia (vulnerable y con los arreglos aplicados), falsos positivos
y falsos negativos conocidos, privacidad de los resultados, las salvaguardas de arriba,
entradas hostiles y el ensayo en local del guion de validación.

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
validacion/              guiones, SQL y validadores para un Supabase local o de pruebas
test/                    pruebas
docs/                    investigación, límites, oferta, guías
```

## Documentación

- [docs/LIMITACIONES.md](docs/LIMITACIONES.md) — qué no hace y qué falta por validar.
- [validacion/LOCAL.md](validacion/LOCAL.md) — validación contra un Supabase local (pendiente).
- [validacion/GUION.md](validacion/GUION.md) — validación contra un proyecto de pruebas alojado.
- [docs/REPLICA-LOCAL.md](docs/REPLICA-LOCAL.md) — revisar una app sobre una copia local.
- [docs/GUIA-REVISION-MANUAL.md](docs/GUIA-REVISION-MANUAL.md) — la parte que no se automatiza.
- [docs/AUTORIZACION.md](docs/AUTORIZACION.md) — plantilla de autorización escrita.
- [docs/INVESTIGACION.md](docs/INVESTIGACION.md) y
  [docs/REVISION-ESTRATEGICA.md](docs/REVISION-ESTRATEGICA.md) — por qué este proyecto.
- [docs/OFERTA.md](docs/OFERTA.md) y [docs/MARKETPLACES.md](docs/MARKETPLACES.md) — el servicio,
  su precio como hipótesis y los textos de presentación.
- [docs/BITACORA.md](docs/BITACORA.md) y [DECISIONES.md](DECISIONES.md) — registro de trabajo.

## Uso responsable

Ejecutar estas comprobaciones contra sistemas ajenos sin permiso puede ser delito (en España,
art. 197 bis del Código Penal). La herramienta existe para que el titular de una aplicación, o
quien él autorice, encuentre sus fallos antes que otros.

## Licencia

MIT. Ver [LICENSE](LICENSE).
