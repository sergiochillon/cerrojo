# Validación contra un Supabase local (el paso manual que queda)

Es la forma más corta de comprobar `cerrojo` contra los servicios reales de Supabase —su
pasarela, PostgREST y Auth— **sin crear nada en la nube, sin cuenta y sin coste**. Todo vive en
contenedores de tu máquina y desaparece al terminar.

> **Estado: pendiente.** Este paso no se ha ejecutado. Durante la preparación se intentó
> levantar el Supabase local de forma automática y el control de permisos lo denegó, así que
> queda como paso manual. `validacion/local.js` está escrito a partir de la documentación y
> solo se han probado sus comprobaciones previas; lo demás se verá al ejecutarlo.

Sustituye, para una primera pasada, al guion contra un proyecto alojado
([GUION.md](GUION.md)), que sigue siendo válido y comprueba además el comportamiento de la
nube (claves `sb_publishable_`, límites, pasarela).

## Qué necesitas

- Docker Desktop instalado y en marcha.
- Unos 4 GB de disco para las imágenes de Supabase y unos minutos para descargarlas.
- Node.js 20.6 o superior.

## Pasos

Todo en una carpeta nueva y vacía, **fuera** del repositorio de `cerrojo`:

```bash
mkdir ~/cerrojo-supabase-local && cd ~/cerrojo-supabase-local
```

```bash
npx supabase init
```

```bash
npx supabase start -x realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
```

La opción `-x` evita arrancar lo que no hace falta (panel, correo, tiempo real). La primera vez
descarga las imágenes. Al acabar imprime la URL local (`http://127.0.0.1:54321`) y las claves
locales de demostración.

Después, desde esa misma carpeta, ejecuta el validador indicando dónde tienes `cerrojo`:

```bash
node /ruta/a/cerrojo/validacion/local.js
```

El programa:

1. comprueba que el destino es tu propia máquina; contra cualquier otra cosa no hace nada;
2. aplica [01_esquema.sql](01_esquema.sql) dentro del contenedor de la base de datos;
3. crea las dos cuentas de prueba con contraseñas aleatorias que no guarda en ningún sitio;
4. carga los datos sintéticos de [02_datos.sql](02_datos.sql);
5. ejecuta las mismas comprobaciones de solo lectura que `validar.js`;
6. ejecuta además la **prueba de escritura**, que aquí sí procede porque la base es local y
   desechable.

Imprime cada comprobación con ✔ o ✘ y guarda el detalle en `salida/validacion-local.json`.

Para interpretar los resultados vale la tabla de [GUION.md](GUION.md#cómo-interpretar-cada-resultado).
Dos diferencias esperables en local: el esquema OpenAPI puede seguir accesible con la clave
pública según la versión de la CLI, y las claves locales suelen ser todavía del tipo antiguo
(JWT).

## Limpieza

```bash
npx supabase stop --no-backup
```

Borra los contenedores y los datos. La carpeta `~/cerrojo-supabase-local` se puede eliminar
después. Las imágenes de Docker ocupan disco hasta que las borres desde Docker Desktop;
conviene conservarlas si vas a usar el procedimiento de [réplica local](../docs/REPLICA-LOCAL.md).

## Si algo falla

- **"No encuentro el contenedor de la base de datos"**: Docker no está en marcha o
  `supabase start` no terminó. `docker ps` debe mostrar un contenedor `supabase_db_…`.
- **Falla al crear las cuentas**: el alta local puede estar configurada de otra forma. Anota
  el código HTTP que muestra el mensaje y revisa `[auth]` en `supabase/config.toml`
  (`enable_signup`, confirmación de correo). Es información útil: no la descartes.
- **Falla `01_esquema.sql` con "no parece un proyecto de pruebas vacío"**: la carpeta ya tenía
  migraciones o datos. Usa una carpeta nueva.
- **Una comprobación sale ✘**: no cambies lo esperado. Guarda `salida/validacion-local.json`:
  cada diferencia es una corrección pendiente en `src/supabase.js`.

## Sobre `--permitir-local`

Este programa usa internamente el permiso de acceso a la propia máquina, porque el Supabase
local escucha en `127.0.0.1`. Ese permiso no distingue el Supabase local de cualquier otro
servicio de tu equipo. Aquí el destino lo fija `supabase status` y se comprueba antes de
empezar, pero no reutilices esa opción en otras órdenes sin saber a qué URL apuntan.
