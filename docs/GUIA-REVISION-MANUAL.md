# Guía de revisión manual

Las herramientas encuentran una parte. Esta guía cubre el resto: cómo preparar la revisión,
qué mirar a mano, cómo confirmar cada hallazgo antes de escribirlo y cómo entregarlo.

Es un procedimiento de partida, **no probado todavía en una auditoría real**. Ajústalo con lo
que aprendas en la primera.

Regla general: **no se afirma nada que no se haya visto.** Un patrón que coincide es una pista;
un hallazgo es algo que has abierto, leído y entendido.

## 0. Antes de empezar

- [ ] Autorización firmada ([AUTORIZACION.md](AUTORIZACION.md)) con alcance, fechas y entorno.
- [ ] Acordado **dónde** se hace la prueba de aislamiento, por este orden de preferencia:
  1. un proyecto de pruebas (staging) con datos ficticios;
  2. una rama o copia del proyecto cargada con datos ficticios;
  3. producción, solo si no hay alternativa, por escrito, con cuentas de prueba nuevas y
     `--limite` bajo.
- [ ] Dos cuentas de prueba, A y B, **con datos creados por cada una** en todas las pantallas
      de la app (sin datos propios, la prueba no concluye nada).
- [ ] Si la app tiene roles (administrador, miembro, invitado) u organizaciones: una cuenta
      por rol y dos organizaciones distintas.
- [ ] Acceso de lectura al repositorio.
- [ ] Un contacto del titular al que avisar si aparece algo grave.
- [ ] Una carpeta de trabajo fuera de cualquier repositorio para los resultados.

## 1. Pasada automática (30–45 min)

```bash
node bin/cerrojo.js web https://app.example --autorizo --salida salida/web.json
node bin/cerrojo.js aislamiento --autorizo --desde salida/web.json --salida salida/aislamiento.json
node bin/cerrojo.js repo ../repo-del-cliente --salida salida/repo.json
```

- Las credenciales de A y B van en variables de entorno, no en la orden.
- **No uses `--probar-escritura`** contra el proyecto del cliente: la herramienta lo impide.
  Solo tiene sentido si levantas una copia local desechable con `supabase start`.
- Anota qué tablas han salido "no concluyente" o "sin columna de dueño": son trabajo manual.
- Si aparece una exposición grave de datos reales, **para y avisa al contacto**. No sigas
  descargando.

## 2. Inventario: que no falte ninguna tabla (20 min)

`web` solo conoce las tablas que aparecen en el JavaScript. Completa la lista:

- [ ] Pide al titular la lista de tablas del panel (Table Editor) o un volcado del esquema:
      `supabase db dump --schema public`.
- [ ] Compara con el inventario de `repo` y con la superficie de `web`.
- [ ] Repite `web` y `aislamiento` con `--tablas` para las que faltaban.
- [ ] Si lo que hay en el panel no coincide con las migraciones, las migraciones no son
      fiables: revisa las políticas en el volcado, no en el repositorio.

## 3. Políticas RLS, tabla por tabla (60–90 min)

Para cada tabla, responde por escrito a cuatro preguntas: quién puede **leer**, **insertar**,
**modificar** y **borrar**, y si eso es lo que el negocio quiere.

- [ ] ¿RLS activado? ¿Hay política para cada operación que la app usa?
- [ ] ¿La condición compara con el dueño (`auth.uid() = user_id`) o solo exige sesión?
- [ ] **INSERT**: ¿el `WITH CHECK` obliga a que `user_id` sea el del que inserta? Si no, se
      pueden crear filas a nombre de otro.
- [ ] **UPDATE**: ¿hay `WITH CHECK` además de `USING`? Sin él, un usuario puede reasignar su
      fila a otro usuario.
- [ ] **Columnas de privilegio** en filas editables por el usuario: `role`, `plan`, `credits`,
      `is_admin`, `verified`. RLS no protege columnas.
- [ ] Políticas que consultan **otra tabla** (`exists (select 1 from members …)`): ¿esa otra
      tabla está protegida? ¿Puede el usuario insertarse en ella?
- [ ] Modelos con **organización o equipo**: comprueba a mano con dos organizaciones que un
      miembro de una no ve datos de la otra. La herramienta no reconoce este modelo.
- [ ] Políticas con roles: ¿de dónde sale el rol? `user_metadata` lo edita el usuario;
      `app_metadata` o una tabla protegida, no.
- [ ] Varias políticas permisivas sobre la misma tabla se **suman** (OR). Una sola abierta
      anula a las demás.
- [ ] **Vistas**: sin `security_invoker`, se saltan RLS.
- [ ] **Funciones `SECURITY DEFINER`**: se ejecutan con permisos elevados y son invocables por
      API si están en `public`. Lee qué hacen y si comprueban quién llama.

Cómo confirmar una sospecha sin tocar datos reales: reproduce el esquema en local
(`supabase start` con las migraciones), crea dos usuarios y pruébalo ahí. En local sí puedes
usar `--probar-escritura --base-desechable --permitir-local`.

## 4. Edge Functions y RPC (45–60 min)

La herramienta las lista y no las ejecuta. Hay que leerlas una a una.

- [ ] ¿Cómo identifica al usuario? Debe obtenerlo del token (`auth.getUser(token)`), nunca de
      un `userId` que llega en el cuerpo.
- [ ] Si usa la clave de servicio: ¿filtra cada consulta por el usuario identificado?
- [ ] `verify_jwt = false`: ¿por qué? Si es un webhook, ¿valida la firma del proveedor?
- [ ] ¿Valida los datos de entrada (tipos, longitudes, que el recurso pertenece al usuario)?
- [ ] ¿Llama a APIs de pago (IA, correo, SMS)? ¿Hay límite por usuario? Sin él, cualquiera
      puede agotar el saldo.
- [ ] ¿Devuelve en los errores detalles internos o claves?
- [ ] CORS: `*` es aceptable en funciones públicas; no en las que actúan en nombre del usuario
      con cookies.

No invoques las funciones del cliente para "probar" salvo que esté en el alcance y sepas qué
hacen. Una función llamada `delete-account` hace lo que dice.

## 5. Autenticación (20 min)

En el panel de Supabase, con el titular o por capturas:

- [ ] Confirmación de correo activada.
- [ ] Registro abierto: ¿es intencionado? En una herramienta interna no debería estarlo.
- [ ] Longitud mínima de contraseña y protección frente a contraseñas filtradas.
- [ ] URLs de redirección permitidas: solo dominios propios, sin comodines amplios.
- [ ] Proveedores OAuth: solo los que se usan.
- [ ] Usuarios anónimos: si están activados, "authenticated" incluye a cualquiera.
- [ ] Límites de frecuencia de los correos y de los intentos de acceso.

## 6. Almacenamiento (15 min)

- [ ] Por cada bucket: ¿público o privado?, ¿qué guarda?
- [ ] Un bucket público con documentos (facturas, DNI, contratos) es un hallazgo aunque los
      nombres de archivo sean difíciles de adivinar.
- [ ] Políticas sobre `storage.objects`: ¿limitan por carpeta de usuario?
- [ ] ¿Se puede subir cualquier tipo y tamaño de archivo?

## 7. Secretos y configuración (20 min)

- [ ] Todo lo que `repo` y `web` hayan marcado: abre el archivo y confirma.
- [ ] Variables con prefijo público (`VITE_`, `NEXT_PUBLIC_`): solo la URL y la clave pública.
- [ ] Historial de Git: `git log -p -S "service_role"` y búsquedas de `sk_live`, `sk-`. Un
      secreto borrado sigue en el historial y hay que rotarlo.
- [ ] Si el repositorio es o fue público, todo secreto que haya pasado por él está expuesto.
- [ ] Claves de terceros (Stripe, IA, correo): ¿restringidas por dominio o por permisos?

## 8. Lo que queda fuera y hay que nombrar (10 min)

Mira por encima y, si ves algo, anótalo como "observación fuera de alcance":

- pagos: ¿el precio o el plan se decide en el navegador?;
- límites de uso de funciones caras;
- exportaciones o búsquedas que devuelven más de lo que deberían;
- páginas de administración accesibles solo "porque el botón está oculto".

## 9. Confirmar antes de escribir

Para cada hallazgo:

- [ ] ¿Lo he visto yo, o solo coincide un patrón?
- [ ] ¿Puede ser intencionado? Pregunta al titular antes de llamarlo fallo (tablas públicas,
      formularios abiertos).
- [ ] ¿La gravedad refleja el daño real en **esta** app? Baja o sube la que propone la
      herramienta y explica por qué.
- [ ] ¿El arreglo propuesto encaja con sus nombres de columna? El SQL del informe usa
      `user_id` por defecto.
- [ ] ¿He probado el arreglo en local?

Descarta lo que no puedas sostener. Un informe corto y cierto vale más que uno largo.

## 10. Informe y entrega (45–60 min)

```bash
node bin/cerrojo.js informe salida/web.json salida/aislamiento.json salida/repo.json \
  --cliente "…" --auditor "…" --salida salida/informe.html
```

- [ ] El HTML generado es la base. Añade a mano los hallazgos manuales y quita los
      descartados; todavía no hay una orden para incorporar hallazgos manuales al informe.
- [ ] Revisa que no contenga ningún dato personal ni ningún secreto completo.
- [ ] Deja escrito qué **no** se revisó.
- [ ] Imprime a PDF desde el navegador para enviarlo.
- [ ] Envíalo por un canal acordado. Un informe de seguridad es información sensible.
- [ ] Llamada de 30 minutos: empieza por lo crítico y por qué hacer hoy.
- [ ] Si hay datos personales reales expuestos, díselo claramente al titular: tiene
      obligaciones que valorar con su asesor.

## 11. Después

- [ ] Borra de tu equipo los resultados y cualquier copia del repositorio cuando termine el
      periodo acordado. Pide que eliminen las cuentas de prueba.
- [ ] Si se contrató la segunda pasada: repite los pasos 1 a 3 tras los arreglos y entrega una
      versión actualizada del informe.
- [ ] Anota cuántas horas te ha llevado cada paso. Es el dato que falta para saber si el precio
      es viable.

## Tiempos

Suma orientativa: entre 5 y 7 horas para una app de unas 10 a 15 tablas. Es una **estimación
sin medir**.
