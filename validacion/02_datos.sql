-- ─────────────────────────────────────────────────────────────────────────────
-- cerrojo · validación contra un proyecto Supabase de PRUEBAS
-- Paso 2 de 2: datos sintéticos.
--
-- Antes de ejecutarlo hay que haber creado a mano las dos cuentas de prueba (ver GUION.md).
-- Sus correos deben ser cerrojo-a@… y cerrojo-b@… (o un alias tuyo terminado en
-- +cerrojo-a@… y +cerrojo-b@…). Este script las busca por ese nombre, así que no hay que
-- escribir aquí ningún correo ni ningún identificador.
--
-- Todos los valores son inventados ("sintetico-…"). No copies aquí datos de nadie.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

do $$
declare
  a uuid;
  b uuid;
begin
  if not exists (select 1 from public.cv_marca where id = 1 and proposito = 'cerrojo-validacion') then
    raise exception 'Falta la marca: ejecuta antes 01_esquema.sql en este mismo proyecto.';
  end if;
  if exists (select 1 from public.cv_sin_rls) then
    raise exception 'Los datos ya estaban cargados. No se ha insertado nada.';
  end if;

  begin
    -- "cerrojo-a@dominio" o un alias "loquesea+cerrojo-a@dominio"; nada más.
    select id into strict a from auth.users where email ~* '(^|\+)cerrojo-a@[^@]+$';
    select id into strict b from auth.users where email ~* '(^|\+)cerrojo-b@[^@]+$';
  exception
    when no_data_found then
      raise exception 'No encuentro las dos cuentas de prueba. Sus correos deben ser cerrojo-a@… y cerrojo-b@… (o un alias terminado en +cerrojo-a@… y +cerrojo-b@…).';
    when too_many_rows then
      raise exception 'Hay más de una cuenta cerrojo-a o cerrojo-b. Deja solo una de cada.';
  end;

  -- Caso 1 · sin RLS: A tiene 2 filas, B tiene 3.
  insert into public.cv_sin_rls (user_id, token_falso) values
    (a, 'sintetico-a-1'), (a, 'sintetico-a-2'),
    (b, 'sintetico-b-1'), (b, 'sintetico-b-2'), (b, 'sintetico-b-3');

  -- Caso 2 · solo sesión: 2 y 2.
  insert into public.cv_solo_sesion (user_id, nota) values
    (a, 'sintetico-a-1'), (a, 'sintetico-a-2'),
    (b, 'sintetico-b-1'), (b, 'sintetico-b-2');

  -- Caso 3 · por dueño: A tiene 2, B tiene 1. (Las dos vistas leen de aquí.)
  insert into public.cv_por_dueno (user_id, nota) values
    (a, 'sintetico-a-1'), (a, 'sintetico-a-2'),
    (b, 'sintetico-b-1');

  -- Caso 4 · RLS sin políticas: 1 y 1 (nadie podrá leerlas por la API).
  insert into public.cv_rls_sin_politicas (user_id, nota) values
    (a, 'sintetico-a-1'), (b, 'sintetico-b-1');

  -- Caso 5 · sin permisos: 1 y 1.
  insert into public.cv_sin_permisos (user_id, nota) values
    (a, 'sintetico-a-1'), (b, 'sintetico-b-1');

  -- Caso 8 · mensajes: uno en cada sentido.
  insert into public.cv_mensajes (remitente_id, destinatario_id, texto) values
    (a, b, 'sintetico-de-a-para-b'),
    (b, a, 'sintetico-de-b-para-a');

  -- Caso 9 · volumen: 1.200 filas de A.
  insert into public.cv_volumen (user_id, n)
    select a, g from generate_series(1, 1200) as g;
end $$;

commit;
