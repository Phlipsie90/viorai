alter table public.customers
  add column if not exists street text,
  add column if not exists postal_code text,
  add column if not exists city text;

alter table public.quotes
  add column if not exists tariff_context text,
  add column if not exists state text,
  add column if not exists wage_group text,
  add column if not exists duty_duration_hours numeric,
  add column if not exists employer_factor numeric,
  add column if not exists time_model text,
  add column if not exists planner_camera_count integer not null default 0,
  add column if not exists planner_tower_count integer not null default 0,
  add column if not exists planner_recorder_count integer not null default 0,
  add column if not exists planner_switch_count integer not null default 0,
  add column if not exists planner_obstacle_count integer not null default 0,
  add column if not exists calculation_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists monthly_amount numeric,
  add column if not exists one_time_amount numeric,
  add column if not exists net_total numeric,
  add column if not exists gross_total numeric,
  add column if not exists pdf_path text;

create index if not exists idx_quotes_tenant_status_created_at
  on public.quotes (tenant_id, status, created_at desc);

create index if not exists idx_quotes_customer_created_at
  on public.quotes (customer_id, created_at desc);
