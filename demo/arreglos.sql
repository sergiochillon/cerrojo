-- Arreglos de los fallos de autorización de la app ficticia "Clientia".
-- Sirve de ejemplo de entrega ("migración de corrección") y lo usan las pruebas para
-- comprobar que, una vez aplicado, los hallazgos correspondientes desaparecen.

-- Perfiles: cada usuario lee solo el suyo y no puede cambiar su rol ni su plan.
drop policy "Profiles are viewable by everyone" on public.profiles;
create policy "Users read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- Clientes: solo los propios.
drop policy "Authenticated users can manage clients" on public.clients;
create policy "Users manage own clients" on public.clients
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Facturas: fuera la política basada en metadatos editables por el usuario.
drop policy "Admins read all invoices" on public.invoices;

-- Tokens de integraciones: RLS sin políticas (solo el servidor accede).
alter table public.integration_tokens enable row level security;

-- La vista respeta las políticas de quien la consulta.
alter view public.client_directory set (security_invoker = on);

-- Función con search_path fijo.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = uid and role = 'admin');
$$;

-- Archivos de facturas: bucket privado y listado limitado a la carpeta del usuario.
drop policy "Anyone can list invoice files" on storage.objects;
create policy "Users list own invoice files" on storage.objects
  for select to authenticated
  using (bucket_id = 'invoices-pdf' and (storage.foldername(name))[1] = (select auth.uid())::text);
update storage.buckets set public = false where id = 'invoices-pdf';
