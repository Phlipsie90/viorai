alter table public.projects
  add column if not exists state text,
  add column if not exists object_type text,
  add column if not exists area_size text,
  add column if not exists requested_units numeric;

alter table public.quotes
  add column if not exists mode text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'quotes'
      and column_name = 'mode'
  ) then
    alter table public.quotes
      drop constraint if exists quotes_mode_check;

    alter table public.quotes
      add constraint quotes_mode_check
      check (mode is null or mode in ('quick', 'standard', 'manual'));
  end if;
end
$$;

create index if not exists idx_customers_tenant_company_name
  on public.customers (tenant_id, lower(company_name));

create index if not exists idx_customers_tenant_email
  on public.customers (tenant_id, lower(email));
