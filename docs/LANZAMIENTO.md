# Lanzamiento: qué está publicado y qué no

## Estado

| Pieza | Estado |
|---|---|
| Repositorio público con el código, las pruebas y la documentación | **Publicado** el 16-nov-2026 |
| Página del proyecto (`docs/index.html`, GitHub Pages) | **Publicada** el 16-nov-2026 |
| Gig en Fiverr | **No publicado.** Textos en [MARKETPLACES.md](MARKETPLACES.md). |
| Propuestas en Upwork | **Ninguna enviada.** Textos en [MARKETPLACES.md](MARKETPLACES.md). |
| Anuncio en redes | **No publicado.** Borradores abajo. |

## Publicado

- Repositorio: <https://github.com/sergiochillon/cerrojo> (público, nuevo, sin relación con
  otros proyectos).
- Página: <https://sergiochillon.github.io/cerrojo/> (GitHub Pages, carpeta `docs/`; lleva
  `noindex`, así que no aparece en buscadores: sirve para enlazarla).
- Informe de ejemplo: <https://sergiochillon.github.io/cerrojo/ejemplo-informe.html> y
  <https://sergiochillon.github.io/cerrojo/sample-report.html>.
- Integración continua: las pruebas y la demo se ejecutan en cada cambio (GitHub Actions,
  gratuito en repositorios públicos).

La página menciona el servicio como "en preparación", con precios orientativos, y dice
expresamente que aún no se ha prestado a ningún cliente. El contacto es una solicitud pública
en GitHub.

**Para retirarlo:** `gh repo delete sergiochillon/cerrojo` borra el repositorio y la página.
Para ocultar solo la página: Settings → Pages → Unpublish.

## Condiciones que se comprobaron para publicar el repositorio y la página

- Gratuito: repositorio público y GitHub Pages, sin planes de pago ni pruebas con renovación.
- Cuenta ya autenticada con la herramienta oficial (`gh`).
- Repositorio nuevo, separado de cualquier otro proyecto.
- Sin secretos: las claves falsas de la demo se generan al arrancar y no están en el código.
- Sin datos personales: los commits usan la dirección `noreply` de GitHub y la licencia no
  lleva nombre propio. El nombre de usuario de GitHub es visible, como en cualquier
  repositorio público.
- Sin afirmaciones sin respaldo: el README y la página dicen que la herramienta no está
  validada contra un Supabase real y que el servicio no se ha prestado todavía.

## Por qué no se ha publicado una oferta en Fiverr ni se han enviado propuestas

1. El servicio no se ha prestado nunca. Publicar hoy un gig con plazos de entrega sería
   comprometerse a algo cuya duración no se conoce.
2. La herramienta no está validada contra un Supabase real.
3. En Upwork enviar una propuesta consume "connects"; no se ha verificado su coste.
4. Desde la sesión automática, Upwork respondió con una verificación anti-bots y Fiverr no
   tenía sesión iniciada.

## Antes de publicar el gig o enviar una propuesta

- [ ] Validación contra un Supabase local hecha ([../validacion/LOCAL.md](../validacion/LOCAL.md))
      y diferencias corregidas.
- [ ] Un trabajo completo hecho sobre una app real, gratis y con permiso
      ([REPLICA-LOCAL.md](REPLICA-LOCAL.md)), con las horas apuntadas.
- [ ] Informe de muestra real y anonimizado, o el de la app ficticia presentado como lo que es.
- [ ] Puedes facturar y tienes unas condiciones con alcance y limitación de responsabilidad.
- [ ] Has leído "Lo que no se dice nunca" en [MARKETPLACES.md](MARKETPLACES.md).

## Borradores de anuncio

Para un perfil propio, no para enviar por mensaje directo. Publícalos solo cuando la
validación esté hecha, o deja la frase que dice que no lo está.

**Español**

> He publicado cerrojo, una herramienta abierta para comprobar si los usuarios de una app
> hecha con IA sobre Supabase pueden ver datos de otros usuarios.
>
> La idea: que RLS esté "activado" no significa que funcione. La regla
> `auth.uid() is not null` deja pasar a cualquier usuario registrado, y desde fuera no se nota.
> cerrojo inicia sesión con dos cuentas de prueba y compara lo que recibe cada una.
>
> Incluye una app ficticia vulnerable para probarla en local. Es una primera versión y todavía
> no está validada contra un Supabase real; sus límites están escritos en el README.
>
> [enlace]

**Inglés**

> I've released cerrojo, an open tool that checks whether users of an AI-built app on Supabase
> can see each other's data.
>
> The idea: RLS being "enabled" doesn't mean it works. A policy like `auth.uid() is not null`
> lets any signed-up user through, and you can't tell from outside. cerrojo signs in with two
> test accounts and compares what each one receives.
>
> It ships with a deliberately vulnerable demo app you can run locally. It's a first version,
> not yet validated against a real Supabase project; its limits are written down in the README.
>
> [link]

## Comprobaciones previas a cualquier publicación

```bash
npm test
```

```bash
git log --format='%an <%ae>' | sort -u
```

```bash
git grep -nIE "eyJ[A-Za-z0-9_-]{20,}\.eyJ|sb_secret_[A-Za-z0-9]{8}|sk_live_[A-Za-z0-9]{8}|sk-(proj|ant)-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}" $(git rev-list --all)
```

La última no debe devolver nada.
