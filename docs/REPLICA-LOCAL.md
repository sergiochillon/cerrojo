# Trabajar sobre una réplica local

Forma recomendada de hacer una comprobación para un cliente: **no se toca su base de datos ni
sus datos.** Se reconstruye su esquema en un Supabase local, se llenan las tablas con filas
inventadas y todas las pruebas se hacen ahí.

> **Sin probar.** Este procedimiento no se ha ejecutado nunca de principio a fin. Depende de
> la validación de [../validacion/LOCAL.md](../validacion/LOCAL.md), que está pendiente. Los
> tiempos son estimaciones.

## Por qué así

| Sobre el proyecto del cliente | Sobre una réplica local |
|---|---|
| Hay que pedir acceso a su base de datos | Solo hace falta su código y su esquema, sin datos |
| Las pruebas descargan filas reales | No existe ningún dato real |
| El cliente tiene que tener staging y crear cuentas de prueba | Las cuentas y los datos los crea quien hace la prueba |
| La escritura no se puede probar | La base es desechable: se prueba lectura **y** escritura |
| Un arreglo se entrega sin haberlo ejecutado | El arreglo se aplica y se vuelve a pasar la prueba |

Lo que **no** cubre, y hay que decir al cliente:

- **Solo refleja lo que hay en el esquema que entrega.** Si después cambia algo desde el
  panel, la réplica no lo sabe.
- La configuración de autenticación, las claves y los ajustes del panel no viajan en el
  esquema: se revisan aparte, con capturas o preguntando.
- Las Edge Functions se leen, no se ejecutan contra sus servicios externos.
- No dice nada del volumen ni del rendimiento.

## Qué se le pide al cliente

1. Acceso de lectura al repositorio (o un .zip).
2. El esquema, **sin datos**. Lo obtiene con:

   ```bash
   supabase db dump --schema public,storage -f esquema.sql
   ```

   Si no usa la CLI, sirve el SQL de las tablas y políticas copiado desde su panel. Hay que
   insistir en que **no incluya datos** (`--data-only` es justo lo contrario de lo que se pide).
3. Una frase por escrito confirmando que es el titular y autoriza la revisión
   ([AUTORIZACION.md](AUTORIZACION.md), adaptada: aquí no hay acceso a su proyecto).

Antes de usar el esquema, comprobar que no contiene datos: buscar `INSERT INTO` y `COPY`. Si
los hay, borrar el archivo, avisar al cliente y pedir otro.

## Pasos

1. **Levantar el Supabase local** en una carpeta nueva (como en LOCAL.md):

   ```bash
   npx supabase init && npx supabase start
   ```

2. **Cargar el esquema del cliente.** Copiar sus migraciones a `supabase/migrations/` (o su
   `esquema.sql` como una migración) y ejecutar:

   ```bash
   npx supabase db reset
   ```

   Si falla, casi siempre es por extensiones o por roles propios: anotarlo, es un hallazgo
   sobre lo fiable que es su repositorio.

3. **Revisión estática**, sin red:

   ```bash
   node bin/cerrojo.js repo /ruta/al/repo-del-cliente --salida salida/repo.json
   ```

4. **Crear dos cuentas de prueba** en el panel local (`http://127.0.0.1:54323`,
   Authentication) o registrándose en la app si se arranca en local.

5. **Sembrar datos inventados** para las dos cuentas en cada tabla que tenga dueño. Dos
   caminos:
   - arrancar la app del cliente en local apuntando al Supabase local y usarla con cada
     cuenta (lo más fiel: los datos se crean como los crearía un usuario);
   - o insertar filas a mano con SQL, dos o tres por cuenta y tabla.

   Sin datos de las dos cuentas en una tabla, la prueba de esa tabla sale "no concluyente".

6. **Prueba de aislamiento, lectura y escritura.** La URL y la clave pública local las da
   `npx supabase status`:

   ```bash
   export CERROJO_SUPABASE_URL=http://127.0.0.1:54321 CERROJO_CLAVE=<clave pública local>
   export CERROJO_A_CORREO=... CERROJO_A_CONTRASENA=... CERROJO_B_CORREO=... CERROJO_B_CONTRASENA=...
   node bin/cerrojo.js aislamiento --autorizo --permitir-local --probar-escritura --base-desechable \
     --tablas tabla1,tabla2,tabla3 --salida salida/aislamiento-antes.json
   ```

   `--permitir-local` admite como destino cualquier servicio de tu máquina, no solo este:
   úsalo solo con la URL del Supabase local.

7. **Revisión manual** de lo que la herramienta no ve: [GUIA-REVISION-MANUAL.md](GUIA-REVISION-MANUAL.md).

8. **Si el encargo incluye arreglos:** escribir la migración de corrección, aplicarla en la
   réplica, repetir el paso 6 guardando `aislamiento-despues.json` y comprobar que la app
   sigue funcionando con las dos cuentas. Entregar la migración; **aplicarla en producción es
   decisión y acción del cliente**.

9. **Informe:**

   ```bash
   node bin/cerrojo.js informe salida/repo.json salida/aislamiento-antes.json \
     --manual salida/revision-manual.json --cliente "…" --salida salida/informe.html
   ```

   Plantilla de la revisión manual: [revision-manual.ejemplo.json](revision-manual.ejemplo.json).

10. **Limpiar:** `npx supabase stop --no-backup` y borrar la carpeta de trabajo y la copia del
    repositorio al terminar el encargo.

## Tiempos (estimación sin medir)

| Paso | Tiempo |
|---|---|
| Levantar y cargar el esquema | 30–60 min |
| Sembrar datos con dos cuentas | 30–90 min |
| Pruebas automáticas | 15 min |
| Revisión manual | 1–3 h |
| Arreglos y segunda pasada | 1–3 h |
| Informe y entrega | 45 min |

La primera vez llevará más. Hay que medirlo antes de dar por buenos los precios de
[OFERTA.md](OFERTA.md).
