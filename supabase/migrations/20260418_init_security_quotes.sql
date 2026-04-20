create extension if not exists "pgcrypto";

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  billing_address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  location text not null,
  site_address text,
  description text,
  start_date date,
  end_date date,
  runtime_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  positions jsonb not null default '[]'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  generated_text text,
  concept_text text,
  ai_input_summary text,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_settings (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  logo_url text,
  letterhead text,
  footer text,
  address text,
  contact_person text,
  email text,
  phone text,
  website text,
  payment_terms text,
  vat_rate numeric(6,4) not null default 0.19,
  currency text default 'EUR',
  intro_text text,
  closing_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_customer_id on public.projects(customer_id);
create index if not exists idx_quotes_customer_id on public.quotes(customer_id);
create index if not exists idx_quotes_project_id on public.quotes(project_id);
create index if not exists idx_quotes_status on public.quotes(status);
