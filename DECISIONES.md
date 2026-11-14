# Registro de decisiones y progreso

Documento breve para poder retomar el trabajo si se interrumpe la sesión.

## Estado (14-nov-2026)

- [x] Carpeta comprobada: vacía y la esperada.
- [x] Git local inicializado (rama `main`).
- [x] Investigación con búsqueda web (ver `docs/INVESTIGACION.md` cuando exista).
- [ ] Comparación de oportunidades y elección.
- [ ] MVP.
- [ ] Pruebas.
- [ ] README, precio, material de oferta.
- [ ] Publicación (solo si se cumplen todas las condiciones).

## Hechos verificados durante la investigación

1. **Verifactu, fechas legales vigentes**: 1-ene-2027 (contribuyentes del Impuesto sobre
   Sociedades) y 1-jul-2027 (resto), según RDL 15/2025. Fuente: nota de la AEAT, página
   actualizada el 13-oct-2026.
2. **Verifactu, aplazamiento anunciado**: el 5-oct-2026 Hacienda comunicó una "previsión de
   ampliación del plazo" (la prensa y varios blogs hablan de octubre de 2028, alineado con la
   factura electrónica). A 14-nov-2026 no he encontrado norma publicada en el BOE. Hay
   elecciones generales el 29-nov-2026. Consecuencia: la urgencia real es incierta.
3. **Factura electrónica B2B**: RD 238/2026 (BOE 31-mar-2026) y Orden HAC/1028/2026 (BOE
   5-oct-2026). Obligatoria el 6-oct-2027 para >8 M€ de volumen y el 6-oct-2028 para el resto.
4. **Especificaciones técnicas Verifactu leídas de la AEAT** (documentos oficiales):
   huella v0.1.2 (27-08-2024), QR v0.5.0 (10-12-2025), validaciones v1.2.2 (08-04-2026),
   esquema `SuministroInformacion.xsd`.
5. Los tres vectores de prueba oficiales de la huella (alta primera, alta encadenada,
   anulación) se reproducen con SHA-256/UTF-8/hex mayúsculas (comprobado con Node).

## Decisiones

- Usar como máximo tres subagentes, solo lectura, para investigación (hecho).
- No descargar ni guardar en el repositorio los PDF de la AEAT; solo enlazarlos.
