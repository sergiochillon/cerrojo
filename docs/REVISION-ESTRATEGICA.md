# Revisión estratégica: ¿sigue siendo `cerrojo` la mejor vía?

Fecha: 16-nov-2026. Basada en la evidencia de [INVESTIGACION.md](INVESTIGACION.md), en la
auditoría del propio código y en una crítica comercial independiente pedida a Antigravity
(Gemini 4 Argon, solo lectura). No hay datos nuevos de compradores: **sigue sin haberse hablado
con ningún cliente**.

## Conclusión

**El problema elegido se mantiene. El envoltorio comercial cambia.**

- Se mantiene: comprobar y arreglar el aislamiento entre usuarios (RLS) en apps hechas con IA
  sobre Supabase. Sigue siendo la única de las ocho opciones comparadas con encargos
  publicados y presupuesto visible.
- Cambia: deja de venderse como "auditoría de seguridad" y pasa a ser un trabajo de
  desarrollo acotado y verificable: **"comprobar con dos cuentas si tus usuarios ven datos
  ajenos, y arreglarlo"**.

## Por qué cambia el envoltorio

Tres suposiciones de la oferta anterior no se sostenían:

1. **Que alguien paga 290 € por una "auditoría de seguridad" a un perfil sin historial.**
   Quien compra una auditoría compra autoridad y transferencia de riesgo; un perfil nuevo
   compite con 20–50 propuestas, algunas de auditores con trayectoria. Un arreglo de
   programación con resultado comprobable ("antes la cuenta B veía los clientes de A; ahora
   no") se evalúa por lo que hace, no por quién lo firma.
2. **Que el comprador tiene un entorno de pruebas y sabe preparar dos cuentas con datos.**
   El creador típico tiene un único proyecto en producción, con tablas hechas desde el panel.
   Pedirle un staging antes de empezar mata la venta.
3. **Que las 5–7 horas y la propia herramienta aguantan el primer caso real.** Ninguna de las
   dos cosas está medida.

Y una objeción que la oferta anterior provocaba ella sola: pedir acceso de lectura a la base
de datos de producción de un desconocido.

## Qué se cambia

| | Antes | Ahora |
|---|---|---|
| Nombre | Auditoría de seguridad previa al lanzamiento | Comprobación y arreglo del aislamiento entre usuarios (RLS) |
| Entrada | 290 € | **49 €**: comprobación de hasta 5 tablas con el SQL del arreglo |
| Cómo se trabaja | Sobre el proyecto del cliente (staging o producción) | **Sobre una réplica local** hecha con su esquema y datos inventados: no se toca su base ni sus datos |
| Qué se promete | Un informe | Un resultado comprobable: la misma prueba, antes y después |
| Canal | Página propia y propuestas | Encargos publicados y un gig; la página es apoyo |

La pieza nueva más importante es la **réplica local** ([REPLICA-LOCAL.md](REPLICA-LOCAL.md)):
el cliente entrega el repositorio y el esquema, sin datos; la prueba se hace en un Supabase
local con usuarios y filas inventados. Resuelve a la vez la objeción de los datos, la falta de
staging y la limitación de la prueba de escritura, que en local sí se puede ejecutar. Tiene
un coste: reproducir el esquema y sembrar datos lleva tiempo, y **no se ha hecho nunca**.

## Lo que no se adopta de la crítica recibida

La crítica comercial recomendaba no decir al cliente que la prueba descarga filas de su base
de datos. No se adopta: ocultarlo sería engañar, y es justo el tipo de cosa que un cliente
técnico descubre. La respuesta correcta es la réplica local, donde esa descarga no ocurre
sobre datos reales, y decir con claridad cuándo sí ocurriría.

## Alternativas reconsideradas

| Alternativa | Por qué no ahora |
|---|---|
| "Arreglo tu app hecha con IA y la dejo lista para producción" (genérico) | Tiene más demanda observable, pero es indistinguible de cientos de perfiles y obliga a competir por horas. Queda como **ampliación natural**: quien compra el arreglo de RLS suele necesitar más. |
| Auditoría de accesibilidad web | Precios publicados en España (290–490 €) pero sin sanciones conocidas: poca urgencia y venta por contacto directo. |
| Validador Veri\*factu | Aplazamiento anunciado a 2028 y validadores gratuitos. |
| Escáner gratuito alojado como reclamo | Exige alojar un servicio que hace peticiones a webs ajenas: coste, abuso y riesgo legal. No. |

## Qué sigue siendo débil

- **Cero validación con compradores.** Todo lo anterior es razonamiento sobre señales públicas.
- **Cero validación técnica contra Supabase real.** Ver [LIMITACIONES.md](LIMITACIONES.md).
- **Canal con coste.** Proponer en Upwork consume "connects"; no se ha gastado nada ni se ha
  verificado su precio. Publicar un gig en Fiverr es gratis pero exige fijar plazos de entrega.
- **Sin demanda observada en español.**
- **Precio de entrada bajo.** 49 € no paga las horas del primer trabajo. Es el precio de
  conseguir la primera reseña, no un modelo de negocio.

## Cuándo abandonar

Decidido de antemano, para no racionalizar después:

- Si tras **15 propuestas a encargos que piden exactamente esto** no hay ninguna respuesta:
  el problema es el perfil o el canal. Probar el posicionamiento genérico de "arreglo".
- Si hay respuestas pero **nadie acepta a 49 €**: el problema no es el precio. Ofrecer la
  primera comprobación gratis a cambio de una reseña y de permiso para usar el informe
  anonimizado.
- Si la **primera entrega real lleva más de 12 horas**: el alcance por precio no se sostiene.
  Reducir a "solo comprobación" o subir precios.
- Si en **30 días** no hay ningún pago: parar y revisar con los datos recogidos, no con más
  construcción.

## Orden de trabajo recomendado

1. Validar la herramienta contra un Supabase local ([../validacion/LOCAL.md](../validacion/LOCAL.md)).
2. Hacer una réplica local de una app real de alguien conocido, gratis y con permiso, y medir horas.
3. Con ese informe de muestra (anonimizado), publicar el gig y responder a encargos.
