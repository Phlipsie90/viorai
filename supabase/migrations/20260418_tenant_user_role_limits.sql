create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  auth_user_id uuid,
  email text,
  role text not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_users_role_check check (role in ('owner', 'admin', 'user'))
);

create index if not exists idx_tenant_users_tenant_id on public.tenant_users(tenant_id);
create unique index if not exists uniq_tenant_owner on public.tenant_users(tenant_id) where role = 'owner';

create or replace function public.validate_tenant_user_role_limits()
returns trigger
language plpgsql
as $$
declare
  owner_count integer;
  admin_count integer;
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
  elsif tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  if new.role = 'owner' then
    select count(*)
      into owner_count
      from public.tenant_users tu
     where tu.tenant_id = new.tenant_id
       and tu.role = 'owner'
       and (tg_op = 'INSERT' or tu.id <> new.id);

    if owner_count > 0 then
      raise exception 'Exactly one owner allowed per tenant.';
    end if;
  end if;

  if new.role = 'admin' then
    select count(*)
      into admin_count
      from public.tenant_users tu
     where tu.tenant_id = new.tenant_id
       and tu.role = 'admin'
       and (tg_op = 'INSERT' or tu.id <> new.id);

    if admin_count >= 2 then
      raise exception 'Maximum two admins allowed per tenant.';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.role = 'owner'
     and new.role <> 'owner' then
    select count(*)
      into owner_count
      from public.tenant_users tu
     where tu.tenant_id = old.tenant_id
       and tu.role = 'owner'
       and tu.id <> old.id;

    if owner_count = 0 then
      raise exception 'Cannot remove the last owner of a tenant.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_tenant_user_role_limits on public.tenant_users;
create trigger trg_validate_tenant_user_role_limits
before insert or update on public.tenant_users
for each row
execute function public.validate_tenant_user_role_limits();

create or replace function public.prevent_delete_last_owner()
returns trigger
language plpgsql
as $$
declare
  owner_count integer;
begin
  if old.role = 'owner' then
    select count(*)
      into owner_count
      from public.tenant_users tu
     where tu.tenant_id = old.tenant_id
       and tu.role = 'owner'
       and tu.id <> old.id;

    if owner_count = 0 then
      raise exception 'Cannot delete the last owner of a tenant.';
    end if;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_prevent_delete_last_owner on public.tenant_users;
create trigger trg_prevent_delete_last_owner
before delete on public.tenant_users
for each row
execute function public.prevent_delete_last_owner();
