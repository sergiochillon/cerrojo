-- ─────────────────────────────────────────────────────────────────────────────
-- cerrojo · validación contra un proyecto Supabase de PRUEBAS
-- Limpieza parcial: borra las tablas, vistas y políticas cv_.
--
-- La forma más segura y completa de limpiar es BORRAR EL PROYECTO de pruebas entero desde
-- el panel (ver GUION.md). Usa este script solo si quieres conservar el proyecto para repetir
-- la validación.
--
-- Solo toca objetos con el prefijo cv_. No borra usuarios, buckets ni archivos:
--   · las cuentas de prueba se borran en Authentication → Users;
--   · los buckets cv-listable y cv-privado se vacían y se borran en Storage, desde el panel.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- Salvaguardas: solo se ejecuta en el proyecto de validación, y solo si no hay nada más.
do $$
declare
  marcada boolean := false;
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'cv_marca') then
    execute 'select exists (select 1 from public.cv_marca where id = 1 and proposito = ''cerrojo-validacion'')' into marcada;
  end if;
  if not marcada then
    raise exception 'Aquí no está la marca de validación (cv_marca): este no es el proyecto de validación. No se ha borrado nada.';
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and c.relname not like 'cv\_%'
  ) then
    raise exception 'Este proyecto tiene tablas o vistas que no son de la validación. No se ha borrado nada; revisa dónde estás.';
  end if;
end $$;

drop policy if exists "cv listar sin sesion" on storage.objects;

drop view if exists public.cv_vista_sin_invoker;
drop view if exists public.cv_vista_con_invoker;

drop table if exists public.cv_volumen;
drop table if exists public.cv_mensajes;
drop table if exists public.cv_sin_permisos;
drop table if exists public.cv_rls_sin_politicas;
drop table if exists public.cv_por_dueno;
drop table if exists public.cv_solo_sesion;
drop table if exists public.cv_sin_rls;
drop table if exists public.cv_marca;

commit;

notify pgrst, 'reload schema';
