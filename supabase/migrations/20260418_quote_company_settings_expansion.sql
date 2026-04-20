alter table public.company_settings
  add column if not exists address text,
  add column if not exists contact_person text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists currency text default 'EUR',
  add column if not exists intro_text text,
  add column if not exists closing_text text;

alter table public.quotes
  add column if not exists generated_text text,
  add column if not exists concept_text text,
  add column if not exists ai_input_summary text,
  add column if not exists valid_until timestamptz;
