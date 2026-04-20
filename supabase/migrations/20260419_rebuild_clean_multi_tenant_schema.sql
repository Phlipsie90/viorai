create extension if not exists "pgcrypto";

drop table if exists public.quote_status_history cascade;
drop table if exists public.quotes cascade;
drop table if exists public.projects cascade;
drop table if exists public.customers cascade;
drop table if exists public.company_settings cascade;
drop table if exists public.tenant_users cascade;
drop table if exists public.tenants cascade;

drop function if exists public.ensure_tenant_membership_for_current_user(uuid);
drop function if exists public.resolve_localhost_tenant_context();
drop function if exists public.initialize_tenant_for_current_user(text, text, text, text, text);
drop function if exists public.prevent_delete_last_owner();
drop function if exists public.validate_tenant_user_role_limits();
drop function if exists public.is_active_tenant_member(uuid);
drop function if exists public.is_tenant_admin(uuid);
drop function if exists public.set_updated_at();
drop function if exists public.log_quote_status_history();
drop function if exists public.slugify(text);

create or replace function public.slugify(input text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text;
begin
  normalized := lower(coalesce(trim(input), ''));
  normalized := regexp_replace(normalized, '[^a-z0-9]+', '-', 'g');
  normalized := trim(both '-' from normalized);

  if normalized = '' then
    normalized := 'tenant';
  end if;

  return normalized;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null check (role in ('owner', 'admin', 'user')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create table public.company_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  company_name text,
  logo_url text,
  address text,
  contact_person text,
  email text,
  phone text,
  website text,
  letterhead text,
  footer text,
  vat_rate numeric,
  payment_terms text,
  currency text,
  intro_text text,
  closing_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  billing_address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  site_address text,
  description text,
  start_date date,
  end_date date,
  runtime_label text,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'draft',
  positions jsonb not null default '[]'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  generated_text text,
  concept_text text,
  ai_input_summary text,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quote_status_history (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  old_status text,
  new_status text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index idx_tenant_users_tenant_id on public.tenant_users(tenant_id);
create index idx_tenant_users_user_id on public.tenant_users(user_id);
create index idx_company_settings_tenant_id on public.company_settings(tenant_id);
create index idx_customers_tenant_id on public.customers(tenant_id);
create index idx_projects_tenant_id on public.projects(tenant_id);
create index idx_projects_customer_id on public.projects(customer_id);
create index idx_quotes_tenant_id on public.quotes(tenant_id);
create index idx_quotes_customer_id on public.quotes(customer_id);
create index idx_quotes_project_id on public.quotes(project_id);
create index idx_quotes_status on public.quotes(status);
create index idx_quote_status_history_tenant_id on public.quote_status_history(tenant_id);
create index idx_quote_status_history_quote_id on public.quote_status_history(quote_id);
create index idx_quote_status_history_changed_at on public.quote_status_history(changed_at desc);

create trigger trg_tenants_set_updated_at
before update on public.tenants
for each row
execute function public.set_updated_at();

create trigger trg_tenant_users_set_updated_at
before update on public.tenant_users
for each row
execute function public.set_updated_at();

create trigger trg_company_settings_set_updated_at
before update on public.company_settings
for each row
execute function public.set_updated_at();

create trigger trg_customers_set_updated_at
before update on public.customers
for each row
execute function public.set_updated_at();

create trigger trg_projects_set_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

create trigger trg_quotes_set_updated_at
before update on public.quotes
for each row
execute function public.set_updated_at();

create or replace function public.is_active_tenant_member(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = target_tenant_id
      and tu.user_id = auth.uid()
      and tu.is_active = true
  );
$$;

create or replace function public.is_tenant_admin(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = target_tenant_id
      and tu.user_id = auth.uid()
      and tu.is_active = true
      and tu.role in ('owner', 'admin')
  );
$$;

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;
alter table public.company_settings enable row level security;
alter table public.customers enable row level security;
alter table public.projects enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_status_history enable row level security;

create policy tenants_select_own_tenant
on public.tenants
for select
using (public.is_active_tenant_member(id));

create policy tenants_update_own_tenant
on public.tenants
for update
using (public.is_tenant_admin(id))
with check (public.is_tenant_admin(id));

create policy tenant_users_select_own_tenant
on public.tenant_users
for select
using (public.is_active_tenant_member(tenant_id));

create policy tenant_users_insert_admin
on public.tenant_users
for insert
with check (public.is_tenant_admin(tenant_id));

create policy tenant_users_update_admin
on public.tenant_users
for update
using (public.is_tenant_admin(tenant_id))
with check (public.is_tenant_admin(tenant_id));

create policy tenant_users_delete_admin
on public.tenant_users
for delete
using (public.is_tenant_admin(tenant_id));

create policy company_settings_select_own_tenant
on public.company_settings
for select
using (public.is_active_tenant_member(tenant_id));

create policy company_settings_insert_admin
on public.company_settings
for insert
with check (public.is_tenant_admin(tenant_id));

create policy company_settings_update_admin
on public.company_settings
for update
using (public.is_tenant_admin(tenant_id))
with check (public.is_tenant_admin(tenant_id));

create policy customers_tenant_access
on public.customers
for all
using (public.is_active_tenant_member(tenant_id))
with check (public.is_active_tenant_member(tenant_id));

create policy projects_tenant_access
on public.projects
for all
using (public.is_active_tenant_member(tenant_id))
with check (public.is_active_tenant_member(tenant_id));

create policy quotes_tenant_access
on public.quotes
for all
using (public.is_active_tenant_member(tenant_id))
with check (public.is_active_tenant_member(tenant_id));

create policy quote_status_history_tenant_access
on public.quote_status_history
for all
using (public.is_active_tenant_member(tenant_id))
with check (public.is_active_tenant_member(tenant_id));

create or replace function public.log_quote_status_history()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.quote_status_history (
      quote_id,
      tenant_id,
      old_status,
      new_status,
      changed_by,
      changed_at
    )
    values (
      new.id,
      new.tenant_id,
      null,
      new.status,
      auth.uid(),
      now()
    );

    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.quote_status_history (
      quote_id,
      tenant_id,
      old_status,
      new_status,
      changed_by,
      changed_at
    )
    values (
      new.id,
      new.tenant_id,
      old.status,
      new.status,
      auth.uid(),
      now()
    );
  end if;

  return new;
end;
$$;

create trigger trg_quotes_status_history
after insert or update of status on public.quotes
for each row
execute function public.log_quote_status_history();

create or replace function public.initialize_tenant_for_current_user(
  p_company_name text,
  p_contact_person text default null,
  p_email text default null,
  p_phone text default null,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_user_email text;
  current_user_name text;
  existing_tenant_id uuid;
  new_tenant_id uuid;
  requested_company_name text;
  candidate_slug text;
  base_slug text;
  slug_counter integer := 1;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'auth_required';
  end if;

  select tu.tenant_id
    into existing_tenant_id
    from public.tenant_users tu
   where tu.user_id = current_user_id
     and tu.is_active = true
   order by tu.created_at asc
   limit 1;

  if existing_tenant_id is not null then
    return existing_tenant_id;
  end if;

  requested_company_name := nullif(trim(p_company_name), '');
  if requested_company_name is null then
    requested_company_name := 'New Tenant';
  end if;

  current_user_email := coalesce(
    nullif(trim(p_email), ''),
    nullif(auth.jwt() ->> 'email', ''),
    null
  );

  current_user_name := coalesce(
    nullif(trim(p_contact_person), ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'name', ''),
    current_user_email,
    'Owner'
  );

  base_slug := public.slugify(requested_company_name);
  candidate_slug := base_slug;

  while exists (
    select 1
    from public.tenants t
    where t.slug = candidate_slug
  ) loop
    slug_counter := slug_counter + 1;
    candidate_slug := base_slug || '-' || slug_counter::text;
  end loop;

  insert into public.tenants (slug, name)
  values (candidate_slug, requested_company_name)
  returning id into new_tenant_id;

  insert into public.tenant_users (
    tenant_id,
    user_id,
    email,
    full_name,
    role,
    is_active
  )
  values (
    new_tenant_id,
    current_user_id,
    current_user_email,
    current_user_name,
    'owner',
    true
  );

  insert into public.company_settings (
    tenant_id,
    company_name,
    address,
    contact_person,
    email,
    phone,
    vat_rate,
    payment_terms,
    currency
  )
  values (
    new_tenant_id,
    requested_company_name,
    nullif(trim(p_address), ''),
    nullif(trim(p_contact_person), ''),
    current_user_email,
    nullif(trim(p_phone), ''),
    0.19,
    'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
    'EUR'
  );

  return new_tenant_id;
end;
$$;

create or replace function public.ensure_tenant_membership_for_current_user(target_tenant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_user_email text;
  current_user_name text;
  existing_membership_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null or target_tenant_id is null then
    return null;
  end if;

  if not exists (
    select 1
    from public.tenants t
    where t.id = target_tenant_id
  ) then
    return null;
  end if;

  select tu.id
    into existing_membership_id
    from public.tenant_users tu
   where tu.tenant_id = target_tenant_id
     and tu.user_id = current_user_id
   limit 1;

  current_user_email := nullif(auth.jwt() ->> 'email', '');
  current_user_name := coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'name', ''),
    current_user_email,
    'User'
  );

  if existing_membership_id is null then
    insert into public.tenant_users (
      tenant_id,
      user_id,
      email,
      full_name,
      role,
      is_active
    )
    values (
      target_tenant_id,
      current_user_id,
      current_user_email,
      current_user_name,
      'user',
      true
    );
  else
    update public.tenant_users
       set email = current_user_email,
           full_name = current_user_name,
           is_active = true
     where id = existing_membership_id;
  end if;

  return target_tenant_id;
end;
$$;

create or replace function public.resolve_localhost_tenant_context()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  existing_tenant_id uuid;
  fallback_tenant_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    return null;
  end if;

  select tu.tenant_id
    into existing_tenant_id
    from public.tenant_users tu
   where tu.user_id = current_user_id
     and tu.is_active = true
   order by tu.created_at asc
   limit 1;

  if existing_tenant_id is not null then
    return existing_tenant_id;
  end if;

  select t.id
    into fallback_tenant_id
    from public.tenants t
   order by t.created_at asc
   limit 1;

  if fallback_tenant_id is null then
    return null;
  end if;

  return public.ensure_tenant_membership_for_current_user(fallback_tenant_id);
end;
$$;

grant execute on function public.initialize_tenant_for_current_user(text, text, text, text, text) to authenticated;
grant execute on function public.ensure_tenant_membership_for_current_user(uuid) to authenticated;
grant execute on function public.resolve_localhost_tenant_context() to authenticated;

do $$
declare
  seed_tenant_id uuid;
  seed_user_id uuid;
  seed_user_email text;
  seed_user_name text;
  seed_customer_id uuid;
begin
  insert into public.tenants (slug, name)
  values ('demo-tenant', 'Demo Tenant')
  on conflict (slug)
  do update set name = excluded.name
  returning id into seed_tenant_id;

  insert into public.company_settings (
    tenant_id,
    company_name,
    email,
    phone,
    website,
    vat_rate,
    payment_terms,
    currency,
    intro_text,
    closing_text
  )
  values (
    seed_tenant_id,
    'Demo Tenant GmbH',
    'demo@example.com',
    '+49 30 000000',
    'https://example.com',
    0.19,
    'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
    'EUR',
    'Vielen Dank für Ihre Anfrage.',
    'Mit freundlichen Grüßen'
  )
  on conflict (tenant_id)
  do update set
    company_name = excluded.company_name,
    email = excluded.email,
    phone = excluded.phone,
    website = excluded.website,
    vat_rate = excluded.vat_rate,
    payment_terms = excluded.payment_terms,
    currency = excluded.currency,
    intro_text = excluded.intro_text,
    closing_text = excluded.closing_text;

  update public.company_settings
     set closing_text = 'Mit freundlichen Grüßen'
   where closing_text = 'Mit freundlichen Gruessen';

  select u.id,
         u.email,
         coalesce(
           nullif(u.raw_user_meta_data ->> 'full_name', ''),
           nullif(u.raw_user_meta_data ->> 'name', ''),
           u.email,
           'Demo Owner'
         )
    into seed_user_id, seed_user_email, seed_user_name
    from auth.users u
   order by u.created_at asc
   limit 1;

  if seed_user_id is not null then
    insert into public.tenant_users (
      tenant_id,
      user_id,
      email,
      full_name,
      role,
      is_active
    )
    values (
      seed_tenant_id,
      seed_user_id,
      seed_user_email,
      seed_user_name,
      'owner',
      true
    )
    on conflict (tenant_id, user_id)
    do update set
      email = excluded.email,
      full_name = excluded.full_name,
      role = 'owner',
      is_active = true;
  end if;

  insert into public.customers (
    tenant_id,
    company_name,
    contact_name,
    email,
    phone,
    address,
    billing_address,
    notes
  )
  values (
    seed_tenant_id,
    'Demo Kunde GmbH',
    'Max Mustermann',
    'kunde@example.com',
    '+49 30 111111',
    'Musterstrasse 1, 10115 Berlin',
    'Rechnung an Musterstrasse 1, 10115 Berlin',
    'Seed-Datensatz'
  )
  returning id into seed_customer_id;

  insert into public.projects (
    tenant_id,
    customer_id,
    name,
    site_address,
    description,
    start_date,
    end_date,
    runtime_label,
    location
  )
  values (
    seed_tenant_id,
    seed_customer_id,
    'Demo Projekt',
    'Baustelle Nord, Berlin',
    'Seed-Projekt fuer die lokale Entwicklung',
    current_date,
    current_date + 30,
    '1 Monat',
    'Berlin'
  );
end;
$$;
