# Registro de decisiones y progreso

Documento breve para retomar el trabajo. Última actualización: 15-nov-2026.

## Estado

- [x] Investigación con fuentes y fechas: `docs/INVESTIGACION.md`.
- [x] Comparación de 8 oportunidades y elección.
- [x] MVP funcional (`cerrojo`): `web`, `aislamiento`, `repo`, `informe`.
- [x] App ficticia vulnerable (`demo/`) con PostgreSQL real (PGlite) y RLS.
- [x] Salvaguardas de red y de datos revisadas (ver "Revisión de seguridad del 15-nov").
- [x] 45 pruebas automáticas en verde (`npm test`).
- [x] README, `docs/LIMITACIONES.md`, `docs/OFERTA.md`, `docs/GUIA-REVISION-MANUAL.md`,
      `docs/AUTORIZACION.md`.
- [x] Material de lanzamiento preparado: `docs/LANZAMIENTO.md`, `docs/index.html` (borrador),
      informes de ejemplo en `docs/`.
- [ ] **Validar contra un proyecto Supabase real propio.** No hecho, por decisión expresa.
- [ ] **Publicación.** No se ha publicado nada: ni repositorio, ni página, ni anuncio.
- [ ] Primera auditoría real (gratuita y con permiso) para medir horas.

## Cómo ejecutarlo

    npm install
    npm test           # 45 pruebas
    npm run demo       # audita la app ficticia y genera salida/demo-informe.html
    node bin/cerrojo.js ayuda

## Decisiones

1. **Oportunidad elegida**: revisión de seguridad a precio fijo para apps hechas con IA sobre
   Supabase. Única opción con intención de compra observada (encargos publicados de
   150–1.000 $). Ningún cliente validado.
2. **Veri\*factu descartado**: aplazamiento previsto a octubre de 2028 anunciado por Hacienda
   el 5-oct-2026 (sin norma en el BOE) y al menos cinco validadores gratuitos ya existentes.
3. **Diferencia buscada**: comprobar con dos cuentas de prueba si el aislamiento funciona.
4. **Sin dependencias en ejecución** y sin secretos en el repositorio: las claves falsas de la
   demo se generan al arrancar.
5. **Precio de partida** (hipótesis): 290 € revisión, 590 € con arreglos, 90 € repaso. Regla
   para ajustarlo en `docs/OFERTA.md`.
6. Commits con el correo `noreply` de GitHub, para no exponer datos personales si se publica.
7. No se usó Antigravity (no está conectado a este entorno).

## Revisión de seguridad del 15-nov

Cuatro correcciones pedidas tras la primera revisión, todas con pruebas:

1. **Límite de descarga en streaming** (`src/http.js`). Antes se cargaba la respuesta entera y
   luego se recortaba. Ahora se corta la conexión al alcanzar el límite, contado sobre bytes
   descomprimidos.
2. **Destinos internos bloqueados** (`src/http.js`). Se rechazan localhost, redes privadas e
   internas, por nombre, por IP literal, por resolución DNS y tras cada redirección. La IP
   validada queda fijada para la conexión. Al cambiar de origen se retiran las credenciales.
   `--permitir-local` admite solo la propia máquina.
3. **Prueba de escritura restringida** (`src/aislamiento.js`). Es un `UPDATE` real que dispara
   triggers. Solo se ejecuta contra `127.0.0.1`/`localhost` y con `--base-desechable`; contra un
   proyecto alojado se niega. Corregidos la ayuda, el catálogo y la documentación, que antes
   decían que no alteraba nada.
4. **Lectura de filas declarada**. Hasta 1.000 filas completas por cuenta y tabla. Consta en la
   ayuda, en un aviso al ejecutar, en el resultado, en el informe, en el README y en la
   plantilla de autorización, con la recomendación de usar datos ficticios o un entorno de
   pruebas.

De paso se corrigió un falso positivo: una columna `account_id` que no contiene usuarios ya no
se toma por columna de dueño.

## Límite principal

La capa HTTP de Supabase está **emulada** en la demo a partir de la documentación pública. La
autorización sí es real (PostgreSQL con RLS). **La herramienta no se ha ejecutado contra un
proyecto Supabase de verdad.** Detalle en `docs/LIMITACIONES.md`.

## Siguiente paso

La lista "Antes de ofrecerlo a un cliente" de `docs/LIMITACIONES.md`, por orden.
