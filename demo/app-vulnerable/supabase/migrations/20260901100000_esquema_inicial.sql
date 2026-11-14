-- "Clientia": CRM ficticio para autónomos, con los fallos de autorización típicos de una app
-- generada con IA. Todo aquí es inventado y existe solo para probar cerrojo.

-- Perfiles: una fila por usuario.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'user',
  plan text not null default 'free',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- FALLO: lectura abierta a cualquiera, incluidos visitantes sin sesión.
create policy "Profiles are viewable by everyone" on public.profiles
  for select using (true);

-- FALLO: el usuario edita su fila... que contiene su rol y su plan.
create policy "Users can update own profile" on public.profiles
  for update to authenticated
  using (auth.uid() = id);

-- Clientes de cada usuario.
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.clients enable row level security;

-- FALLO: RLS "activado", pero la política solo exige haber iniciado sesión.
create policy "Authenticated users can manage clients" on public.clients
  for all to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

-- Facturas: aquí las políticas por dueño sí están bien.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  amount numeric(12, 2) not null,
  iban text,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);
alter table public.invoices enable row level security;

create policy "Users read own invoices" on public.invoices
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users insert own invoices" on public.invoices
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users update own invoices" on public.invoices
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- FALLO: "administrador" decidido con metadatos que el propio usuario puede editar.
create policy "Admins read all invoices" on public.invoices
  for select to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

-- FALLO: tabla con tokens de integraciones, sin RLS.
create table public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  access_token text not null,
  created_at timestamptz not null default now()
);

-- Contenido realmente público: lectura abierta intencionada.
create table public.plans (
  id text primary key,
  title text not null,
  monthly_price numeric(8, 2) not null
);
alter table public.plans enable row level security;
create policy "Plans are public" on public.plans for select using (true);

-- Lista de espera: cualquiera puede apuntarse (intencionado), nadie puede leerla.
create table public.waitlist (
  id bigint generated always as identity primary key,
  email text not null,
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;
create policy "Anyone can join the waitlist" on public.waitlist
  for insert to anon, authenticated with check (true);

-- Registro interno: RLS sin políticas (solo servidor).
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;

-- FALLO: vista que se ejecuta con los permisos de su creador y se salta RLS.
create view public.client_directory as
  select c.id, c.name, c.email, c.phone, p.full_name as owner_name
  from public.clients c
  join public.profiles p on p.id = c.user_id;

-- FALLO: SECURITY DEFINER sin search_path fijo.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
as $$
  select exists (select 1 from public.profiles where id = uid and role = 'admin');
$$;

-- FALLO: bucket público para PDFs de facturas, listable por cualquiera.
insert into storage.buckets (id, name, public) values ('invoices-pdf', 'invoices-pdf', true);
create policy "Anyone can list invoice files" on storage.objects
  for select using (bucket_id = 'invoices-pdf');
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
