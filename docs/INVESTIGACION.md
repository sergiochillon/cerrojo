# Investigación y elección de oportunidad

Fecha de la investigación: **14 de noviembre de 2026**. Hecha con búsqueda web y lectura de
páginas públicas, más tres subagentes de solo lectura. No se ha hablado con ningún comprador:
**todo lo que sigue son señales públicas, no clientes validados**.

Convención usada en este documento:

- **Señal pública**: alguien dice que hay demanda (encuestas, artículos, precios publicados por
  vendedores). No demuestra que nadie compre.
- **Intención de compra observada**: un comprador ha publicado un encargo con presupuesto.
  Es la evidencia más fuerte que se puede obtener sin hablar con clientes, pero tampoco es una
  venta.

## 1. Comparación de oportunidades

Escala cualitativa: alta / media / baja. "Cobro en 30 días" es una estimación mía partiendo de
cero audiencia, no un dato.

| # | Oportunidad | Evidencia de demanda | Urgencia | Competencia | Diferencia concreta posible | Cobro en 30 días | Construcción | Coste | Llegar al comprador |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Auditoría de seguridad para apps hechas con IA** (Lovable/Bolt/Cursor + Supabase) | **Intención observada**: encargos con presupuesto de 150–1.000 $ | Alta en el momento de lanzar o tras un susto | Alta (muchos escáneres gratis; servicios de 99–1.250 $) | Probar si el aislamiento entre usuarios *funciona* (no solo si RLS existe) + informe y arreglos en español | Media | ≤48 h | 0 € | Respondiendo a encargos publicados; comunidades de creadores |
| 2 | Validador / revisión Veri\*factu para software a medida | Señal pública; un competidor exacto a 149 € | **Baja**: aplazamiento anunciado a oct-2028 | Muy alta (≥5 validadores gratis, APIs comerciales) | Auditor de cadenas completas y del PDF | Baja | ≤48 h | 0 € | GitHub, foros de desarrolladores |
| 3 | Auditoría de accesibilidad web productizada (Ley 11/2023) | Señal pública: precios de 290–490 € publicados por vendedores | Baja: sin sanciones conocidas en España | Media-alta, fragmentada | Marca blanca para agencias; lista de arreglos por plataforma | Baja-media | ≤48 h | 0 € | Contacto directo con agencias |
| 4 | Informe GEO/AEO (visibilidad en buscadores de IA) | Señal pública + encargos a 50 $ | Media | Muy alta, "rebranding oportunista" | Informe puntual en español sin suscripción | Media-baja | ≤48 h | APIs de LLM (de pago) | Comunidades SEO |
| 5 | Auditoría de ficha de Google / reseñas para negocio local | Intención observada (p. ej. 750 $/mes por 8 fichas) | Baja | Alta (BrightLocal, Localo…) | Poca | Baja sin venta en persona | ≤48 h | 0 € | Puerta a puerta |
| 6 | Automatización para asesorías (WhatsApp, n8n, extracción de facturas) | Señal pública (encuesta de vendedor) | Media | Alta | Vertical muy concreto | Baja: venta por confianza, ciclo largo | >48 h con integraciones | Variable | Contacto directo |
| 7 | Herramientas para la factura electrónica B2B obligatoria | Norma firme | Baja hoy (oct-2027 / oct-2028) | Alta + solución pública gratuita | Validador del formato español | Baja | Incierta (norma muy reciente) | 0 € | Venta a empresa grande |
| 8 | Microproductos para desarrolladores (skills, plugins) | Débil; casi todo gratis o 5–15 € | Baja | Alta | Poca | Baja sin audiencia | ≤48 h | 0 € | Requiere audiencia |

## 2. Elección: opción 1

**Auditoría de seguridad previa al lanzamiento para apps construidas con herramientas de IA
sobre Supabase**, a precio fijo, con una herramienta propia que hace el trabajo repetible.

### Por qué

1. **Es la única opción con intención de compra observada y presupuesto visible.** Encargos
   publicados en Upwork de 500 $ fijos, de 150–400 $ y de 1.000 $ para auditar apps hechas con
   Lovable + Supabase (enlaces en la sección 4). Hay también oferta productizada con precio:
   99 $, 497 $ en 48 h, 1.250 $.
2. **El problema está documentado y es recurrente.** CVE-2025-48757 (políticas RLS ausentes o
   insuficientes en proyectos generados por Lovable). Un estudio longitudinal de un proveedor
   (feb–abr 2026) sostiene que cada funcionalidad nueva añadida tras el lanzamiento vuelve a
   abrir huecos de autorización.
3. **Hay un hueco técnico concreto.** Según lo publicado, el escáner integrado de Lovable
   comprobaba que existiera *alguna* política RLS, no que fuera correcta; Lovable añadió
   después el Security Advisor de Supabase y una revisión con IA, reconociendo que el Advisor
   puede no detectar un uso incorrecto. Uno de los encargos de 1.000 $ rechaza expresamente
   "escáner automático + PDF". Lo que falta es **probar el aislamiento con cuentas reales** y
   revisar la lógica de las políticas.
4. **Coste cero y entrega rápida**: no necesita APIs de pago ni infraestructura.

### Límites de esta elección (importantes)

- **No he validado ningún cliente.** Los encargos citados son de terceros, pueden estar ya
  cerrados y reciben 20–50 propuestas cada uno.
- **Vender seguridad exige competencia y asumir responsabilidad.** La herramienta encuentra
  una clase concreta de fallos; no convierte a nadie en auditor. Un informe debe decir siempre
  qué *no* se ha revisado.
- **No he encontrado evidencia de demanda específica en español.** Que no haya oferta en
  español puede ser un hueco o puede significar que no hay mercado. Es una hipótesis a probar.
- **Los escáneres gratuitos presionan el precio** de la parte automática. Por eso el precio se
  apoya en la revisión manual y los arreglos, no en el escaneo.
- **Responder a encargos en Upwork consume "connects"**, que pueden costar dinero. No lo he
  verificado y no he gastado nada.
- Las fuentes sobre precios y sobre frecuencia de fallos son en su mayoría **vendedores de
  escáneres o de auditorías**, con interés en exagerar el problema.

## 3. Por qué se descartó Veri\*factu (la candidata inicial)

Fue la primera hipótesis por el plazo legal del 1-ene-2027, y llegué a leer las
especificaciones oficiales y a reproducir los tres vectores de prueba de la huella. Se descartó
al verificar dos hechos:

1. **Hacienda anunció el 5-oct-2026 su intención de aplazar a octubre de 2028** las
   obligaciones pendientes del RD 1007/2023, para alinearlas con la factura electrónica, y de
   modificar después "ciertos aspectos técnicos". La nota oficial dice que las garantías se
   mantendrán "en términos sustancialmente equivalentes". A 14-nov-2026 **no he encontrado la
   norma en el BOE**, así que legalmente siguen vigentes el 1-ene-2027 (Impuesto sobre
   Sociedades) y el 1-jul-2027 (resto). Hay elecciones generales el 29-nov-2026 (dato de
   fuentes secundarias). El mercado está en modo "esperar".
2. **El validador ya existe gratis** al menos en cinco sitios (dos webs y tres repositorios,
   tres de ellos aparecidos en sep–oct de 2026), y hay un servicio de diagnóstico de software a
   medida a 149 € + IVA.

Si el aplazamiento no llegara a publicarse antes del 31-dic-2026 habría una urgencia real en
diciembre para sociedades con software a medida. Lo considero poco probable y no es el caso
base.

## 4. Fuentes consultadas

Todas consultadas el 14-nov-2026. La fecha entre paréntesis es la de la fuente cuando consta.

### Auditoría de seguridad de apps hechas con IA

- Encargo, 500 $ fijos, auditoría de app Lovable + Supabase (cliente dado de alta en jul-2026):
  <https://www.upwork.com/freelance-jobs/apply/Security-Audit-Lovable-Supabase-SaaS-App-Travel-Advisor-Platform_~022078178007613336761/>
- Encargo, 150–400 $:
  <https://www.upwork.com/freelance-jobs/apply/Lovable-Supabase-Developer-Needed-Audit-and-Prepare-Healthcare-SaaS-Prototype-for-Production_~022118049727557515558/>
- Encargo, 1.000 $, rechaza "escáner automático + PDF": <https://www.upwork.com/jobs/~022068302065525809185>
- Oferta productizada a 99 $ (28-mar-2026):
  <https://dev.to/solobillions/what-a-1000-code-review-actually-finds-in-lovable-and-claude-code-apps-3247>
- Oferta de 497 $ en 48 h, ampliable a 1.250 $:
  <https://contra.com/s/EAOmEkoU-vibe-coded-app-pen-test-find-critical-flaws-in-48-hours>
- Limitación del escáner integrado de Lovable (existencia frente a corrección de RLS):
  <https://analyticsindiamag.com/ai-features/when-replit-employees-found-a-critical-security-vulnerability-in-lovable>
- CVE-2025-48757 y contexto: <https://www.superblocks.com/blog/lovable-rls-breach>
- Muestra de 62 apps auditadas por un particular (63 % con fallos críticos o altos; un solo
  autor, sin revisión): <https://medium.com/@jacobp96/i-scanned-over-50-lovable-apps-for-security-vulnerabilities-d05b2ad94006>
- Estudio longitudinal de un proveedor sobre regresiones tras el lanzamiento (feb–abr 2026):
  <https://vibe-eval.com/data-studies/lovable-regression-longitudinal-study/>
- Escáneres gratuitos existentes (competencia): <https://unpwned.io/platforms/lovable>,
  <https://vibeappscanner.com/lovable-security>,
  <https://dev.to/perufitlife/10-free-security-scanners-for-the-most-popular-baas-platforms-2026-edition-51lh>
- Demanda de habilidades de IA en Upwork (informe del propio marketplace):
  <https://www.upwork.com/research/in-demand-skills-2026>

Aviso: Upwork devolvió error 403 al abrir las páginas directamente; los datos de los encargos
proceden de fragmentos de buscador y **no he podido confirmar su estado actual**.

### Datos técnicos de Supabase usados para construir

- Claves de API (formatos `sb_publishable_` / `sb_secret_`, claves JWT heredadas, retirada
  prevista a finales de 2026): <https://supabase.com/docs/guides/api/api-keys>
- La especificación OpenAPI deja de servirse con la clave anónima (11-mar-2026 proyectos
  nuevos, 8-abr-2026 todos):
  <https://supabase.com/changelog/42949-breaking-change-removing-access-to-openapi-spec-via-the-anon-key>
- Las tablas nuevas ya no se exponen automáticamente a la API de datos:
  <https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically>

### Veri\*factu y factura electrónica

- Nota del Ministerio de Hacienda (5-oct-2026), previsión de aplazamiento a octubre de 2028:
  <https://www.hacienda.gob.es/sgt/gabsehacienda/nota-informativa-verifactu.pdf>
- Nota de la AEAT con los plazos legales vigentes (página actualizada el 13-oct-2026):
  <https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/nota-informativa-ampliacion-plazo-adaptacion-facturacion.html>
- Portada de Veri\*factu en la AEAT (actualizada el 3-nov-2026):
  <https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html>
- Especificación de la huella, v0.1.2 (27-08-2024):
  <https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf>
- Especificación del QR, v0.5.0 (10-12-2025):
  <https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf>
- Validaciones y errores, v1.2.2 (08-04-2026):
  <https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Validaciones_Errores_Veri-Factu.pdf>
- Validadores gratuitos ya existentes: <https://validatefin.com/es/tools/verifactu>,
  <https://verifactu.co/laboratorio/>, <https://github.com/eiieval/verifactu-tools>
- Diagnóstico de software a medida a 149 € + IVA: <https://cirameva.com/software/verifactu/>
- Análisis de terceros sobre el estado del aplazamiento: <https://erpia.es/verifactu-aplazamiento>,
  <https://www.dsi-net.com/verifactu-aplazamiento-2028/> (4-nov-2026)
- Real Decreto 238/2026, factura electrónica B2B (BOE 31-mar-2026):
  <https://www.boe.es/buscar/act.php?id=BOE-A-2026-7295>
- Orden HAC/1028/2026 (BOE 5-oct-2026): <https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-20587>

### Otras opciones evaluadas

- Accesibilidad, precios publicados: <https://acuareladigital.com/es/servicios/consultoria-en-accesibilidad-web/>,
  <https://kalymastudio.es/soluciones/accesibilidad-web/>,
  <https://jcpaginasweb.com/servicios/accesibilidad-web-sevilla>
- Accesibilidad, unidad de vigilancia creada por RD 143/2026 (15-ago-2026):
  <https://tododisca.es/accesibilidad/espana-ya-tiene-a-quien-reclamar-cuando-un-producto-o-un-servicio-no-es-accesible-el-boe-crea-la-unidad-que-vigila-la-ley-11-2023/>
- GEO, encuesta de un vendedor a 494 profesionales (14-sep-2026):
  <https://agencyanalytics.com/blog/ai-search-visibility>
- GEO, precios en España (13-oct-2026):
  <https://www.cyberclick.es/numerical-blog/como-montar-un-servicio-de-auditoria-geo-para-tus-clientes>
- GEO, saturación del mercado español (13-mar-2026):
  <https://www.marketingdirecto.com/imprescindibles/imprescindibles-digital/las-10-mejores-agencias-geo-de-espana-en-2026-primer-ranking-con-baselines-en-4llms>
- Negocio local, encargo de 750 $/mes:
  <https://www.upwork.com/freelance-jobs/apply/Local-SEO-Google-Business-Profile-Audit_~022068567509018318313/>
- Asesorías, encuesta de Holded a 194 despachos:
  <https://www.holded.com/es/blog/encuesta-impacto-normativo-2026-2027>

## 5. Proyectos de IA que han llamado la atención (punto secundario)

No he dedicado búsquedas específicas a esto: la prioridad era la vía de cobro y el presupuesto
de investigación era limitado. Lo que apareció de pasada es que **en este nicho la atención la
generan los estudios con datos propios** ("escaneé N apps y esto encontré"), no la herramienta
en sí. Queda apuntado como posible contenido posterior, y solo con apps cuyos dueños lo
autoricen. No afirmo que nada de lo construido aquí sea "el primero".

## 6. Antigravity

No está conectado a este entorno, así que **no se ha usado** para revisar el MVP.
