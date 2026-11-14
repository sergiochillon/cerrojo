# Oferta, hipótesis de precio y textos de presentación

Todo lo de este documento es una **hipótesis de trabajo**. No hay ningún cliente, ninguna venta
ni ninguna conversación con compradores detrás. Los precios observados proceden de anuncios y
encargos de terceros citados en [INVESTIGACION.md](INVESTIGACION.md).

**No lo ofrezcas todavía.** Antes hay que completar la lista "Antes de ofrecerlo a un cliente"
de [LIMITACIONES.md](LIMITACIONES.md): la herramienta no se ha ejecutado contra un Supabase
real.

## 1. A quién va dirigido

Personas que han construido una aplicación con herramientas de IA (Lovable, Bolt, Cursor, v0…)
sobre Supabase, que no son especialistas en seguridad y que están en uno de estos momentos:

- van a abrir la app a usuarios reales o a empezar a cobrar;
- ya tienen usuarios y les inquieta lo que han leído sobre fugas de datos en apps generadas;
- un cliente, un inversor o un socio les ha pedido alguna garantía;
- una agencia o un desarrollador freelance que entrega este tipo de apps a terceros y quiere
  una revisión independiente antes de la entrega.

No es para equipos con un responsable de seguridad, ni para apps que no usan Supabase.

## 2. Qué se entrega

**Revisión de seguridad previa al lanzamiento**, a precio cerrado:

1. Comprobación externa de la app desplegada: qué puede leer un visitante sin cuenta.
2. Prueba de aislamiento con dos cuentas de prueba: si un usuario registrado ve datos de otro.
   Se hace en un entorno de pruebas o con datos ficticios.
3. Revisión de las migraciones SQL y del código: políticas RLS, vistas y funciones, secretos,
   Edge Functions.
4. Revisión manual de lo que las herramientas no cubren, siguiendo
   [GUIA-REVISION-MANUAL.md](GUIA-REVISION-MANUAL.md).
5. Un informe en español o inglés: cada hallazgo con dónde está, qué se observó, por qué
   importa y el SQL o el cambio concreto para arreglarlo. Ejemplo real del formato (sobre una
   app ficticia): [ejemplo-informe.html](ejemplo-informe.html).
6. Una llamada de 30 minutos para repasarlo.

Lo que **no** incluye, y hay que decir antes de cobrar: no es una prueba de penetración
completa, no cubre lógica de negocio ni pagos, no es una certificación y no garantiza que la
app sea segura. Es una revisión acotada de las clases de fallo más frecuentes en este tipo de
aplicaciones.

## 3. Hipótesis de precio

### Referencias observadas (de terceros, sin verificar ventas)

| Referencia | Precio |
|---|---|
| Revisión productizada de app hecha con IA | 99 $ |
| Encargos publicados para auditar app Lovable + Supabase | 150–400 $, 500 $ y 1.000 $ |
| "Pen test" de app generada en 48 h, con ampliación | 497 $ → 1.250 $ |
| Diagnóstico de software a medida en España (otro sector) | 149 € + IVA |
| Auditorías de accesibilidad de entrada en España (otro servicio) | 290–490 € |

### Propuesta de partida

| Nivel | Qué incluye | Precio hipotético (sin IVA) |
|---|---|---|
| **Revisión** | Puntos 1 a 6 de arriba. Hasta 15 tablas y 10 Edge Functions. Entrega en 3 días laborables. | **290 €** |
| **Revisión + arreglos** | Lo anterior, más una migración SQL con las correcciones, lista para revisar y aplicar, y una segunda pasada para comprobar que los hallazgos desaparecen. | **590 €** |
| **Repaso tras cambios** | Repetir las comprobaciones después de añadir funcionalidades. Solo para quien ya hizo una revisión. | **90 €** |

Razonamiento, con sus huecos:

- 290 € queda dentro del rango de los encargos observados (150–500 $) y por debajo de los que
  piden revisión manual a fondo (1.000 $). Es un precio que alguien que ha construido la app
  sin programar puede decidir solo, sin pedir permiso a nadie.
- La estimación de esfuerzo es de **5 a 7 horas** para el nivel "Revisión" (el desglose está en
  [GUIA-REVISION-MANUAL.md](GUIA-REVISION-MANUAL.md)), es decir, entre 40 y 60 € por hora.
  **No está medida**: es una suposición hasta hacer la primera auditoría real. Si resultan ser
  12 horas, el precio no se sostiene.
- "Revisión + arreglos" responde a lo que piden los encargos mejor pagados: no un PDF, sino el
  problema resuelto. También es donde más responsabilidad se asume: aplicar una migración
  equivocada puede romper la app. Por eso se entrega para revisar, no se aplica en producción.
- El "repaso" existe porque el problema reaparece con cada funcionalidad nueva. Una cuota
  mensual sería el paso siguiente, pero no tiene sentido plantearla sin clientes.

### Cómo comprobar si el precio es correcto

Decidir antes de empezar qué resultado cambia qué:

- Presentar el mismo precio (290 €) a las cinco primeras personas interesadas.
- Si tres o más aceptan sin negociar: el precio es bajo; probar 390 € con las cinco siguientes.
- Si todas preguntan pero ninguna paga: el problema no es el precio sino la confianza o el
  alcance. Probar con una primera revisión gratuita a cambio de permiso para usar el informe
  anonimizado como muestra.
- Si nadie pregunta siquiera: el problema es el canal o que no hay demanda en español. Volver a
  [INVESTIGACION.md](INVESTIGACION.md) antes de bajar el precio.

### Costes y condiciones que hay que resolver

- **Herramientas**: 0 €. No se usan APIs de pago.
- **Canales**: publicar en Upwork consume "connects", que pueden costar dinero. No verificado.
- **Facturar**: cobrar exige poder emitir factura con arreglo a la normativa fiscal que te
  aplique. No se ha analizado tu situación; consúltalo antes de aceptar un pago.
- **Responsabilidad**: un servicio de seguridad puede generar reclamaciones si después hay un
  incidente. Hacen falta unas condiciones con alcance y limitación de responsabilidad, y
  conviene valorar un seguro de responsabilidad civil profesional. No es asesoramiento
  jurídico.

## 4. Textos de presentación

Borradores. Ninguno afirma resultados, clientes ni cifras que no existen. Sustituye lo que va
entre corchetes.

### Una línea

Compruebo si los usuarios de tu app pueden ver los datos de otros usuarios, antes de que lo
descubra alguien más.

### Párrafo

Las apps hechas con Lovable, Bolt o Cursor sobre Supabase suelen tener la base de datos
accesible desde el navegador, protegida solo por reglas de acceso (RLS). El fallo habitual no
es que esas reglas falten, sino que estén activadas y mal escritas: el panel dice "protegido"
y cualquier usuario registrado puede leer los datos de los demás. Hago una revisión a precio
cerrado: inicio sesión con dos cuentas de prueba y compruebo qué ve cada una, reviso las
reglas y el código, y te entrego un informe con cada problema y el cambio exacto para
arreglarlo. Aquí tienes un informe de ejemplo sobre una app ficticia: [enlace].

### Respuesta a un encargo publicado

Hola, [nombre].

He leído que necesitas [revisar la seguridad de tu app hecha con Lovable y Supabase antes de
lanzarla]. Es justo lo que hago.

Lo que haría, en este orden:

1. Mirar qué puede leer de tu app alguien sin cuenta.
2. Crear dos cuentas de prueba y comprobar si una ve o puede tocar datos de la otra. Esto lo
   hago en un entorno de pruebas o con datos ficticios, no con los datos de tus usuarios.
3. Revisar las reglas de acceso de cada tabla, las funciones y las claves.
4. Entregarte un informe con cada problema, su gravedad y el SQL para corregirlo, y repasarlo
   contigo en una llamada.

Te adjunto un informe de ejemplo (sobre una app inventada) para que veas el formato: [enlace].

Lo que no hago: no es una prueba de penetración completa ni cubre la lógica de pagos. Si
necesitas eso, te lo digo antes de empezar.

Precio cerrado: [290 €]. Entrega en [3 días laborables] desde que tenga acceso.

Para empezar necesito el acceso al repositorio, dos cuentas de prueba y tu autorización por
escrito (te paso un modelo de una página).

[Tu nombre]

### Versión en inglés de la respuesta

Hi [name],

You need [a security review of your Lovable + Supabase app before launch]. That is exactly
what I do.

What I would do, in order:

1. Check what someone without an account can read from your app.
2. Create two test accounts and check whether one can see or change the other's data. I do
   this in a staging environment or with dummy data, not with your users' data.
3. Review the access rules on every table, the functions and the keys.
4. Deliver a report with each issue, its severity and the SQL to fix it, and walk you through
   it on a call.

Here is a sample report (on a made-up app) so you can see the format: [link].

What I don't do: this is not a full penetration test and it does not cover payment logic. If
you need that, I will tell you before starting.

Fixed price: [€290]. Delivered within [3 working days] of getting access.

To start I need access to the repository, two test accounts and your written authorization (I
will send a one-page template).

[Your name]

## 5. Preguntas previsibles y respuestas honestas

**"Lovable ya tiene un escáner de seguridad."** Sí. Según lo publicado, comprueba que exista
una política, y después añadieron una revisión adicional. Lo que yo hago distinto es iniciar
sesión con dos cuentas y mirar qué recibe cada una. Si tu app pasa esa prueba, te lo diré y te
habrás gastado poco en saberlo.

**"Hay escáneres gratis."** Los hay, y conviene usarlos. Miran la app desde fuera, sin sesión.
El fallo más frecuente solo se ve con sesión iniciada.

**"¿Me garantizas que la app queda segura?"** No. Te garantizo que he hecho las comprobaciones
descritas y que te cuento qué encontré y qué no revisé.

**"¿Vas a ver los datos de mis usuarios?"** Para comprobar si una tabla se filtra hay que
descargar filas. Por eso la prueba se hace en un entorno de pruebas o con datos ficticios. Si
solo tienes producción, lo hablamos antes y lo dejamos por escrito.

**"¿Cuánta experiencia tienes?"** Responde con la verdad. Si es tu primera auditoría, dilo y
ofrece la primera a precio reducido o gratis a cambio de comentarios.

## 6. Dónde encontrar a los primeros interesados (sin spam)

Ninguna de estas vías se ha probado.

- **Encargos publicados** en Upwork, Contra o Malt que piden exactamente esto. Es responder a
  una petición, no contacto en frío.
- **Personas que ya conoces** que hayan construido algo con estas herramientas. La primera
  auditoría, gratis y con permiso, da el informe de muestra y la medida real de las horas.
- **Comunidades** de creadores con estas herramientas, respetando sus normas: responder
  preguntas sobre seguridad con información útil, sin promoción.
- **Agencias y freelances** que entregan apps hechas con IA: revisión independiente antes de
  entregar al cliente final.

Lo que no hay que hacer: mensajes en frío masivos, ni escanear apps ajenas sin permiso para
luego escribir al dueño con los fallos. Lo segundo, además de contraproducente, puede ser
delito.
