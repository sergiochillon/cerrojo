# Plantilla de autorización para la revisión de seguridad

Modelo orientativo de una página. **No es asesoramiento jurídico**: revísalo con un profesional
antes de usarlo con un cliente. Sin una autorización firmada por quien tiene derecho a darla
(el titular de la aplicación y de la cuenta de Supabase), no se ejecuta nada.

---

**Autorización de revisión de seguridad**

1. **Partes.** [Nombre o razón social del titular], con [NIF], en adelante "el titular",
   autoriza a [nombre del auditor], en adelante "el auditor".

2. **Objeto.** El titular declara ser responsable de la aplicación indicada y de su proyecto
   de Supabase, y autoriza al auditor a realizar las comprobaciones del apartado 4.

3. **Alcance.**
   - Aplicación: [URL de la app]
   - Proyecto de Supabase: [URL o referencia del proyecto]
   - Entorno: [ ] pruebas / staging  [ ] producción
   - Repositorio: [URL o forma de entrega]
   - Fuera de alcance: cualquier otro sistema, dominio o servicio de terceros.

4. **Comprobaciones autorizadas.**
   - Descarga y análisis del código público de la aplicación.
   - Peticiones de lectura a la API del proyecto con la clave pública, sin sesión.
   - Inicio de sesión con las dos cuentas de prueba facilitadas por el titular y peticiones de
     lectura con ellas. **El titular queda informado de que estas lecturas descargan filas
     completas de las tablas (hasta 1.000 por cuenta y tabla) y de que, si existe un fallo de
     aislamiento, pueden incluir datos de otros usuarios.**
   - Revisión del repositorio.

5. **Comprobaciones excluidas.** El auditor no realizará escrituras, modificaciones ni borrados
   en el proyecto; no ejecutará funciones ni procedimientos de la aplicación; no intentará
   acceder a cuentas distintas de las de prueba; no realizará pruebas de carga ni de denegación
   de servicio.

6. **Datos.** El auditor no conservará copia de los datos a los que acceda. El informe solo
   contendrá nombres de tablas y columnas, recuentos y descripciones de los fallos.
   [Si el entorno es producción con datos personales reales: las partes regularán este acceso
   conforme a la normativa de protección de datos aplicable.]

7. **Periodo.** Del [fecha] al [fecha], en horario [horario o "sin restricción"].

8. **Contacto durante la revisión.** [Persona y medio de contacto del titular], a quien el
   auditor avisará de inmediato si encuentra una exposición de datos grave.

9. **Confidencialidad.** El auditor no divulgará los hallazgos a terceros. Cualquier uso del
   informe como ejemplo requerirá permiso expreso y la eliminación de todo dato identificativo.

10. **Límites del servicio.** La revisión es acotada en alcance y tiempo. No garantiza la
    ausencia de vulnerabilidades ni constituye una certificación.

Firmado en [lugar], a [fecha].

El titular: ______________________    El auditor: ______________________
