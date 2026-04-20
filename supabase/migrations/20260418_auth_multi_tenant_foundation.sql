create unique index if not exists uniq_tenant_users_tenant_user
  on public.tenant_users(tenant_id, auth_user_id)
  where auth_user_id is not null;

do $$
begin
  with ranked as (
    select
      ctid,
      row_number() over (
        partition by tenant_id
        order by updated_at desc nulls last, created_at desc nulls last, id desc
      ) as rn
    from public.company_settings
    where tenant_id is not null
  )
  delete from public.company_settings cs
  using ranked r
  where cs.ctid = r.ctid
    and r.rn > 1;
end
$$;

create unique index if not exists uniq_company_settings_tenant_id
  on public.company_settings(tenant_id);

alter table public.tenants enable row level security;
alter table public.tenant_users enable row level security;
alter table public.customers enable row level security;
alter table public.projects enable row level security;
alter table public.quotes enable row level security;
alter table public.company_settings enable row level security;

drop policy if exists tenants_select_member on public.tenants;
create policy tenants_select_member
  on public.tenants
  for select
  using (
    exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = tenants.id
        and tu.auth_user_id = auth.uid()
    )
  );

drop policy if exists tenant_users_select_self_or_tenant_admin on public.tenant_users;
create policy tenant_users_select_self_or_tenant_admin
  on public.tenant_users
  for select
  using (
    auth_user_id = auth.uid()
    or exists (
      select 1
      from public.tenant_users actor
      where actor.tenant_id = tenant_users.tenant_id
        and actor.auth_user_id = auth.uid()
        and actor.role in ('owner', 'admin')
    )
  );

drop policy if exists tenant_users_insert_admin_owner on public.tenant_users;
create policy tenant_users_insert_admin_owner
  on public.tenant_users
  for insert
  with check (
    exists (
      select 1
      from public.tenant_users actor
      where actor.tenant_id = tenant_users.tenant_id
        and actor.auth_user_id = auth.uid()
        and actor.role in ('owner', 'admin')
    )
  );

drop policy if exists tenant_users_update_admin_owner on public.tenant_users;
create policy tenant_users_update_admin_owner
  on public.tenant_users
  for update
  using (
    exists (
      select 1
      from public.tenant_users actor
      where actor.tenant_id = tenant_users.tenant_id
        and actor.auth_user_id = auth.uid()
        and actor.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1
      from public.tenant_users actor
      where actor.tenant_id = tenant_users.tenant_id
        and actor.auth_user_id = auth.uid()
        and actor.role in ('owner', 'admin')
    )
  );

drop policy if exists tenant_users_delete_admin_owner on public.tenant_users;
create policy tenant_users_delete_admin_owner
  on public.tenant_users
  for delete
  using (
    exists (
      select 1
      from public.tenant_users actor
      where actor.tenant_id = tenant_users.tenant_id
        and actor.auth_user_id = auth.uid()
        and actor.role in ('owner', 'admin')
    )
  );

drop policy if exists customers_tenant_access on public.customers;
create policy customers_tenant_access
  on public.customers
  for all
  using (
    exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = customers.tenant_id
        and tu.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = customers.tenant_id
        and tu.auth_user_id = auth.uid()
    )
  );

drop policy if exists projects_tenant_access on public.projects;
create policy projects_tenant_access
  on public.projects
  for all
  using (
    exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = projects.tenant_id
        and tu.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = projects.tenant_id
        and tu.auth_user_id = auth.uid()
    )
  );

drop policy if exists quotes_tenant_access on public.quotes;
create policy quotes_tenant_access
  on public.quotes
  for all
  using (
    exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = quotes.tenant_id
        and tu.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = quotes.tenant_id
        and tu.auth_user_id = auth.uid()
    )
  );

drop policy if exists company_settings_tenant_access on public.company_settings;
create policy company_settings_tenant_access
  on public.company_settings
  for all
  using (
    exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = company_settings.tenant_id
        and tu.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tenant_users tu
      where tu.tenant_id = company_settings.tenant_id
        and tu.auth_user_id = auth.uid()
    )
  );

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
  existing_tenant_id uuid;
  new_tenant_id uuid;
  base_slug text;
  candidate_slug text;
  slug_suffix integer := 1;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'auth_required';
  end if;

  select tu.tenant_id
    into existing_tenant_id
    from public.tenant_users tu
   where tu.auth_user_id = current_user_id
   order by tu.created_at asc
   limit 1;

  if existing_tenant_id is not null then
    return existing_tenant_id;
  end if;

  current_user_email := coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    nullif(trim(p_email), ''),
    null
  );

  base_slug := lower(regexp_replace(coalesce(trim(p_company_name), ''), '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := trim(both '-' from base_slug);

  if base_slug = '' then
    base_slug := 'tenant-' || substring(replace(current_user_id::text, '-', '') from 1 for 8);
  end if;

  candidate_slug := base_slug;

  while exists (
    select 1
    from public.tenants t
    where lower(t.slug) = lower(candidate_slug)
  ) loop
    slug_suffix := slug_suffix + 1;
    candidate_slug := base_slug || '-' || slug_suffix::text;
  end loop;

  insert into public.tenants (name, slug, created_at, updated_at)
  values (trim(p_company_name), candidate_slug, now(), now())
  returning id into new_tenant_id;

  insert into public.tenant_users (
    tenant_id,
    auth_user_id,
    email,
    role,
    created_at,
    updated_at
  ) values (
    new_tenant_id,
    current_user_id,
    current_user_email,
    'owner',
    now(),
    now()
  );

  insert into public.company_settings (
    tenant_id,
    company_name,
    address,
    contact_person,
    email,
    phone,
    payment_terms,
    vat_rate,
    currency,
    created_at,
    updated_at
  ) values (
    new_tenant_id,
    trim(p_company_name),
    nullif(trim(p_address), ''),
    nullif(trim(p_contact_person), ''),
    current_user_email,
    nullif(trim(p_phone), ''),
    'Zahlbar innerhalb von 14 Tagen ohne Abzug.',
    0.19,
    'EUR',
    now(),
    now()
  )
  on conflict (tenant_id)
  do update set
    company_name = excluded.company_name,
    address = excluded.address,
    contact_person = excluded.contact_person,
    email = excluded.email,
    phone = excluded.phone,
    updated_at = now();

  return new_tenant_id;
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
  current_user_email text;
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
   where tu.auth_user_id = current_user_id
   order by tu.created_at asc
   limit 1;

  if existing_tenant_id is not null then
    return existing_tenant_id;
  end if;

  select t.id
    into fallback_tenant_id
    from public.tenants t
   where lower(t.slug) = 'local-dev'
   order by t.created_at asc
   limit 1;

  if fallback_tenant_id is null then
    select t.id
      into fallback_tenant_id
      from public.tenants t
     order by t.created_at asc
     limit 1;
  end if;

  if fallback_tenant_id is null then
    return null;
  end if;

  current_user_email := nullif(auth.jwt() ->> 'email', '');

  insert into public.tenant_users (
    tenant_id,
    auth_user_id,
    email,
    role,
    created_at,
    updated_at
  ) values (
    fallback_tenant_id,
    current_user_id,
    current_user_email,
    'user',
    now(),
    now()
  )
  on conflict (tenant_id, auth_user_id)
  do update set
    email = excluded.email,
    updated_at = now();

  return fallback_tenant_id;
end;
$$;

create or replace function public.ensure_tenant_membership_for_current_user(
  p_tenant_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_user_email text;
  target_tenant_id uuid;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    return null;
  end if;

  if p_tenant_id is null then
    return null;
  end if;

  select t.id
    into target_tenant_id
    from public.tenants t
   where t.id = p_tenant_id
   limit 1;

  if target_tenant_id is null then
    return null;
  end if;

  current_user_email := nullif(auth.jwt() ->> 'email', '');

  insert into public.tenant_users (
    tenant_id,
    auth_user_id,
    email,
    role,
    created_at,
    updated_at
  ) values (
    target_tenant_id,
    current_user_id,
    current_user_email,
    'owner',
    now(),
    now()
  )
  on conflict (tenant_id, auth_user_id)
  do update set
    email = excluded.email,
    updated_at = now();

  return target_tenant_id;
end;
$$;

grant execute on function public.initialize_tenant_for_current_user(text, text, text, text, text) to authenticated;
grant execute on function public.resolve_localhost_tenant_context() to authenticated;
grant execute on function public.ensure_tenant_membership_for_current_user(uuid) to authenticated;

