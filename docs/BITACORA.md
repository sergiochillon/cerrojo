# Bitácora

Registro breve de qué se hizo, con qué y qué quedó sin hacer. Las decisiones están en
[../DECISIONES.md](../DECISIONES.md).

## Sesiones

| Fecha | Qué se hizo |
|---|---|
| 14-nov-2026 | Investigación (búsqueda web y tres subagentes de lectura), comparación de ocho oportunidades, elección, MVP y primeras 25 pruebas. Veri\*factu descartado tras leer la nota de Hacienda del 5-oct-2026. |
| 15-nov-2026 | Cuatro correcciones de seguridad pedidas en revisión (descarga en streaming, destinos internos, escritura solo en local, declaración de filas leídas). Documentación, oferta y material de lanzamiento. Guion de validación contra un proyecto de pruebas. Primera revisión con Antigravity. |
| 16-nov-2026 | Auditoría crítica del código con Antigravity y corrección de sus hallazgos. Avisos de "no concluyente", revisión manual en el informe. Replanteo de la oferta, réplica local, validador local, textos para Fiverr y Upwork, CI. |

## Uso de Antigravity (`agy`)

Siempre sobre copias temporales del proyecto, nunca sobre el original, y en modo plan (solo
lectura). En modo no interactivo `agy` deniega la ejecución de órdenes, así que no pudo lanzar
pruebas por sí mismo: las ejecuté yo.

| Tarea | Modelo | Resultado |
|---|---|---|
| Revisión del guion de validación y salvaguardas | por defecto | 6 hallazgos, todos corregidos. |
| Auditoría crítica del código | Gemini 4 Hydrogen (XHigh) | 13 hallazgos; 5 eran falsos negativos graves. Corregidos, con una prueba por cada uno. |
| Crítica comercial y borradores de oferta | Gemini 4 Argon (High) | Replanteo de la oferta, precio de entrada y borradores de gig y propuesta. Usó búsqueda web; sus enlaces no los he verificado yo. |
| Pruebas adversarias | Gemini 4 Hydrogen (High) | 14 pruebas redactadas como texto. Al ejecutarlas, tres fallaban y una dejaba colgado el proceso: destaparon los problemas de rendimiento y dos huecos de IPv6. Integradas en `test/adversario.test.js`. |
| Pruebas adversarias (primer intento) | Claude Sonnet 5.5 (High) | Sin resultado: necesitaba permiso para ejecutar órdenes. |
| Coherencia documentación–código | GPT-OSS 120B / Gemini 3.8 Flash | Sin resultado útil: uno devolvió solo un plan y el otro agotó el tiempo. La comprobación de enlaces y opciones se hizo con un script. |
| Segunda auditoría del código corregido | Gemini 4 Hydrogen (XHigh) | Ver más abajo. |

Cuota al empezar el 16-nov: modelos Gemini 99 % semanal, Claude/GPT 100 %, Gemini 4 Argon 94 %.
Cuota tras las tareas principales: 97 %, 98 % y 82 %. **No se ha agotado ninguna cuota** ni se
ha usado nada de pago.

Un consejo de la crítica comercial **no** se siguió: no decir al cliente que la prueba descarga
filas de su base de datos. Se resolvió de otra forma (trabajar sobre una réplica local) y se
mantiene el aviso.

## Publicado

El 16-nov-2026 se publicaron el repositorio (<https://github.com/sergiochillon/cerrojo>) y la
página del proyecto (<https://sergiochillon.github.io/cerrojo/>), tras comprobar que era
gratuito, con cuenta ya autenticada, en un repositorio nuevo y sin secretos ni datos
personales. Detalle en [LANZAMIENTO.md](LANZAMIENTO.md). No se publicó ninguna oferta en
Fiverr, no se envió ninguna propuesta y no se anunció en ningún sitio.

## Lo que no se hizo, y por qué

| Qué | Por qué |
|---|---|
| Validar contra un Supabase real | Se intentó levantar uno local con Docker y el control de permisos de la sesión lo denegó. No se buscó otra vía. Queda como paso manual: [../validacion/LOCAL.md](../validacion/LOCAL.md). |
| Publicar un gig o enviar propuestas | En el navegador integrado Upwork respondió con una verificación anti-bots, que no se sortea, y Fiverr no tenía sesión iniciada. Además, el servicio no se ha prestado nunca: publicar una oferta hoy describiría algo que aún no se sabe entregar. Los textos están en [MARKETPLACES.md](MARKETPLACES.md). |
| Hablar con compradores | Fuera de lo permitido (nada de mensajes directos) y de lo posible en esta sesión. |
| Medir las horas de un trabajo real | Requiere un primer caso real. |
