alter table public.quotes
  add column if not exists final_text text,
  add column if not exists margin_target numeric,
  add column if not exists subtotal_net numeric,
  add column if not exists vat_amount numeric,
  add column if not exists total_gross numeric,
  add column if not exists pdf_storage_path text,
  add column if not exists pdf_public_url text;

create table if not exists public.offer_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  position integer not null,
  title text not null,
  description text,
  unit text not null default 'Stk',
  quantity numeric not null default 0,
  unit_price_net numeric not null default 0,
  total_price_net numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_offer_items_tenant_id on public.offer_items(tenant_id);
create index if not exists idx_offer_items_quote_id on public.offer_items(quote_id);
create unique index if not exists idx_offer_items_quote_position on public.offer_items(quote_id, position);

drop trigger if exists trg_offer_items_set_updated_at on public.offer_items;
create trigger trg_offer_items_set_updated_at
before update on public.offer_items
for each row
execute function public.set_updated_at();

alter table public.offer_items enable row level security;

drop policy if exists offer_items_tenant_access on public.offer_items;
create policy offer_items_tenant_access
on public.offer_items
for all
using (public.is_active_tenant_member(tenant_id))
with check (public.is_active_tenant_member(tenant_id));

insert into storage.buckets (id, name, public)
values ('quote-pdfs', 'quote-pdfs', true)
on conflict (id) do nothing;

drop policy if exists quote_pdfs_select on storage.objects;
create policy quote_pdfs_select
on storage.objects
for select
using (
  bucket_id = 'quote-pdfs'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.is_active_tenant_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists quote_pdfs_insert on storage.objects;
create policy quote_pdfs_insert
on storage.objects
for insert
with check (
  bucket_id = 'quote-pdfs'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.is_active_tenant_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists quote_pdfs_update on storage.objects;
create policy quote_pdfs_update
on storage.objects
for update
using (
  bucket_id = 'quote-pdfs'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.is_active_tenant_member(split_part(name, '/', 1)::uuid)
)
with check (
  bucket_id = 'quote-pdfs'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.is_active_tenant_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists quote_pdfs_delete on storage.objects;
create policy quote_pdfs_delete
on storage.objects
for delete
using (
  bucket_id = 'quote-pdfs'
  and split_part(name, '/', 1) ~* '^[0-9a-f-]{36}$'
  and public.is_active_tenant_member(split_part(name, '/', 1)::uuid)
);

