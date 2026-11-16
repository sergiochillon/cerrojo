# Material para Fiverr y Upwork

Textos listos para copiar. **No se ha publicado ningún gig ni se ha enviado ninguna
propuesta.** Los borradores en inglés parten de una redacción de Antigravity (Gemini 4 Argon),
corregida para que no afirme nada que hoy no sea cierto.

## Antes de publicar o enviar nada

- [ ] La herramienta está validada contra un Supabase real ([../validacion/LOCAL.md](../validacion/LOCAL.md)).
- [ ] Has hecho el trabajo una vez sobre una app real, con permiso, y tienes un informe de
      muestra anonimizado. El de `ejemplo-informe.html` es de una app ficticia: si lo usas,
      **dilo**.
- [ ] Sabes cuántas horas lleva y puedes cumplir el plazo que pongas.
- [ ] Puedes facturar.

Mientras alguna casilla esté sin marcar, estos textos describen algo que todavía no puedes
entregar con seguridad.

## Lo que no se dice nunca

1. **Nada de garantías**: ni "100% secure", ni "hack-proof", ni "GDPR/HIPAA compliant".
2. **Nada de experiencia inventada**: ni número de apps revisadas, ni años, ni clientes, ni
   estadísticas ajenas presentadas como propias.
3. **Nada de "auditoría", "pentest" ni "certificación"**. Es una comprobación acotada.
4. **Nada de enseñar fallos de una app que no te han encargado.** Escanear la web de alguien
   para luego escribirle es contrario a las normas de estas plataformas y puede ser delito.
5. **Nada de ocultar cómo se hace la prueba.** Si se trabaja sobre el proyecto desplegado, se
   avisa de que se leen filas de la base de datos.

---

## Fiverr: gig

Publicar un gig es gratuito. Fiverr obliga a fijar un **plazo de entrega** por paquete y cobra
comisión sobre cada venta: pon plazos que puedas cumplir con margen.

### Título (EN, 77 caracteres)

```
I will test if users can see each other's data in your Supabase app and fix it
```

### Categoría y etiquetas

Programming & Tech → Software Development → Bug Fixes (o Web Application).
Etiquetas: `supabase`, `lovable`, `row level security`, `postgres`, `bug fix`.

### Descripción (EN)

```
Built your app with Lovable, Bolt or Cursor on Supabase?

The only thing separating one user's data from another's is Row Level Security (RLS). The
common problem is not missing RLS. It is RLS that is "enabled" with a policy like
`auth.uid() is not null`, which lets ANY signed-in user read everyone's rows. The dashboard
shows the table as protected, and a scan from outside sees nothing wrong.

I check it the only reliable way: with two test accounts, looking at what each one actually
receives.

How I work
- I rebuild your database schema locally with made-up data. I do not need access to your
  database or your users' data, and I do not touch production.
- I test what a visitor without an account can read, what each of two accounts can read, and
  whether one account can modify the other's rows.
- I read your RLS policies, views and functions one by one.
- You get a clear report: what is wrong, why it matters, and the exact SQL to fix it.

What this is NOT
- Not a penetration test, a security audit or a certification.
- No guarantee that your app is secure. I tell you what I checked, what I found and what I
  did not review.
- Payments, business logic and non-Supabase backends are out of scope.
- I do not apply changes to your production database. You stay in control.

I use an open-source tool I wrote for this (cerrojo) plus manual review. This is a new
service: message me before ordering so I can confirm your app is a fit.
```

### Paquetes (EN)

| | Basic | Standard | Premium |
|---|---|---|---|
| Nombre | Isolation check | Full check | Check and fix |
| Precio | $55 | $195 | $390 |
| Incluye | Up to 5 tables. Access table (no account / account A / account B) and SQL fixes for critical issues. | Up to 15 tables and 10 Edge Functions. Manual review of policies, views and functions. Full report. | Everything in Standard, plus a fix migration applied and re-tested on the local replica, with before/after results. |
| Plazo | el que puedas cumplir | el que puedas cumplir | el que puedas cumplir |

### Preguntas frecuentes (EN)

```
Q: Will this guarantee my app cannot be hacked?
A: No. It checks the specific access rules described here and reports what was found and
what was not reviewed.

Q: Lovable already has a security scanner. Why this?
A: Use it, it is useful. As far as I know it checks that policies exist. I sign in with two
accounts and check what each one actually receives.

Q: Do you need access to my database or my users' data?
A: No. I work on a local copy built from your schema, with made-up data. If you would rather
have your deployed project tested, that test reads rows from your database, so we would do
it on a staging project and agree it in writing first.

Q: Do you apply the fixes to my production database?
A: No. I deliver a migration tested on the local copy and walk you through it. Applying it
is your decision.

Q: My app does not use Supabase from the browser. Is this for me?
A: Probably not. Message me first.
```

### Requisitos para el comprador (EN)

```
1. Read access to your repository (or a .zip of the code).
2. Your database schema WITHOUT data: `supabase db dump --schema public,storage -f schema.sql`
   (or the SQL of your tables and policies copied from the dashboard). Please do not send data.
3. A message confirming you own the project and authorise this review.
```

### Versión en español

**Título:** `Compruebo si los usuarios de tu app en Supabase ven datos ajenos y lo arreglo`

**Descripción:** el párrafo y las secciones "Cómo se trabaja", "Qué se entrega" y "Lo que no
incluye" de [OFERTA.md](OFERTA.md) sirven tal cual.

---

## Upwork

Enviar una propuesta consume "connects". **No se ha comprobado cuántos ni si los tienes
gratis.** Antes de enviar nada, mira el coste de cada propuesta y decide tú si lo gastas.

### Qué encargos responder

Solo los que cumplan todo esto:

- piden revisar o arreglar permisos, RLS, "security" o "prepare for production" en una app
  sobre **Supabase** (mejor si nombran Lovable, Bolt o Cursor);
- tienen presupuesto fijo visible o un método de pago verificado;
- no exigen certificaciones, experiencia demostrable en auditoría ni un informe de pentest;
- no piden nada que la herramienta no cubre como parte principal (pagos, app móvil nativa,
  otro backend).

Y ninguno que pida garantías de cumplimiento normativo (HIPAA, SOC 2): ese trabajo no es este.

### Propuesta (EN, unas 150 palabras)

```
Hi [name],

In Lovable + Supabase apps the usual problem is not missing RLS. It is RLS that is enabled
with a policy like `auth.uid() is not null`, which lets any signed-in user read everyone's
rows.

What I would do for [app name]:
1. Rebuild your schema locally with made-up data, so I never need access to your database.
2. Test with two accounts what each one can read and whether one can change the other's rows.
3. Read your policies, views and Edge Functions one by one.
4. Send you a report with each problem and the exact SQL to fix it, [and a fix migration
   tested on the local copy].

I use an open-source tool I wrote for this plus manual review. Sample report (on a demo app):
[link]

To be clear: this is a focused access check, not a penetration test or a security guarantee,
and it does not cover payment logic.

Fixed price: [amount].

[Your name]
```

### Propuesta (ES)

```
Hola, [nombre]:

En las apps hechas con Lovable sobre Supabase el problema habitual no es que falte RLS, sino
que esté activado con una regla como `auth.uid() is not null`, que deja a cualquier usuario
registrado leer las filas de todos.

Lo que haría con [nombre de la app]:
1. Reconstruir tu esquema en local con datos inventados: no necesito acceso a tu base de datos.
2. Probar con dos cuentas qué lee cada una y si una puede cambiar los datos de la otra.
3. Leer tus políticas, vistas y Edge Functions una a una.
4. Entregarte un informe con cada problema y el SQL exacto para arreglarlo [y la migración de
   corrección, probada en la copia local].

Uso una herramienta abierta que escribí para esto, más revisión manual. Informe de ejemplo
(sobre una app de demostración): [enlace]

Para que quede claro: es una comprobación acotada de permisos, no una prueba de penetración ni
una garantía de seguridad, y no cubre la lógica de pagos.

Precio cerrado: [importe].

[Tu nombre]
```

### Texto de perfil (EN)

```
I fix access-control problems in apps built with Lovable, Bolt or Cursor on Supabase: I test
with two accounts whether users can see or change each other's data, and I write the SQL that
fixes it. I work on a local copy of your schema with made-up data, so I do not need access to
your database. I wrote an open-source tool for this check: [repo link].
```

No añadas años de experiencia, número de clientes ni certificaciones que no tengas.

---

## Registro

Anota aquí cada propuesta o venta, para poder aplicar las reglas de
[REVISION-ESTRATEGICA.md](REVISION-ESTRATEGICA.md):

| Fecha | Plataforma | Encargo | Precio ofrecido | Coste de enviarla | Resultado |
|---|---|---|---|---|---|
| | | | | | |
