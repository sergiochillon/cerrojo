-- ─────────────────────────────────────────────────────────────────────────────
-- cerrojo · validación contra un proyecto Supabase de PRUEBAS
-- Paso 1 de 2: tablas, vistas y políticas. No contiene ningún dato personal.
--
-- Ejecutar en el SQL Editor de un proyecto NUEVO y VACÍO creado solo para esto.
-- NUNCA en un proyecto de producción ni en uno que tenga datos de alguien.
--
-- Todo lleva el prefijo cv_ ("cerrojo validación") para reconocerlo y borrarlo.
-- Cada tabla representa un caso; el comentario dice qué debe observar la herramienta.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- Salvaguardas: si el proyecto no está vacío, no se crea nada.
do $$
begin
  -- Tablas, tablas particionadas, vistas, vistas materializadas y tablas externas en "public".
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and c.relname not like 'cv\_%'
  ) then
    raise exception 'Este proyecto ya tiene tablas o vistas en "public": no parece un proyecto de pruebas vacío. No se ha creado nada.';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and c.relname like 'cv\_%'
  ) then
    raise exception 'Los objetos cv_ ya existen. Ejecuta antes 03_limpieza.sql si quieres empezar de cero.';
  end if;
  -- Solo pueden existir, como mucho, las dos cuentas de prueba.
  if exists (select 1 from auth.users where email is null or email !~* '(^|\+)cerrojo-[ab]@[^@]+$') then
    raise exception 'Este proyecto tiene cuentas que no son las de prueba (cerrojo-a@…, cerrojo-b@…). No se ha creado nada.';
  end if;
  if (select count(*) from auth.users) > 2 then
    raise exception 'Este proyecto tiene más de dos usuarios: no parece un proyecto de pruebas recién creado. No se ha creado nada.';
  end if;
  -- Ni archivos de nadie.
  if exists (select 1 from storage.buckets where id not in ('cv-listable', 'cv-privado')) then
    raise exception 'Este proyecto ya tiene buckets de Storage: no parece un proyecto de pruebas vacío. No se ha creado nada.';
  end if;
end $$;

-- ── Marca ───────────────────────────────────────────────────────────────────
-- El validador lee esta fila antes de hacer nada más. Si no la encuentra, se detiene: así no
-- puede ejecutarse por error contra otro proyecto.
-- Además es el caso "tabla pública a propósito". Esperado: legible sin sesión, 1 fila.
create table public.cv_marca (
  id int primary key,
  proposito text not null
);
insert into public.cv_marca (id, proposito) values (1, 'cerrojo-validacion');
alter table public.cv_marca enable row level security;
create policy "cv marca publica" on public.cv_marca for select to anon, authenticated using (true);
grant select on public.cv_marca to anon, authenticated;

-- ── Caso 1: tabla SIN RLS ───────────────────────────────────────────────────
-- Esperado sin sesión: legible (5 filas). Entre cuentas: FUGA.
create table public.cv_sin_rls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  token_falso text not null
);
alter table public.cv_sin_rls disable row level security;
grant select, insert, update, delete on public.cv_sin_rls to anon, authenticated;

-- ── Caso 2: RLS "activado" con una política que solo exige sesión ───────────
-- Es el fallo que cerrojo existe para detectar.
-- Esperado sin sesión: 0 filas (parece protegida). Entre cuentas: FUGA.
create table public.cv_solo_sesion (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  nota text not null
);
alter table public.cv_solo_sesion enable row level security;
create policy "cv solo sesion" on public.cv_solo_sesion
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);
grant select on public.cv_solo_sesion to anon;
grant select, insert, update, delete on public.cv_solo_sesion to authenticated;

-- ── Caso 3: RLS correcto, por dueño ─────────────────────────────────────────
-- Esperado sin sesión: 0 filas. Entre cuentas: AISLADA.
create table public.cv_por_dueno (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  nota text not null
);
alter table public.cv_por_dueno enable row level security;
create policy "cv dueno lee" on public.cv_por_dueno
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "cv dueno inserta" on public.cv_por_dueno
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "cv dueno modifica" on public.cv_por_dueno
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "cv dueno borra" on public.cv_por_dueno
  for delete to authenticated using ((select auth.uid()) = user_id);
grant select on public.cv_por_dueno to anon;
grant select, insert, update, delete on public.cv_por_dueno to authenticated;

-- ── Caso 4: RLS activado sin ninguna política ───────────────────────────────
-- Esperado sin sesión: 0 filas. Entre cuentas: NO CONCLUYENTE (nadie ve nada).
create table public.cv_rls_sin_politicas (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  nota text not null
);
alter table public.cv_rls_sin_politicas enable row level security;
grant select on public.cv_rls_sin_politicas to anon, authenticated;

-- ── Caso 5: tabla sin permisos de API ───────────────────────────────────────
-- Desde octubre de 2026 es el estado por defecto de una tabla nueva en Supabase.
-- Esperado: ACCESO DENEGADO (error 42501), con y sin sesión. Sirve para comprobar que la
-- herramienta distingue "denegado" de "protegida por RLS" y de "no existe".
create table public.cv_sin_permisos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  nota text not null
);
alter table public.cv_sin_permisos disable row level security;
revoke all on public.cv_sin_permisos from anon, authenticated;

-- ── Caso 6: vista que se salta RLS ──────────────────────────────────────────
-- Se apoya en cv_por_dueno, que está bien protegida; la vista no hereda esa protección.
-- Esperado sin sesión: legible (3 filas). Entre cuentas: FUGA.
create view public.cv_vista_sin_invoker with (security_invoker = off) as
  select id, user_id, nota from public.cv_por_dueno;
grant select on public.cv_vista_sin_invoker to anon, authenticated;

-- ── Caso 7: la misma vista, bien hecha ──────────────────────────────────────
-- Esperado sin sesión: 0 filas. Entre cuentas: AISLADA.
create view public.cv_vista_con_invoker with (security_invoker = on) as
  select id, user_id, nota from public.cv_por_dueno;
grant select on public.cv_vista_con_invoker to anon, authenticated;

-- ── Caso 8: filas compartidas legítimamente entre dos usuarios ──────────────
-- Un mensaje pertenece a quien lo envía y a quien lo recibe. Que A vea un mensaje de B
-- dirigido a A no es una fuga.
-- Esperado sin sesión: 0 filas. Entre cuentas: AISLADA (sin falso positivo).
create table public.cv_mensajes (
  id bigint generated always as identity primary key,
  remitente_id uuid not null references auth.users (id) on delete cascade,
  destinatario_id uuid not null references auth.users (id) on delete cascade,
  texto text not null
);
alter table public.cv_mensajes enable row level security;
create policy "cv mensajes propios" on public.cv_mensajes
  for select to authenticated
  using ((select auth.uid()) in (remitente_id, destinatario_id));
grant select on public.cv_mensajes to anon, authenticated;

-- ── Caso 9: más filas que el máximo por petición ────────────────────────────
-- 1.200 filas de la cuenta A. Comprueba el recuento total y el tope de 1.000 filas.
-- Esperado sin sesión: 0 filas. Entre cuentas: AISLADA, con A = 1200 y B = 0.
create table public.cv_volumen (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  n int not null
);
alter table public.cv_volumen enable row level security;
create policy "cv volumen propio" on public.cv_volumen
  for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.cv_volumen to anon, authenticated;

-- (El caso "la tabla no existe" no necesita SQL: el validador pregunta por cv_no_existe.)

commit;

-- Pide a la API que recargue el esquema. Supabase suele hacerlo solo; esto lo asegura.
notify pgrst, 'reload schema';
