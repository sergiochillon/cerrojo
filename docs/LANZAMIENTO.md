# Material de lanzamiento (preparado, sin publicar)

**No se ha publicado nada**: ni el repositorio, ni la página, ni ningún anuncio. Este documento
reúne lo que haría falta y lo que hay que comprobar antes.

## 1. Qué hay preparado

| Pieza | Dónde | Estado |
|---|---|---|
| Código y pruebas | raíz del proyecto | Listo para revisar. Commits solo locales; no hay remoto configurado. |
| Demo local | `npm run demo`, `npm run demo:servidor` | Funciona sin red ni cuentas. |
| Informe de ejemplo | [ejemplo-informe.html](ejemplo-informe.html), [sample-report.html](sample-report.html) | Generado con la app ficticia. |
| Página de presentación | [index.html](index.html) | Borrador. Falta contacto; lleva franja de "borrador". |
| Oferta y precio | [OFERTA.md](OFERTA.md) | Hipótesis sin contrastar. |
| Guía de revisión | [GUIA-REVISION-MANUAL.md](GUIA-REVISION-MANUAL.md) | Sin probar en una auditoría real. |
| Autorización | [AUTORIZACION.md](AUTORIZACION.md) | Modelo orientativo, sin revisión legal. |

## 2. Lista previa a publicar

Publicar solo cuando **todas** estén marcadas.

**Validación**

- [ ] Herramienta probada contra un proyecto Supabase real **propio**, con datos ficticios, y
      corregidas las diferencias con la emulación (ver [LIMITACIONES.md](LIMITACIONES.md), §1).
- [ ] `npm test` en verde después de esas correcciones.
- [ ] Al menos una auditoría completa hecha con permiso sobre una app real, para saber si la
      guía y los tiempos se sostienen.

**Contenido**

- [ ] Ninguna afirmación sin respaldo: sin "el primero", sin cifras de apps auditadas, sin
      clientes ni testimonios. Hoy no hay ninguno.
- [ ] El README sigue diciendo con claridad qué no está validado.
- [ ] La página deja claro qué no incluye el servicio.
- [ ] Sustituido `[CONTACTO]` en `index.html` y quitada la franja de borrador.
- [ ] Decidido el titular de la licencia en `LICENSE` (ahora dice "los autores de cerrojo").

**Secretos y datos personales**

- [ ] `git log --format='%an <%ae>' | sort -u` muestra solo la dirección `noreply` de GitHub.
- [ ] Búsqueda de secretos en todo el historial sin resultados (orden en el apartado 5).
- [ ] La carpeta `salida/` no está versionada y no hay resultados de auditorías reales.
- [ ] El informe de ejemplo procede de la demo, no de una app real.

**Coste y cuentas**

- [ ] El repositorio es nuevo y público en una cuenta ya autenticada; no se toca ningún otro.
- [ ] Si se publica la página con GitHub Pages: es gratuita para repositorios públicos.
      Comprobar que no se activa nada de pago.
- [ ] Ningún servicio con prueba gratuita que se renueve con cargo.

**Responsabilidad**

- [ ] Poder facturar conforme a la normativa que te aplique.
- [ ] Condiciones de servicio con alcance y limitación de responsabilidad.

## 3. Textos para el repositorio

**Descripción corta (ES)**

> Auditoría de seguridad para apps hechas con IA sobre Supabase: comprueba con dos cuentas de
> prueba si RLS aísla de verdad a los usuarios, y genera un informe con los arreglos.

**Descripción corta (EN)**

> Security audit for AI-built apps on Supabase: uses two test accounts to check whether RLS
> actually isolates users, and produces a report with fixes.

**Temas**: `supabase`, `row-level-security`, `security-audit`, `lovable`, `postgres`.

## 4. Borradores de anuncio

Breves y sin promesas. Para publicar en un perfil propio, no para enviar por mensaje directo.

**Español**

> He publicado cerrojo, una herramienta abierta para revisar la seguridad de apps hechas con
> IA sobre Supabase.
>
> Parte de una idea sencilla: que RLS esté "activado" no significa que funcione. La regla
> `auth.uid() is not null` deja pasar a cualquier usuario registrado, y desde fuera no se nota.
> cerrojo inicia sesión con dos cuentas de prueba y comprueba si una recibe datos de la otra.
>
> Incluye una app ficticia vulnerable para probarla en local sin tocar nada real.
>
> Es una primera versión: [enlace al repositorio]. Sus límites están escritos en el README.

**Inglés**

> I've released cerrojo, an open tool for reviewing the security of AI-built apps on Supabase.
>
> The idea is simple: RLS being "enabled" doesn't mean it works. A policy like
> `auth.uid() is not null` lets any signed-up user through, and you can't tell from outside.
> cerrojo signs in with two test accounts and checks whether one receives the other's data.
>
> It ships with a deliberately vulnerable demo app so you can try it locally without touching
> anything real.
>
> It's a first version: [repo link]. Its limits are written down in the README.

Lo que estos textos evitan a propósito: decir cuántas apps tienen el fallo (las cifras que
circulan vienen de vendedores de escáneres), decir que la herramienta está probada en
producción y anunciar el servicio de pago antes de haberlo hecho una vez.

## 5. Órdenes de comprobación

```bash
npm test
```

```bash
git log --format='%an <%ae>' | sort -u
```

```bash
git grep -nIE "eyJ[A-Za-z0-9_-]{20,}\.eyJ|sb_secret_[A-Za-z0-9]|sk_live_[A-Za-z0-9]|sk-(proj|ant)-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY" $(git rev-list --all)
```

La última no debe devolver nada: las claves falsas de la demo se generan al arrancar y no
están en el repositorio.

## 6. Orden sugerido de pasos

1. Validar contra un Supabase propio y corregir.
2. Primera auditoría gratuita y con permiso; medir horas.
3. Ajustar oferta, guía y precio con lo aprendido.
4. Repasar la lista del apartado 2.
5. Publicar el repositorio. La página y el anuncio, después y por separado.
