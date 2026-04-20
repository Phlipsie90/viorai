create table if not exists public.tower_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  power_mode text not null default 'grid' check (power_mode in ('autark', 'grid')),
  optional_components jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name),
  unique (id, tenant_id)
);

create unique index if not exists uq_tower_templates_tenant_name
  on public.tower_templates(tenant_id, name);

create unique index if not exists uq_tower_templates_id_tenant
  on public.tower_templates(id, tenant_id);

create table if not exists public.tower_template_slots (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  tenant_id uuid not null,
  slot_key text not null,
  slot_order integer not null check (slot_order > 0),
  camera_type text not null default 'none' check (camera_type in ('ptz', 'bullet', 'thermal', 'dome', 'none')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tower_template_slots_template_fk
    foreign key (template_id, tenant_id)
    references public.tower_templates(id, tenant_id)
    on delete cascade,
  unique (template_id, slot_key),
  unique (template_id, slot_order)
);

create unique index if not exists uq_tower_template_slots_key
  on public.tower_template_slots(template_id, slot_key);

create unique index if not exists uq_tower_template_slots_order
  on public.tower_template_slots(template_id, slot_order);

create index if not exists idx_tower_templates_tenant_id
  on public.tower_templates(tenant_id);

create index if not exists idx_tower_templates_active
  on public.tower_templates(tenant_id, is_active);

create index if not exists idx_tower_template_slots_tenant_id
  on public.tower_template_slots(tenant_id);

create index if not exists idx_tower_template_slots_template_id
  on public.tower_template_slots(template_id);

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

alter table public.tower_templates enable row level security;
alter table public.tower_template_slots enable row level security;

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
