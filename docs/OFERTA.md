# Oferta, hipótesis de precio y textos de presentación

Todo lo de este documento es una **hipótesis de trabajo**. No hay ningún cliente, ninguna venta
ni ninguna conversación con compradores detrás. Los precios observados proceden de anuncios y
encargos de terceros citados en [INVESTIGACION.md](INVESTIGACION.md). El porqué de esta versión
está en [REVISION-ESTRATEGICA.md](REVISION-ESTRATEGICA.md).

**No lo ofrezcas todavía.** Antes hay que validar la herramienta contra un Supabase real
([../validacion/LOCAL.md](../validacion/LOCAL.md)) y haber hecho el trabajo una vez, gratis y
con permiso, para tener un informe de muestra de verdad y saber cuántas horas lleva.

## 1. Qué se vende

**Comprobar si los usuarios de tu app pueden ver o cambiar datos de otros usuarios, y
arreglarlo.**

No es una "auditoría de seguridad". Es un trabajo de desarrollo acotado, con un resultado que
el cliente puede comprobar: la misma prueba, con dos cuentas, antes y después.

Para quién: personas que han construido una app con Lovable, Bolt, Cursor o similares sobre
Supabase, no son especialistas, y van a abrirla a usuarios reales o ya la tienen abierta.
También agencias y freelances que entregan este tipo de apps a terceros.

No es para: equipos con responsable de seguridad, ni apps que no usan Supabase desde el
navegador.

## 2. Cómo se trabaja

Sobre una **réplica local** de su proyecto ([REPLICA-LOCAL.md](REPLICA-LOCAL.md)):

- el cliente entrega su código y su esquema, **sin datos**;
- se reconstruye en un Supabase local con usuarios y filas inventados;
- todas las pruebas se hacen ahí. **No hace falta acceso a su base de datos ni a los datos de
  sus usuarios, y no se toca producción.**

Si el cliente prefiere que se compruebe su proyecto desplegado, se puede, y entonces hay que
decirle antes y por escrito que la prueba lee filas de su base de datos (hasta 1.000 por
cuenta y tabla), que debe hacerse en un entorno de pruebas o con datos ficticios, y que la
escritura no se prueba.

## 3. Qué se entrega

1. Una tabla por cada tabla de la app: qué lee alguien sin cuenta, qué lee cada una de las dos
   cuentas de prueba y si una puede modificar lo de la otra.
2. Cada problema con dónde está, qué se observó, por qué importa y el SQL exacto para
   arreglarlo. Formato: [ejemplo-informe.html](ejemplo-informe.html) (sobre una app ficticia).
3. La lista de lo que **no** se revisó.
4. En el nivel con arreglos: la migración SQL de corrección, aplicada y vuelta a probar en la
   réplica, con el antes y el después.

Lo que no incluye, y se dice antes de cobrar: no es una prueba de penetración, no cubre pagos
ni lógica de negocio, no es una certificación y no garantiza que la app sea segura. La
corrección se entrega probada en la réplica; **aplicarla en producción lo decide y lo hace el
cliente**.

## 4. Hipótesis de precio

### Referencias observadas (de terceros, sin verificar ventas)

| Referencia | Precio |
|---|---|
| Revisión productizada de app hecha con IA | 99 $ |
| Encargos publicados para auditar o preparar para producción una app Lovable + Supabase | 150–400 $, 500 $ y 1.000 $ |
| "Pen test" de app generada en 48 h, con ampliación | 497 $ → 1.250 $ |
| Encargos de revisión y puesta en producción (búsqueda de Antigravity, sin enlaces verificados por mí) | 300–1.500 $ |

### Propuesta

| Nivel | Qué incluye | Precio hipotético (sin IVA) |
|---|---|---|
| **Comprobación** | Hasta 5 tablas. La tabla de acceso real (sin cuenta, cuenta A, cuenta B) y el SQL para corregir lo crítico. | **49 €** |
| **Comprobación completa** | Hasta 15 tablas y 10 Edge Functions. Lo anterior más revisión manual de políticas, vistas y funciones, e informe completo. | **190 €** |
| **Comprobación y arreglo** | Lo anterior más la migración de corrección, aplicada y verificada en la réplica, con el antes y el después. | **390 €** |

Por qué estos números y no los anteriores (290 / 590 / 90 €):

- **49 € es un precio de entrada, no un negocio.** Sirve para que alguien pruebe a un perfil
  sin reseñas. Con 3–5 horas de trabajo real, sale a pérdida. Es el coste de la primera reseña.
- **190 € y 390 €** quedan dentro del rango de los encargos observados (150–500 $) y por
  debajo de los que piden revisión a fondo (1.000 $).
- El valor está en el tercer nivel: quien no programa no quiere un informe, quiere el problema
  resuelto.
- Con las horas estimadas en [REPLICA-LOCAL.md](REPLICA-LOCAL.md) (4–9 h), 390 € son 45–95 €
  por hora. **Las horas no están medidas.**

### Cómo saber si el precio está bien

Reglas fijadas antes de empezar (más detalle en REVISION-ESTRATEGICA.md):

- Si los tres primeros compradores del nivel de 49 € quedan satisfechos, subirlo a 79 €.
- Si nadie compra a 49 €, el problema no es el precio: ofrecer la primera gratis a cambio de
  reseña y permiso para usar el informe anonimizado.
- Si la primera entrega del nivel completo pasa de 12 horas, reducir alcance o subir precio.

### Costes y condiciones sin resolver

- **Herramientas:** 0 €.
- **Canales:** un gig en Fiverr es gratis de publicar; la plataforma se queda una comisión de
  cada venta. Proponer en Upwork consume "connects", que pueden costar dinero. **No se ha
  verificado ni gastado nada.**
- **Facturar:** cobrar exige poder emitir factura según tu situación fiscal. No analizado.
- **Responsabilidad:** aunque no se llame auditoría, un cliente puede reclamar si después hay
  un incidente. Hacen falta condiciones con alcance y limitación de responsabilidad. No es
  asesoramiento jurídico.

## 5. Textos

Los textos para Fiverr y Upwork, en inglés y español, están en
[MARKETPLACES.md](MARKETPLACES.md).

### Una línea

Compruebo con dos cuentas si tus usuarios pueden ver datos de otros usuarios, y lo arreglo.

### Párrafo

En las apps hechas con Lovable, Bolt o Cursor sobre Supabase, lo único que separa a un usuario
de los datos de otro son las reglas de acceso de cada tabla (RLS). El fallo habitual no es que
falten: es que están activadas con una condición que deja pasar a cualquiera que haya iniciado
sesión. El panel dice "protegido" y un usuario registrado lee los datos de todos. Yo lo
compruebo de la única forma fiable: con dos cuentas, mirando qué recibe cada una. Trabajo
sobre una copia local de tu proyecto con datos inventados, así que no necesito acceso a tu
base de datos. Te entrego qué falla, por qué y el SQL que lo arregla.

## 6. Preguntas previsibles y respuestas honestas

**"Lovable ya tiene un escáner."** Sí, y conviene pasarlo. Según lo publicado, comprueba que
haya políticas; lo que yo hago es iniciar sesión con dos cuentas y ver qué recibe cada una. Si
tu app pasa la prueba, te lo digo y te habrá costado poco saberlo.

**"¿Me garantizas que queda segura?"** No. Te garantizo que hago las comprobaciones descritas,
te enseño el resultado y te digo qué no he revisado.

**"¿Vas a ver los datos de mis usuarios?"** No, si trabajamos sobre la réplica: solo necesito
tu código y tu esquema, sin datos. Si prefieres que pruebe tu proyecto desplegado, la prueba
lee filas de tu base, y entonces lo hacemos en un entorno de pruebas y lo dejamos por escrito.

**"¿Aplicas tú los cambios en mi base de datos?"** No. Te entrego la migración probada en la
réplica y te acompaño al aplicarla, pero la decisión y la ejecución en producción son tuyas.

**"¿Cuánta experiencia tienes?"** La verdad. Si es de los primeros trabajos, se dice, y por eso
el precio de entrada es el que es.

**"La herramienta es gratis, ¿por qué te pago?"** Porque la herramienta encuentra una parte, y
el trabajo es montar la réplica, sembrar los datos, leer las políticas y las funciones una a
una, escribir el arreglo y comprobar que funciona sin romper la app.
