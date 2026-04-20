create extension if not exists "pgcrypto";

alter table public.tenants
  add column if not exists slug text;

create unique index if not exists uniq_tenants_slug_lower on public.tenants ((lower(slug))) where slug is not null;

alter table public.customers
  add column if not exists tenant_id uuid;

alter table public.projects
  add column if not exists tenant_id uuid;

alter table public.quotes
  add column if not exists tenant_id uuid;

alter table public.company_settings
  add column if not exists tenant_id uuid;

do $$
declare
  default_tenant_id uuid;
begin
  select t.id
    into default_tenant_id
    from public.tenants t
   order by t.created_at asc
   limit 1;

  if default_tenant_id is null then
    insert into public.tenants (name, slug, created_at, updated_at)
    values ('Default Tenant', 'default', now(), now())
    returning id into default_tenant_id;
  end if;

  update public.customers
     set tenant_id = default_tenant_id
   where tenant_id is null;

  update public.projects
     set tenant_id = default_tenant_id
   where tenant_id is null;

  update public.quotes
     set tenant_id = default_tenant_id
   where tenant_id is null;

  update public.company_settings
     set tenant_id = default_tenant_id
   where tenant_id is null;
end
$$;

alter table public.customers
  alter column tenant_id set not null;

alter table public.projects
  alter column tenant_id set not null;

alter table public.quotes
  alter column tenant_id set not null;

alter table public.company_settings
  alter column tenant_id set not null;

do $$
begin
  alter table public.customers
    add constraint customers_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.projects
    add constraint projects_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.quotes
    add constraint quotes_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.company_settings
    add constraint company_settings_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.tenant_users
    add constraint tenant_users_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users(id) on delete cascade;
exception
  when duplicate_object then null;
end
$$;

create index if not exists idx_customers_tenant_id on public.customers(tenant_id);
create index if not exists idx_projects_tenant_id on public.projects(tenant_id);
create index if not exists idx_quotes_tenant_id on public.quotes(tenant_id);
create index if not exists idx_company_settings_tenant_id on public.company_settings(tenant_id);
create unique index if not exists uniq_company_settings_id on public.company_settings(id);
