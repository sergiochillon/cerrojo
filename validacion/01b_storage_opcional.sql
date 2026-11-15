-- ─────────────────────────────────────────────────────────────────────────────
-- cerrojo · validación contra un proyecto Supabase de PRUEBAS
-- Paso opcional: dos buckets para comprobar el listado de archivos sin sesión.
--
-- Solo crea los buckets y una política. Los archivos se suben a mano desde el panel
-- (un fichero de texto inventado en cada bucket; ver GUION.md). No insertes filas en
-- storage.objects por SQL: Supabase pide gestionar los archivos con su panel o su API.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

do $$
begin
  if not exists (select 1 from public.cv_marca where id = 1 and proposito = 'cerrojo-validacion') then
    raise exception 'Falta la marca: ejecuta antes 01_esquema.sql en este mismo proyecto.';
  end if;
end $$;

-- Ninguno de los dos es "público": lo que se prueba es el LISTADO, que depende de las
-- políticas sobre storage.objects.
-- Repetible: si los buckets siguen ahí de una validación anterior, no falla.
insert into storage.buckets (id, name, public) values
  ('cv-listable', 'cv-listable', false),
  ('cv-privado', 'cv-privado', false)
on conflict (id) do nothing;

-- Fallo a propósito: cualquiera puede listar el contenido de cv-listable.
-- Esperado sin sesión: cv-listable devuelve archivos; cv-privado, ninguno.
drop policy if exists "cv listar sin sesion" on storage.objects;
create policy "cv listar sin sesion" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'cv-listable');

commit;
