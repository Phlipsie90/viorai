-- Completes the tenant tower schema with explicit power, connectivity and component domains.

create table if not exists public.tower_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  power_type text not null default 'grid' check (power_type in ('grid', 'battery', 'efoy', 'diesel', 'solar', 'hybrid')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id)
);

alter table if exists public.tower_templates
  add column if not exists power_type text;

update public.tower_templates
set power_type = 'grid'
where power_type is null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tower_templates'
      and column_name = 'power_mode'
  ) then
    execute $sql$
      update public.tower_templates
      set power_type = case lower(coalesce(power_mode, 'grid'))
        when 'autark' then 'hybrid'
        when 'grid' then 'grid'
        else 'grid'
      end
      where power_type is null or power_type not in ('grid', 'battery', 'efoy', 'diesel', 'solar', 'hybrid')
    $sql$;
  end if;
end $$;

update public.tower_templates
set power_type = 'grid'
where power_type not in ('grid', 'battery', 'efoy', 'diesel', 'solar', 'hybrid');

alter table if exists public.tower_templates
  alter column power_type set default 'grid';

alter table if exists public.tower_templates
  alter column power_type set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'tower_templates_power_mode_check'
      and conrelid = 'public.tower_templates'::regclass
  ) then
    alter table public.tower_templates
      drop constraint tower_templates_power_mode_check;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'tower_templates_power_type_check'
      and conrelid = 'public.tower_templates'::regclass
  ) then
    alter table public.tower_templates
      drop constraint tower_templates_power_type_check;
  end if;

  alter table public.tower_templates
    add constraint tower_templates_power_type_check
    check (power_type in ('grid', 'battery', 'efoy', 'diesel', 'solar', 'hybrid'));
end $$;

create table if not exists public.tower_template_slots (
  id uuid primary key default gen_random_uuid(),
  tower_template_id uuid not null,
  tenant_id uuid not null,
  slot_key text not null,
  slot_order integer not null check (slot_order > 0),
  camera_type text not null default 'none' check (camera_type in ('ptz', 'bullet', 'thermal', 'dome', 'none')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tower_template_slots_template_fk
    foreign key (tower_template_id, tenant_id)
    references public.tower_templates(id, tenant_id)
    on delete cascade,
  unique (tower_template_id, slot_key),
  unique (tower_template_id, slot_order)
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tower_template_slots'
      and column_name = 'template_id'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tower_template_slots'
      and column_name = 'tower_template_id'
  ) then
    alter table public.tower_template_slots
      rename column template_id to tower_template_id;
  end if;
end $$;

alter table if exists public.tower_template_slots
  add column if not exists tower_template_id uuid;

alter table if exists public.tower_template_slots
  add column if not exists tenant_id uuid;

delete from public.tower_template_slots slots
where slots.tower_template_id is null
  or not exists (
    select 1
    from public.tower_templates templates
    where templates.id = slots.tower_template_id
  );

update public.tower_template_slots slots
set tenant_id = templates.tenant_id
from public.tower_templates templates
where slots.tower_template_id = templates.id
  and slots.tenant_id is null;

alter table if exists public.tower_template_slots
  alter column tower_template_id set not null;

alter table if exists public.tower_template_slots
  alter column tenant_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tower_template_slots_template_fk'
      and conrelid = 'public.tower_template_slots'::regclass
  ) then
    alter table public.tower_template_slots
      add constraint tower_template_slots_template_fk
      foreign key (tower_template_id, tenant_id)
      references public.tower_templates(id, tenant_id)
      on delete cascade;
  end if;
end $$;

create table if not exists public.tower_template_components (
  id uuid primary key default gen_random_uuid(),
  tower_template_id uuid not null,
  tenant_id uuid not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tower_template_components_template_fk
    foreign key (tower_template_id, tenant_id)
    references public.tower_templates(id, tenant_id)
    on delete cascade
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tower_template_components'
      and column_name = 'component_name'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tower_template_components'
      and column_name = 'name'
  ) then
    alter table public.tower_template_components
      rename column component_name to name;
  end if;
end $$;

alter table if exists public.tower_template_components
  add column if not exists tower_template_id uuid;

alter table if exists public.tower_template_components
  add column if not exists tenant_id uuid;

alter table if exists public.tower_template_components
  add column if not exists name text;

alter table if exists public.tower_template_components
  add column if not exists is_active boolean not null default true;

delete from public.tower_template_components components
where components.tower_template_id is null
  or not exists (
    select 1
    from public.tower_templates templates
    where templates.id = components.tower_template_id
  );

update public.tower_template_components components
set tenant_id = templates.tenant_id
from public.tower_templates templates
where components.tower_template_id = templates.id
  and components.tenant_id is null;

update public.tower_template_components
set name = trim(name)
where name is not null;

delete from public.tower_template_components
where name is null or trim(name) = '';

alter table if exists public.tower_template_components
  alter column tower_template_id set not null;

alter table if exists public.tower_template_components
  alter column tenant_id set not null;

alter table if exists public.tower_template_components
  alter column name set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tower_template_components_template_fk'
      and conrelid = 'public.tower_template_components'::regclass
  ) then
    alter table public.tower_template_components
      add constraint tower_template_components_template_fk
      foreign key (tower_template_id, tenant_id)
      references public.tower_templates(id, tenant_id)
      on delete cascade;
  end if;
end $$;

create table if not exists public.tower_template_connectivity (
  id uuid primary key default gen_random_uuid(),
  tower_template_id uuid not null,
  tenant_id uuid not null,
  type text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tower_template_connectivity_template_fk
    foreign key (tower_template_id, tenant_id)
    references public.tower_templates(id, tenant_id)
    on delete cascade
);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tower_template_connectivity'
      and column_name = 'connectivity_type'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tower_template_connectivity'
      and column_name = 'type'
  ) then
    alter table public.tower_template_connectivity
      rename column connectivity_type to type;
  end if;
end $$;

alter table if exists public.tower_template_connectivity
  add column if not exists tower_template_id uuid;

alter table if exists public.tower_template_connectivity
  add column if not exists tenant_id uuid;

alter table if exists public.tower_template_connectivity
  add column if not exists type text;

alter table if exists public.tower_template_connectivity
  add column if not exists is_active boolean not null default true;

delete from public.tower_template_connectivity connectivity
where connectivity.tower_template_id is null
  or not exists (
    select 1
    from public.tower_templates templates
    where templates.id = connectivity.tower_template_id
  );

update public.tower_template_connectivity connectivity
set tenant_id = templates.tenant_id
from public.tower_templates templates
where connectivity.tower_template_id = templates.id
  and connectivity.tenant_id is null;

update public.tower_template_connectivity
set type = case lower(coalesce(type, ''))
  when 'lte' then 'lte'
  when '5g' then '5g'
  when 'wlan' then 'wlan'
  when 'wifi' then 'wlan'
  when 'satellite' then 'satellite'
  when 'sat' then 'satellite'
  when 'lan' then 'lan'
  else 'lte'
end;

delete from public.tower_template_components left_entry
using public.tower_template_components right_entry
where left_entry.ctid < right_entry.ctid
  and left_entry.tower_template_id = right_entry.tower_template_id
  and lower(left_entry.name) = lower(right_entry.name);

delete from public.tower_template_connectivity left_entry
using public.tower_template_connectivity right_entry
where left_entry.ctid < right_entry.ctid
  and left_entry.tower_template_id = right_entry.tower_template_id
  and left_entry.type = right_entry.type;

alter table if exists public.tower_template_connectivity
  alter column tower_template_id set not null;

alter table if exists public.tower_template_connectivity
  alter column tenant_id set not null;

alter table if exists public.tower_template_connectivity
  alter column type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tower_template_connectivity_template_fk'
      and conrelid = 'public.tower_template_connectivity'::regclass
  ) then
    alter table public.tower_template_connectivity
      add constraint tower_template_connectivity_template_fk
      foreign key (tower_template_id, tenant_id)
      references public.tower_templates(id, tenant_id)
      on delete cascade;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'tower_template_connectivity_type_check'
      and conrelid = 'public.tower_template_connectivity'::regclass
  ) then
    alter table public.tower_template_connectivity
      drop constraint tower_template_connectivity_type_check;
  end if;

  alter table public.tower_template_connectivity
    add constraint tower_template_connectivity_type_check
    check (type in ('lte', '5g', 'wlan', 'satellite', 'lan'));
end $$;

create unique index if not exists uq_tower_templates_tenant_name
  on public.tower_templates(tenant_id, name);

create unique index if not exists uq_tower_templates_id_tenant
  on public.tower_templates(id, tenant_id);

create unique index if not exists uq_tower_template_slots_key
  on public.tower_template_slots(tower_template_id, slot_key);

create unique index if not exists uq_tower_template_slots_order
  on public.tower_template_slots(tower_template_id, slot_order);

create unique index if not exists uq_tower_template_components_name_ci
  on public.tower_template_components(tower_template_id, lower(name));

create unique index if not exists uq_tower_template_connectivity_type
  on public.tower_template_connectivity(tower_template_id, type);

create index if not exists idx_tower_templates_tenant_id
  on public.tower_templates(tenant_id);

create index if not exists idx_tower_templates_active
  on public.tower_templates(tenant_id, is_active);

create index if not exists idx_tower_template_slots_tenant_id
  on public.tower_template_slots(tenant_id);

create index if not exists idx_tower_template_slots_template_id
  on public.tower_template_slots(tower_template_id);

create index if not exists idx_tower_template_components_tenant_id
  on public.tower_template_components(tenant_id);

create index if not exists idx_tower_template_components_template_id
  on public.tower_template_components(tower_template_id);

create index if not exists idx_tower_template_connectivity_tenant_id
  on public.tower_template_connectivity(tenant_id);

create index if not exists idx_tower_template_connectivity_template_id
  on public.tower_template_connectivity(tower_template_id);

-- Migrates legacy optional components JSON into dedicated component rows.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tower_templates'
      and column_name = 'optional_components'
  ) then
    insert into public.tower_template_components (tower_template_id, tenant_id, name, is_active)
    select
      templates.id,
      templates.tenant_id,
      trim(component_name),
      true
    from public.tower_templates templates,
      lateral jsonb_array_elements_text(coalesce(templates.optional_components, '[]'::jsonb)) as component_name
    where trim(component_name) <> ''
    on conflict do nothing;

    alter table public.tower_templates
      drop column optional_components;
  end if;
end $$;

alter table if exists public.tower_templates
  drop column if exists power_mode;

drop trigger if exists trg_tower_templates_set_updated_at on public.tower_templates;
create trigger trg_tower_templates_set_updated_at
before update on public.tower_templates
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tower_template_slots_set_updated_at on public.tower_template_slots;
create trigger trg_tower_template_slots_set_updated_at
before update on public.tower_template_slots
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tower_template_components_set_updated_at on public.tower_template_components;
create trigger trg_tower_template_components_set_updated_at
before update on public.tower_template_components
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tower_template_connectivity_set_updated_at on public.tower_template_connectivity;
create trigger trg_tower_template_connectivity_set_updated_at
before update on public.tower_template_connectivity
for each row
execute function public.set_updated_at();

alter table public.tower_templates enable row level security;
alter table public.tower_template_slots enable row level security;
alter table public.tower_template_components enable row level security;
alter table public.tower_template_connectivity enable row level security;

drop policy if exists tower_templates_select_tenant on public.tower_templates;
create policy tower_templates_select_tenant
on public.tower_templates
for select
using (public.is_active_tenant_member(tenant_id));

drop policy if exists tower_templates_insert_admin on public.tower_templates;
create policy tower_templates_insert_admin
on public.tower_templates
for insert
with check (public.is_tenant_admin(tenant_id));

drop policy if exists tower_templates_update_admin on public.tower_templates;
create policy tower_templates_update_admin
on public.tower_templates
for update
using (public.is_tenant_admin(tenant_id))
with check (public.is_tenant_admin(tenant_id));

drop policy if exists tower_templates_delete_admin on public.tower_templates;
create policy tower_templates_delete_admin
on public.tower_templates
for delete
using (public.is_tenant_admin(tenant_id));

drop policy if exists tower_template_slots_select_tenant on public.tower_template_slots;
create policy tower_template_slots_select_tenant
on public.tower_template_slots
for select
using (public.is_active_tenant_member(tenant_id));

drop policy if exists tower_template_slots_insert_admin on public.tower_template_slots;
create policy tower_template_slots_insert_admin
on public.tower_template_slots
for insert
with check (public.is_tenant_admin(tenant_id));

drop policy if exists tower_template_slots_update_admin on public.tower_template_slots;
create policy tower_template_slots_update_admin
on public.tower_template_slots
for update
using (public.is_tenant_admin(tenant_id))
with check (public.is_tenant_admin(tenant_id));

drop policy if exists tower_template_slots_delete_admin on public.tower_template_slots;
create policy tower_template_slots_delete_admin
on public.tower_template_slots
for delete
using (public.is_tenant_admin(tenant_id));

drop policy if exists tower_template_components_select_tenant on public.tower_template_components;
create policy tower_template_components_select_tenant
on public.tower_template_components
for select
using (public.is_active_tenant_member(tenant_id));

drop policy if exists tower_template_components_insert_admin on public.tower_template_components;
create policy tower_template_components_insert_admin
on public.tower_template_components
for insert
with check (public.is_tenant_admin(tenant_id));

drop policy if exists tower_template_components_update_admin on public.tower_template_components;
create policy tower_template_components_update_admin
on public.tower_template_components
for update
using (public.is_tenant_admin(tenant_id))
with check (public.is_tenant_admin(tenant_id));

drop policy if exists tower_template_components_delete_admin on public.tower_template_components;
create policy tower_template_components_delete_admin
on public.tower_template_components
for delete
using (public.is_tenant_admin(tenant_id));

drop policy if exists tower_template_connectivity_select_tenant on public.tower_template_connectivity;
create policy tower_template_connectivity_select_tenant
on public.tower_template_connectivity
for select
using (public.is_active_tenant_member(tenant_id));

drop policy if exists tower_template_connectivity_insert_admin on public.tower_template_connectivity;
create policy tower_template_connectivity_insert_admin
on public.tower_template_connectivity
for insert
with check (public.is_tenant_admin(tenant_id));

drop policy if exists tower_template_connectivity_update_admin on public.tower_template_connectivity;
create policy tower_template_connectivity_update_admin
on public.tower_template_connectivity
for update
using (public.is_tenant_admin(tenant_id))
with check (public.is_tenant_admin(tenant_id));

drop policy if exists tower_template_connectivity_delete_admin on public.tower_template_connectivity;
create policy tower_template_connectivity_delete_admin
on public.tower_template_connectivity
for delete
using (public.is_tenant_admin(tenant_id));
