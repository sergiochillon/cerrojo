# cerrojo — auditoría de seguridad para apps hechas con IA sobre Supabase (MVP en curso)

Documento breve para retomar el trabajo. Última actualización: 14-nov-2026, sesión cortada por
límite de uso.

## Estado

- [x] Carpeta comprobada (vacía y la esperada). Git local, rama `main`, autor con correo noreply.
- [x] Investigación con fuentes y fechas: `docs/INVESTIGACION.md`.
- [x] Comparación de 8 oportunidades y elección.
- [x] MVP funcional (`cerrojo`): `web`, `aislamiento`, `repo`, `informe`.
- [x] App ficticia vulnerable para probar (`demo/`), con PostgreSQL real (PGlite) y RLS.
- [x] 25 pruebas automáticas, todas en verde (`npm test`).
- [ ] **README completo** (solo hay instrucciones mínimas abajo).
- [ ] **Oferta**: hipótesis de precio, texto de presentación, guía de la revisión manual.
- [ ] **LIMITACIONES** como documento propio (el informe ya las incluye).
- [ ] Informe de ejemplo en `docs/` (`node demo/demo.js --docs`) y página de presentación.
- [ ] **Publicación: NO se ha publicado nada.** Pendiente de revisar condiciones.
- [ ] Probar contra un proyecto Supabase real propio (ver "Límite principal").

## Cómo ejecutarlo

    npm install        # solo instala PGlite, dependencia de pruebas
    npm test           # 25 pruebas
    npm run demo       # audita la app ficticia y genera salida/demo-informe.html
    node bin/cerrojo.js ayuda

## Decisiones

1. **Oportunidad elegida**: auditoría de seguridad a precio fijo para apps hechas con IA sobre
   Supabase (Lovable/Bolt/Cursor). Es la única opción con intención de compra observada
   (encargos publicados de 150–1.000 $). No hay ningún cliente validado.
2. **Veri\*factu descartado** pese a ser la primera hipótesis: Hacienda anunció el 5-oct-2026
   el aplazamiento previsto a octubre de 2028 (aún sin norma en el BOE) y ya existen al menos
   cinco validadores gratuitos.
3. **Diferencia buscada**: comprobar si el aislamiento entre usuarios *funciona* con dos cuentas
   de prueba, no solo si RLS está activado. Los escáneres gratuitos no lo hacen.
4. **Salvaguardas**: `web` y `aislamiento` exigen `--autorizo`; pocas peticiones y espaciadas;
   no se guardan valores de filas (hay una prueba que lo verifica); la prueba de escritura es
   opcional y no cambia ningún dato; RPC y Edge Functions nunca se invocan.
5. **Sin dependencias en ejecución** y sin secretos en el repositorio: las claves falsas de la
   demo se generan al arrancar.
6. No se usó Antigravity (no está conectado a este entorno).

## Límite principal

La capa HTTP de Supabase está **emulada** en la demo según la documentación pública. La
autorización sí es real (PostgreSQL con RLS), pero **la herramienta no se ha ejecutado contra
un proyecto Supabase de verdad**. Antes de ofrecer el servicio hay que probarla contra un
proyecto gratuito propio.

## Siguiente paso al retomar

Escribir README, `docs/OFERTA.md` (precio, alcance, plantilla de propuesta) y
`docs/GUIA-REVISION-MANUAL.md`; generar el informe de ejemplo; decidir publicación.
