# Registro de decisiones y estado

Para retomar el trabajo. El detalle de cada sesión está en [docs/BITACORA.md](docs/BITACORA.md).
Última actualización: 16-nov-2026.

## Estado

- [x] Investigación y comparación de ocho oportunidades: `docs/INVESTIGACION.md`.
- [x] Herramienta (`cerrojo`): `web`, `aislamiento`, `repo`, `informe`.
- [x] App ficticia vulnerable con PostgreSQL real (PGlite) y demo reproducible (`npm run demo`).
- [x] Salvaguardas de red y de datos, revisadas dos veces.
- [x] Auditoría crítica del código con Antigravity y hallazgos corregidos.
- [x] 121 pruebas automáticas en verde (`npm test`).
- [x] Documentación: README (ES/EN), límites, guía de revisión, réplica local, autorización.
- [x] Oferta replanteada, precio como hipótesis y textos para Fiverr y Upwork.
- [x] Guiones de validación: Supabase local (`validacion/LOCAL.md`) y proyecto alojado
      (`validacion/GUION.md`). Ensayados en local.
- [ ] **Validar contra un Supabase real.** No hecho. Es el paso manual que queda:
      `validacion/LOCAL.md`.
- [ ] Un primer trabajo real, gratis y con permiso, para medir horas y tener un informe de muestra.
- [ ] Gig en Fiverr y propuestas en Upwork: no publicado ni enviado nada.

Qué se ha publicado y qué no: [docs/LANZAMIENTO.md](docs/LANZAMIENTO.md).

## Cómo ejecutarlo

    npm install
    npm test           # 121 pruebas
    npm run demo       # audita la app ficticia y genera salida/demo-informe.html
    node bin/cerrojo.js ayuda

## Decisiones

1. **Problema elegido:** el aislamiento entre usuarios (RLS) en apps hechas con IA sobre
   Supabase. Es la única opción con intención de compra observada (encargos publicados de
   150–1.000 $). Ningún cliente validado.
2. **Veri\*factu descartado:** aplazamiento previsto a octubre de 2028 anunciado por Hacienda
   el 5-oct-2026 (sin norma en el BOE) y validadores gratuitos ya existentes.
3. **No se vende como "auditoría de seguridad"** sino como comprobación y arreglo verificable.
   Entrada a 49 €. Motivos y reglas de abandono en `docs/REVISION-ESTRATEGICA.md`.
4. **Entrega sobre réplica local:** el esquema del cliente con datos inventados, sin tocar su
   base de datos. Resuelve la objeción de los datos y permite probar la escritura.
5. **"No se pudo comprobar" nunca se presenta como "protegido".** Clave rechazada, errores del
   servidor, tablas sin datos o sin descubrir van a avisos y el informe se declara no
   concluyente.
6. **Solo lectura fuera de local.** La prueba de escritura es un `UPDATE` real y solo se
   ejecuta contra una base local declarada desechable.
7. **Se dice lo que se descarga.** Hasta 1.000 filas completas por cuenta y tabla. Un consejo
   de la crítica comercial era callarlo; no se siguió.
8. **Sin dependencias en ejecución y sin secretos en el repositorio.** Las claves falsas de la
   demo se generan al arrancar.
9. **Commits con el correo `noreply` de GitHub** y licencia sin nombre propio.
10. **Antigravity como revisor, no como autor:** siempre en modo plan y sobre copias. Sus
    pruebas adversarias se integraron después de ejecutarlas y revisarlas.
11. **No se publica una oferta ni se envían propuestas todavía:** el servicio no se ha prestado
    nunca y la herramienta no está validada.

## Límite principal

La capa HTTP de Supabase está **emulada** en la demo a partir de la documentación pública. La
autorización sí es real (PostgreSQL con RLS). **La herramienta no se ha ejecutado contra un
Supabase de verdad.** Se intentó levantar uno local con Docker y el control de permisos de la
sesión lo denegó; no se buscó otra vía. Detalle en `docs/LIMITACIONES.md`.

## Siguiente paso

Uno solo: ejecutar `validacion/LOCAL.md`. Con eso validado, el orden es réplica local de una
app real con permiso, informe de muestra, gig y propuestas.
