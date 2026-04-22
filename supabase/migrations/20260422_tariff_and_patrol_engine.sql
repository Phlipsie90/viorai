alter table public.quotes
  add column if not exists tariff_snapshot jsonb,
  add column if not exists patrol_snapshot jsonb;


create table if not exists public.tariff_sets (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  category text not null check (category in ('standard', 'military', 'kta')),
  source_name text not null,
  source_date date not null,
  valid_from date not null,
  valid_to date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tariff_entries (
  id uuid primary key default gen_random_uuid(),
  tariff_set_id uuid not null references public.tariff_sets(id) on delete cascade,
  state text not null,
  service_context text not null,
  service_type text not null,
  wage_group text not null,
  duration_from_hours numeric,
  duration_to_hours numeric,
  hourly_rate numeric not null,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tariff_surcharges (
  id uuid primary key default gen_random_uuid(),
  tariff_set_id uuid not null references public.tariff_sets(id) on delete cascade,
  state text not null,
  surcharge_type text not null check (surcharge_type in ('night', 'sunday', 'holiday')),
  mode text not null check (mode in ('percent', 'absolute')),
  value numeric not null,
  time_from time,
  time_to time,
  applies_to_service_type text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tariff_special_rules (
  id uuid primary key default gen_random_uuid(),
  tariff_set_id uuid not null references public.tariff_sets(id) on delete cascade,
  state text not null,
  rule_type text not null,
  condition_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  state text not null,
  date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (state, date)
);

create index if not exists idx_tariff_sets_category_active on public.tariff_sets(category, is_active);
create index if not exists idx_tariff_entries_set_state_service on public.tariff_entries(tariff_set_id, state, service_type);
create index if not exists idx_tariff_entries_duration on public.tariff_entries(duration_from_hours, duration_to_hours);
create index if not exists idx_tariff_surcharges_set_state on public.tariff_surcharges(tariff_set_id, state);
create index if not exists idx_tariff_special_rules_set_state on public.tariff_special_rules(tariff_set_id, state);
create index if not exists idx_holidays_state_date on public.holidays(state, date);

create unique index if not exists uq_tariff_entries_business
  on public.tariff_entries (tariff_set_id, state, service_context, service_type, wage_group, duration_from_hours, duration_to_hours)
  nulls not distinct;

create unique index if not exists uq_tariff_surcharges_business
  on public.tariff_surcharges (tariff_set_id, state, surcharge_type, mode, value, time_from, time_to, applies_to_service_type)
  nulls not distinct;

create unique index if not exists uq_tariff_special_rules_business
  on public.tariff_special_rules (tariff_set_id, state, rule_type);

drop trigger if exists trg_tariff_sets_set_updated_at on public.tariff_sets;
create trigger trg_tariff_sets_set_updated_at
before update on public.tariff_sets
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tariff_entries_set_updated_at on public.tariff_entries;
create trigger trg_tariff_entries_set_updated_at
before update on public.tariff_entries
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tariff_surcharges_set_updated_at on public.tariff_surcharges;
create trigger trg_tariff_surcharges_set_updated_at
before update on public.tariff_surcharges
for each row
execute function public.set_updated_at();

drop trigger if exists trg_tariff_special_rules_set_updated_at on public.tariff_special_rules;
create trigger trg_tariff_special_rules_set_updated_at
before update on public.tariff_special_rules
for each row
execute function public.set_updated_at();

drop trigger if exists trg_holidays_set_updated_at on public.holidays;
create trigger trg_holidays_set_updated_at
before update on public.holidays
for each row
execute function public.set_updated_at();

alter table public.tariff_sets enable row level security;
alter table public.tariff_entries enable row level security;
alter table public.tariff_surcharges enable row level security;
alter table public.tariff_special_rules enable row level security;
alter table public.holidays enable row level security;

drop policy if exists tariff_sets_read_authenticated on public.tariff_sets;
create policy tariff_sets_read_authenticated
on public.tariff_sets
for select
using (auth.role() = 'authenticated');

drop policy if exists tariff_entries_read_authenticated on public.tariff_entries;
create policy tariff_entries_read_authenticated
on public.tariff_entries
for select
using (auth.role() = 'authenticated');

drop policy if exists tariff_surcharges_read_authenticated on public.tariff_surcharges;
create policy tariff_surcharges_read_authenticated
on public.tariff_surcharges
for select
using (auth.role() = 'authenticated');

drop policy if exists tariff_special_rules_read_authenticated on public.tariff_special_rules;
create policy tariff_special_rules_read_authenticated
on public.tariff_special_rules
for select
using (auth.role() = 'authenticated');

drop policy if exists holidays_read_authenticated on public.holidays;
create policy holidays_read_authenticated
on public.holidays
for select
using (auth.role() = 'authenticated');

insert into public.tariff_sets (
  key, title, category, source_name, source_date, valid_from, valid_to, is_active, notes
)
values
  ('bdsw_standard_2026_0401', 'BDSW Standardtarife 2026-04-01', 'standard', 'BDSW Uebersicht_Entgelt_2026_0401a.pdf', '2026-04-01', '2026-04-01', null, true, 'Seed aus BDSW-Entgeltübersicht ausgewählter Entgeltgruppen'),
  ('bdsw_military_2026_0401', 'BDSW Militärische Anlagen 2026-04-01', 'military', 'BDSW Uebersicht_Entgelt_milit._Anlagen_Bw_2026_0401.pdf', '2026-04-01', '2026-04-01', null, true, 'Seed aus BDSW-Entgeltübersicht militärische Anlagen/Bundeswehr'),
  ('bdsw_kta_2026_0201', 'BDSW Kerntechnische Anlagen 2026-02-01', 'kta', 'BDSW Uebersicht_Entgelt_KTA_2026_0201.pdf', '2026-02-01', '2026-02-01', null, true, 'Seed aus BDSW-Entgeltübersicht kerntechnische Anlagen')
on conflict (key) do update set
  title = excluded.title,
  category = excluded.category,
  source_name = excluded.source_name,
  source_date = excluded.source_date,
  valid_from = excluded.valid_from,
  valid_to = excluded.valid_to,
  is_active = excluded.is_active,
  notes = excluded.notes,
  updated_at = now();

insert into public.tariff_entries (tariff_set_id, state, service_context, service_type, wage_group, duration_from_hours, duration_to_hours, hourly_rate, note, sort_order)
select ts.id, seed.state, seed.service_context, seed.service_type, seed.wage_group, seed.duration_from_hours, seed.duration_to_hours, seed.hourly_rate, seed.note, seed.sort_order
from (
  values
    ('bdsw_standard_2026_0401', 'baden-wuerttemberg', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.14, '15,14', 10),
    ('bdsw_standard_2026_0401', 'baden-wuerttemberg', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 17.0, '17,00', 20),
    ('bdsw_standard_2026_0401', 'baden-wuerttemberg', 'revier', 'revierwachdienst', 'EG-REV', null, null, 16.3, '16,30', 30),
    ('bdsw_standard_2026_0401', 'baden-wuerttemberg', 'werkschutz', 'gssk', 'GSSK', null, null, 18.4, '18,40', 40),
    ('bdsw_standard_2026_0401', 'baden-wuerttemberg', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 20.95, '20,95', 50),
    ('bdsw_standard_2026_0401', 'baden-wuerttemberg', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.14, '15,14', 60),
    ('bdsw_standard_2026_0401', 'baden-wuerttemberg', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 15.14, '15,14', 70),
    ('bdsw_standard_2026_0401', 'bayern', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 14.92, '14,92', 10),
    ('bdsw_standard_2026_0401', 'bayern', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 17.59, '17,59', 20),
    ('bdsw_standard_2026_0401', 'bayern', 'revier', 'revierwachdienst', 'EG-REV', null, null, 15.55, '15,55', 30),
    ('bdsw_standard_2026_0401', 'bayern', 'werkschutz', 'gssk', 'GSSK', null, null, 18.33, '18,33', 40),
    ('bdsw_standard_2026_0401', 'bayern', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 21.06, '21,06', 50),
    ('bdsw_standard_2026_0401', 'bayern', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 14.92, '14,92', 60),
    ('bdsw_standard_2026_0401', 'bayern', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 16.42, '16,42 1)', 70),
    ('bdsw_standard_2026_0401', 'berlin', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.15, '15,15', 10),
    ('bdsw_standard_2026_0401', 'berlin', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 16.8, '16,80', 20),
    ('bdsw_standard_2026_0401', 'berlin', 'revier', 'revierwachdienst', 'EG-REV', null, null, 16.2, '16,20 5)', 30),
    ('bdsw_standard_2026_0401', 'berlin', 'werkschutz', 'gssk', 'GSSK', null, null, 16.8, '16,80', 40),
    ('bdsw_standard_2026_0401', 'berlin', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 17.65, '17,65', 50),
    ('bdsw_standard_2026_0401', 'berlin', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.55, '15,55', 60),
    ('bdsw_standard_2026_0401', 'berlin', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 15.55, '15,55', 70),
    ('bdsw_standard_2026_0401', 'brandenburg', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.15, '15,15', 10),
    ('bdsw_standard_2026_0401', 'brandenburg', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 16.8, '16,80', 20),
    ('bdsw_standard_2026_0401', 'brandenburg', 'revier', 'revierwachdienst', 'EG-REV', null, null, 16.2, '16,20 5)', 30),
    ('bdsw_standard_2026_0401', 'brandenburg', 'werkschutz', 'gssk', 'GSSK', null, null, 16.8, '16,80', 40),
    ('bdsw_standard_2026_0401', 'brandenburg', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 17.65, '17,65', 50),
    ('bdsw_standard_2026_0401', 'brandenburg', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.55, '15,55', 60),
    ('bdsw_standard_2026_0401', 'brandenburg', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 15.55, '15,55', 70),
    ('bdsw_standard_2026_0401', 'bremen', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 14.6, '14,60', 10),
    ('bdsw_standard_2026_0401', 'bremen', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 15.44, '15,44', 20),
    ('bdsw_standard_2026_0401', 'bremen', 'revier', 'revierwachdienst', 'EG-REV', null, null, 14.72, '14,72', 30),
    ('bdsw_standard_2026_0401', 'bremen', 'werkschutz', 'gssk', 'GSSK', null, null, 16.26, '16,26', 40),
    ('bdsw_standard_2026_0401', 'bremen', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 16.26, '16,26', 50),
    ('bdsw_standard_2026_0401', 'bremen', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 14.6, '14,60', 60),
    ('bdsw_standard_2026_0401', 'bremen', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 14.6, '14,60', 70),
    ('bdsw_standard_2026_0401', 'hamburg', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.14, '15,14', 10),
    ('bdsw_standard_2026_0401', 'hamburg', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 15.32, '15,32', 20),
    ('bdsw_standard_2026_0401', 'hamburg', 'revier', 'revierwachdienst', 'EG-REV', null, null, 15.32, '15,32', 30),
    ('bdsw_standard_2026_0401', 'hamburg', 'werkschutz', 'gssk', 'GSSK', null, null, 16.77, '16,77', 40),
    ('bdsw_standard_2026_0401', 'hamburg', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 16.77, '16,77', 50),
    ('bdsw_standard_2026_0401', 'hamburg', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.14, '15,14', 60),
    ('bdsw_standard_2026_0401', 'hessen', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.15, '15,15', 10),
    ('bdsw_standard_2026_0401', 'hessen', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 15.84, '15,84', 20),
    ('bdsw_standard_2026_0401', 'hessen', 'revier', 'revierwachdienst', 'EG-REV', null, null, 15.5, '15,50', 30),
    ('bdsw_standard_2026_0401', 'hessen', 'werkschutz', 'gssk', 'GSSK', null, null, 17.28, '17,28', 40),
    ('bdsw_standard_2026_0401', 'hessen', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 20.07, '20,07', 50),
    ('bdsw_standard_2026_0401', 'hessen', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.15, '15,15', 60),
    ('bdsw_standard_2026_0401', 'hessen', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 15.6, '15,60', 70),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.27, '15,27', 10),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 16.44, '16,44', 20),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'revier', 'revierwachdienst', 'EG-REV', null, null, 15.74, '15,74', 30),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'werkschutz', 'gssk', 'GSSK', null, null, 16.44, '16,44', 40),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 17.62, '17,62', 50),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.74, '15,74', 60),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 16.24, '16,24 2)', 70),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.14, '15,14', 10),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'revier', 'revierwachdienst', 'EG-REV', null, null, 16.28, '16,28', 30),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'werkschutz', 'gssk', 'GSSK', null, null, 17.77, '17,77', 40),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 17.77, '17,77', 50),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.14, '15,14', 60),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 15.54, '15,54 6)', 70),
    ('bdsw_standard_2026_0401', 'nordrhein-westfalen', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.11, '15,11', 10),
    ('bdsw_standard_2026_0401', 'nordrhein-westfalen', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 18.47, '18,47', 20),
    ('bdsw_standard_2026_0401', 'nordrhein-westfalen', 'revier', 'revierwachdienst', 'EG-REV', null, null, 17.91, '17,91', 30),
    ('bdsw_standard_2026_0401', 'nordrhein-westfalen', 'werkschutz', 'gssk', 'GSSK', null, null, 21.83, '21,83', 40),
    ('bdsw_standard_2026_0401', 'nordrhein-westfalen', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 22.28, '22,28', 50),
    ('bdsw_standard_2026_0401', 'nordrhein-westfalen', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.47, '15,47', 60),
    ('bdsw_standard_2026_0401', 'nordrhein-westfalen', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 16.84, '16,84', 70),
    ('bdsw_standard_2026_0401', 'rheinland-pfalz', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.14, '15,14', 10),
    ('bdsw_standard_2026_0401', 'rheinland-pfalz', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 15.72, '15,72', 20),
    ('bdsw_standard_2026_0401', 'rheinland-pfalz', 'revier', 'revierwachdienst', 'EG-REV', null, null, 15.49, '15,49', 30),
    ('bdsw_standard_2026_0401', 'rheinland-pfalz', 'werkschutz', 'gssk', 'GSSK', null, null, 16.98, '16,98', 40),
    ('bdsw_standard_2026_0401', 'rheinland-pfalz', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 16.98, '16,98', 50),
    ('bdsw_standard_2026_0401', 'rheinland-pfalz', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 16.51, '16,51', 70),
    ('bdsw_standard_2026_0401', 'sachsen', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.15, '15,15', 10),
    ('bdsw_standard_2026_0401', 'sachsen', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 15.64, '15,64', 20),
    ('bdsw_standard_2026_0401', 'sachsen', 'revier', 'revierwachdienst', 'EG-REV', null, null, 15.64, '15,64', 30),
    ('bdsw_standard_2026_0401', 'sachsen', 'werkschutz', 'gssk', 'GSSK', null, null, 16.89, '16,89', 40),
    ('bdsw_standard_2026_0401', 'sachsen', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 18.09, '18,09', 50),
    ('bdsw_standard_2026_0401', 'sachsen', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.64, '15,64', 60),
    ('bdsw_standard_2026_0401', 'sachsen', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 15.64, '15,64 3)', 70),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.15, '15,15', 10),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 16.86, '16,86', 20),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'revier', 'revierwachdienst', 'EG-REV', null, null, 15.64, '15,64', 30),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'werkschutz', 'gssk', 'GSSK', null, null, 16.86, '16,86', 40),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 18.09, '18,09', 50),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.64, '15,64', 60),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 16.39, '16,39 4)', 70),
    ('bdsw_standard_2026_0401', 'schleswig-holstein', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.1, '15,10', 10),
    ('bdsw_standard_2026_0401', 'schleswig-holstein', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 16.71, '16,71', 20),
    ('bdsw_standard_2026_0401', 'schleswig-holstein', 'revier', 'revierwachdienst', 'EG-REV', null, null, 15.1, '15,10', 30),
    ('bdsw_standard_2026_0401', 'schleswig-holstein', 'werkschutz', 'gssk', 'GSSK', null, null, 16.96, '16,96', 40),
    ('bdsw_standard_2026_0401', 'schleswig-holstein', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 16.96, '16,96', 50),
    ('bdsw_standard_2026_0401', 'schleswig-holstein', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.1, '15,10', 60),
    ('bdsw_standard_2026_0401', 'schleswig-holstein', 'unterkunft', 'fluechtlingsunterkunft', 'EG-FLU', null, null, 15.59, '15,59', 70),
    ('bdsw_standard_2026_0401', 'thueringen', 'objektschutz', 'separatwachdienst', 'EG-OBJ', null, null, 15.15, '15,15', 10),
    ('bdsw_standard_2026_0401', 'thueringen', 'nsl', 'nrz_nsl', 'EG-NSL', null, null, 16.03, '16,03', 20),
    ('bdsw_standard_2026_0401', 'thueringen', 'revier', 'revierwachdienst', 'EG-REV', null, null, 15.51, '15,51', 30),
    ('bdsw_standard_2026_0401', 'thueringen', 'werkschutz', 'gssk', 'GSSK', null, null, 16.5, '16,50', 40),
    ('bdsw_standard_2026_0401', 'thueringen', 'werkschutz', 'fachkraft_schutz_sicherheit', 'FSS', null, null, 16.77, '16,77', 50),
    ('bdsw_standard_2026_0401', 'thueringen', 'veranstaltung', 'veranstaltungsdienst', 'EG-VER', null, null, 15.15, '15,15', 60),
    ('bdsw_military_2026_0401', 'baden-wuerttemberg', 'military', 'bundeswehr', 'BW-A', null, null, 21.09, '21,09 €', 110),
    ('bdsw_military_2026_0401', 'bayern', 'military', 'bundeswehr', 'BW-A', 0, 12, 19.43, '19,43 € unter 12-Std.-D.', 110),
    ('bdsw_military_2026_0401', 'bayern', 'military', 'bundeswehr', 'BW-A', 12, 24, 17.97, '17,97 € 12 bis 24-Std.-D.', 120),
    ('bdsw_military_2026_0401', 'berlin', 'military', 'bundeswehr', 'BW-A', 0, 9, 19.95, '19,95 € bis 9-Std. *', 110),
    ('bdsw_military_2026_0401', 'berlin', 'military', 'bundeswehr', 'BW-A', 9, null, 19.15, '19,15 € über 9-Std. *', 120),
    ('bdsw_military_2026_0401', 'brandenburg', 'military', 'bundeswehr', 'BW-A', 0, 9, 19.95, '19,95 € bis 9-Std. *', 110),
    ('bdsw_military_2026_0401', 'brandenburg', 'military', 'bundeswehr', 'BW-A', 9, null, 19.15, '19,15 € über 9-Std. *', 120),
    ('bdsw_military_2026_0401', 'bremen', 'military', 'bundeswehr', 'BW-A', null, null, 15.67, '15,67 €', 110),
    ('bdsw_military_2026_0401', 'hamburg', 'military', 'bundeswehr', 'BW-A', null, null, 16.33, '16,33 €', 110),
    ('bdsw_military_2026_0401', 'hessen', 'military', 'bundeswehr', 'BW-A', null, null, 17.78, '17,78 €', 110),
    ('bdsw_military_2026_0401', 'mecklenburg-vorpommern', 'military', 'bundeswehr', 'BW-A', 0, 9, 18.47, '18,47 € bis 9-Std. ***', 110),
    ('bdsw_military_2026_0401', 'mecklenburg-vorpommern', 'military', 'bundeswehr', 'BW-A', 9, 12, 17.67, '17,67 € 9-12-Std. ***', 120),
    ('bdsw_military_2026_0401', 'mecklenburg-vorpommern', 'military', 'bundeswehr', 'BW-A', 12, null, 17.14, '17,14 € über 12 Std. ***', 130),
    ('bdsw_military_2026_0401', 'niedersachsen', 'military', 'bundeswehr', 'BW-PROBE', null, null, 17.18, '17,18 € in Probe', 110),
    ('bdsw_military_2026_0401', 'niedersachsen', 'military', 'bundeswehr', 'BW-A', null, null, 17.54, '17,54 € nach Probe', 120),
    ('bdsw_military_2026_0401', 'nordrhein-westfalen', 'military', 'bundeswehr', 'BW-A', null, null, 18.39, '18,39 €', 110),
    ('bdsw_military_2026_0401', 'rheinland-pfalz', 'military', 'bundeswehr', 'BW-A', null, null, 17.99, '17,99 €', 110),
    ('bdsw_military_2026_0401', 'saarland', 'military', 'bundeswehr', 'BW-A', null, null, 17.99, '17,99 €', 110),
    ('bdsw_military_2026_0401', 'sachsen', 'military', 'bundeswehr', 'BW-A', null, null, 16.89, '16,89 €', 110),
    ('bdsw_military_2026_0401', 'sachsen-anhalt', 'military', 'bundeswehr', 'BW-A', 0, 9, 19.55, '19,55 € bis 9 Std. **', 110),
    ('bdsw_military_2026_0401', 'sachsen-anhalt', 'military', 'bundeswehr', 'BW-A', 9, null, 18.85, '18,85 € über 9 Std. **', 120),
    ('bdsw_military_2026_0401', 'schleswig-holstein', 'military', 'bundeswehr', 'BW-A', 0, 24, 18.0, '18,00 € im 24-Std.-D.', 110),
    ('bdsw_military_2026_0401', 'thueringen', 'military', 'bundeswehr', 'BW-A', null, null, 17.8, '17,80 €', 110),
    ('bdsw_kta_2026_0201', 'baden-wuerttemberg', 'kta', 'kerntechnik', 'KTA', null, null, 24.86, '24,86 €', 210),
    ('bdsw_kta_2026_0201', 'bayern', 'kta', 'kerntechnik', 'OK 1', null, null, 24.82, '24,82 € (OK 1)', 210),
    ('bdsw_kta_2026_0201', 'bayern', 'kta', 'kerntechnik', 'OK S', null, null, 25.69, '25,69 € (OK S)', 220),
    ('bdsw_kta_2026_0201', 'berlin', 'kta', 'kerntechnik', 'KTA', null, null, 21.42, '21,42 €', 210),
    ('bdsw_kta_2026_0201', 'brandenburg', 'kta', 'kerntechnik', 'KTA', null, null, 21.42, '21,42 €', 210),
    ('bdsw_kta_2026_0201', 'hessen', 'kta', 'kerntechnik', 'Gruppe C', null, null, 22.36, 'Gruppe C = 22,36 €', 210),
    ('bdsw_kta_2026_0201', 'mecklenburg-vorpommern', 'kta', 'kerntechnik', 'KTA', null, null, 21.7, '21,70 €', 210),
    ('bdsw_kta_2026_0201', 'niedersachsen', 'kta', 'kerntechnik', 'A4', null, null, 26.26, 'A4 = 26,26 €', 210),
    ('bdsw_kta_2026_0201', 'nordrhein-westfalen', 'kta', 'kerntechnik', 'KTA', null, null, 23.39, '23,39 €', 210),
    ('bdsw_kta_2026_0201', 'sachsen-anhalt', 'kta', 'kerntechnik', 'LG 1.2', null, null, 22.88, '22,88 € (LG 1.2)', 210),
    ('bdsw_kta_2026_0201', 'schleswig-holstein', 'kta', 'kerntechnik', 'KTA', null, null, 26.45, '26,45 €', 210)
) as seed(tariff_key, state, service_context, service_type, wage_group, duration_from_hours, duration_to_hours, hourly_rate, note, sort_order)
join public.tariff_sets ts on ts.key = seed.tariff_key
on conflict do nothing;

insert into public.tariff_surcharges (tariff_set_id, state, surcharge_type, mode, value, time_from, time_to, applies_to_service_type, note)
select
  ts.id,
  seed.state,
  seed.surcharge_type,
  seed.mode,
  seed.value,
  case
    when regexp_replace(coalesce(seed.time_from, ''), '[^0-9:]', '', 'g') ~ '^[0-9]{2}:[0-9]{2}$'
      then regexp_replace(seed.time_from, '[^0-9:]', '', 'g')::time
    else null
  end as time_from,
  case
    when regexp_replace(coalesce(seed.time_to, ''), '[^0-9:]', '', 'g') ~ '^[0-9]{2}:[0-9]{2}$'
      then regexp_replace(seed.time_to, '[^0-9:]', '', 'g')::time
    else null
  end as time_to,
  seed.applies_to_service_type,
  seed.note
from (
  values
    ('bdsw_standard_2026_0401', 'baden-wuerttemberg', 'night', 'percent', 15.0, '20:00', '06:00', null, '20:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'baden-wuerttemberg', 'sunday', 'percent', 35.0, null, null, null, '35%'),
    ('bdsw_standard_2026_0401', 'baden-wuerttemberg', 'holiday', 'percent', 100.0, null, null, null, '100%'),
    ('bdsw_standard_2026_0401', 'bayern', 'night', 'percent', 23.0, '20:00', '06:00', null, '20:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'bayern', 'sunday', 'percent', 26.0, '06:00', '20:00', null, '06:00 - 20:00'),
    ('bdsw_standard_2026_0401', 'bayern', 'sunday', 'percent', 3.0, '20:00', '06:00', null, '20.00 - 06.00'),
    ('bdsw_standard_2026_0401', 'bayern', 'holiday', 'percent', 100.0, '06:00', '20:00', null, '06.00 - 20:00'),
    ('bdsw_standard_2026_0401', 'bayern', 'holiday', 'percent', 77.0, '20:00', '06:00', null, '20:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'berlin', 'night', 'percent', 15.0, '22:00', '06:00,', null, '22:00 - 06:00,'),
    ('bdsw_standard_2026_0401', 'berlin', 'night', 'percent', 10.0, null, null, null, '(10% Veranstaltungs-'),
    ('bdsw_standard_2026_0401', 'berlin', 'sunday', 'percent', 25.0, null, null, null, '25%,'),
    ('bdsw_standard_2026_0401', 'berlin', 'sunday', 'percent', 10.0, null, null, null, '(10%'),
    ('bdsw_standard_2026_0401', 'berlin', 'holiday', 'percent', 50.0, null, null, null, '50%,'),
    ('bdsw_standard_2026_0401', 'berlin', 'holiday', 'percent', 10.0, null, null, null, '(10%'),
    ('bdsw_standard_2026_0401', 'brandenburg', 'night', 'percent', 15.0, '22:00', '06:00,', null, '22:00 - 06:00,'),
    ('bdsw_standard_2026_0401', 'brandenburg', 'night', 'percent', 10.0, null, null, null, '(10% Veranstaltungs-'),
    ('bdsw_standard_2026_0401', 'brandenburg', 'sunday', 'percent', 25.0, null, null, null, '25%,'),
    ('bdsw_standard_2026_0401', 'brandenburg', 'sunday', 'percent', 10.0, null, null, null, '(10%'),
    ('bdsw_standard_2026_0401', 'brandenburg', 'holiday', 'percent', 50.0, null, null, null, '50%,'),
    ('bdsw_standard_2026_0401', 'brandenburg', 'holiday', 'percent', 10.0, null, null, null, '(10%'),
    ('bdsw_standard_2026_0401', 'bremen', 'night', 'percent', 5.0, '23:00', '06:00', null, '23:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'bremen', 'sunday', 'percent', 50.0, null, null, null, '50%'),
    ('bdsw_standard_2026_0401', 'bremen', 'holiday', 'percent', 100.0, null, null, null, '100%'),
    ('bdsw_standard_2026_0401', 'hamburg', 'night', 'percent', 15.0, '20:00', '06:00', null, '20:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'hamburg', 'sunday', 'percent', 50.0, null, null, null, '50%'),
    ('bdsw_standard_2026_0401', 'hamburg', 'holiday', 'percent', 100.0, null, null, null, '100%'),
    ('bdsw_standard_2026_0401', 'hessen', 'night', 'percent', 12.0, '20:00', '06:00', null, '20:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'hessen', 'night', 'percent', 12.0, null, null, null, 'LG § 2, II 1 = 12 %'),
    ('bdsw_standard_2026_0401', 'hessen', 'sunday', 'percent', 25.0, '06:00', '20:00', null, '06:00 - 20:00'),
    ('bdsw_standard_2026_0401', 'hessen', 'holiday', 'percent', 100.0, '06:00', '20:00', null, '06.00 - 20.00'),
    ('bdsw_standard_2026_0401', 'hessen', 'holiday', 'percent', 75.0, '20:00', '06:00', null, '20:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'night', 'percent', 10.0, '22:00', '06:00', null, '22:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'sunday', 'percent', 25.0, null, null, null, '25%,'),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'sunday', 'percent', 10.0, null, null, null, '(10% für'),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'holiday', 'percent', 50.0, null, null, null, '50%,'),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'holiday', 'percent', 10.0, null, null, null, '(10% für'),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'night', 'percent', 10.0, '23:00', '06:00', null, '23:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'sunday', 'percent', 50.0, null, null, null, '50 %'),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'sunday', 'percent', 25.0, null, null, null, '25% 7)'),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'holiday', 'percent', 100.0, null, null, null, '100 %'),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'holiday', 'percent', 75.0, null, null, null, '75% 6)'),
    ('bdsw_standard_2026_0401', 'nordrhein-westfalen', 'night', 'percent', 10.0, '22:00', '06:00', null, '22:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'nordrhein-westfalen', 'sunday', 'percent', 50.0, null, null, null, '50%'),
    ('bdsw_standard_2026_0401', 'nordrhein-westfalen', 'holiday', 'percent', 100.0, null, null, null, '100%'),
    ('bdsw_standard_2026_0401', 'rheinland-pfalz', 'night', 'percent', 10.0, '20:00', '06:00', null, '20:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'rheinland-pfalz', 'sunday', 'percent', 25.0, null, null, null, '25%'),
    ('bdsw_standard_2026_0401', 'rheinland-pfalz', 'holiday', 'percent', 100.0, null, null, null, '100%'),
    ('bdsw_standard_2026_0401', 'sachsen', 'night', 'percent', 10.0, '23:00', '06:00', null, '23:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'sachsen', 'sunday', 'percent', 25.0, null, null, null, '25%'),
    ('bdsw_standard_2026_0401', 'sachsen', 'holiday', 'percent', 50.0, null, null, null, '50%'),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'night', 'percent', 10.0, '22:00', '06:00', null, '22:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'sunday', 'percent', 25.0, null, null, null, '25%,'),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'sunday', 'percent', 10.0, null, null, null, '(10%'),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'holiday', 'percent', 50.0, null, null, null, '50%,'),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'holiday', 'percent', 10.0, null, null, null, '(10%'),
    ('bdsw_standard_2026_0401', 'schleswig-holstein', 'night', 'percent', 15.0, '20:00', '06:00', null, '20:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'schleswig-holstein', 'sunday', 'percent', 10.0, null, null, null, '10%'),
    ('bdsw_standard_2026_0401', 'schleswig-holstein', 'holiday', 'percent', 50.0, null, null, null, '50%'),
    ('bdsw_standard_2026_0401', 'thueringen', 'night', 'percent', 10.0, '22:00', '06:00', null, '22:00 - 06:00'),
    ('bdsw_standard_2026_0401', 'thueringen', 'sunday', 'percent', 25.0, null, null, null, '25%'),
    ('bdsw_standard_2026_0401', 'thueringen', 'holiday', 'percent', 50.0, null, null, null, '50%'),
    ('bdsw_military_2026_0401', 'baden-wuerttemberg', 'night', 'percent', 15.0, '20:00', '06:00', 'bundeswehr', '20:00 - 06:00'),
    ('bdsw_military_2026_0401', 'bayern', 'night', 'percent', 23.0, '20:00', '06:00', 'bundeswehr', '20:00 - 06:00'),
    ('bdsw_military_2026_0401', 'berlin', 'night', 'percent', 15.0, '22:00', '06:00', 'bundeswehr', '22:00 - 06:00'),
    ('bdsw_military_2026_0401', 'brandenburg', 'night', 'percent', 15.0, '22:00', '06:00', 'bundeswehr', '22:00 - 06:00'),
    ('bdsw_military_2026_0401', 'bremen', 'night', 'percent', 5.0, '23:00', '06:00', 'bundeswehr', '23:00 - 06:00'),
    ('bdsw_military_2026_0401', 'hamburg', 'night', 'percent', 15.0, '20:00', '06:00', 'bundeswehr', '20:00 - 06:00'),
    ('bdsw_military_2026_0401', 'hessen', 'night', 'percent', 25.0, '20:00', '06:00', 'bundeswehr', '20:00 - 06:00'),
    ('bdsw_military_2026_0401', 'mecklenburg-vorpommern', 'night', 'percent', 15.0, '22:00', '06:00', 'bundeswehr', '22:00 - 06:00'),
    ('bdsw_military_2026_0401', 'niedersachsen', 'night', 'percent', 15.0, '23:00', '06:00', 'bundeswehr', '23:00 - 06:00'),
    ('bdsw_military_2026_0401', 'nordrhein-westfalen', 'night', 'percent', 10.0, '22:00', '06:00', 'bundeswehr', '22:00 - 06:00'),
    ('bdsw_military_2026_0401', 'rheinland-pfalz', 'night', 'percent', 10.0, '20:00', '06:00', 'bundeswehr', '20:00 - 06:00'),
    ('bdsw_military_2026_0401', 'saarland', 'night', 'percent', 10.0, '20:00', '06:00', 'bundeswehr', '20:00 - 06:00'),
    ('bdsw_military_2026_0401', 'sachsen', 'night', 'percent', 10.0, '23:00', '06:00', 'bundeswehr', '23:00 - 06:00'),
    ('bdsw_military_2026_0401', 'sachsen-anhalt', 'night', 'percent', 15.0, '22:00', '06:00', 'bundeswehr', '22:00 - 06:00'),
    ('bdsw_military_2026_0401', 'schleswig-holstein', 'night', 'percent', 15.0, '20:00', '06:00', 'bundeswehr', '20:00 - 06:00'),
    ('bdsw_military_2026_0401', 'thueringen', 'night', 'percent', 10.0, '22:00', '06:00', 'bundeswehr', '22:00 - 06:00'),
    ('bdsw_military_2026_0401', 'all', 'sunday', 'percent', 50.0, null, null, null, 'Default Sonntagszuschlag'),
    ('bdsw_military_2026_0401', 'all', 'holiday', 'percent', 100.0, null, null, null, 'Default Feiertagszuschlag'),
    ('bdsw_kta_2026_0201', 'all', 'sunday', 'percent', 50.0, null, null, null, 'Default Sonntagszuschlag'),
    ('bdsw_kta_2026_0201', 'all', 'holiday', 'percent', 100.0, null, null, null, 'Default Feiertagszuschlag'),
    ('bdsw_kta_2026_0201', 'all', 'night', 'percent', 25.0, '20:00', '06:00', 'kerntechnik', 'Default Nachtzuschlag KTA')
) as seed(tariff_key, state, surcharge_type, mode, value, time_from, time_to, applies_to_service_type, note)
join public.tariff_sets ts on ts.key = seed.tariff_key
on conflict do nothing;

insert into public.tariff_special_rules (tariff_set_id, state, rule_type, condition_json, result_json, note)
select ts.id, seed.state, seed.rule_type, seed.condition_json::jsonb, seed.result_json::jsonb, seed.note
from (
  values
    ('bdsw_standard_2026_0401', 'bayern', 'fluechtlingsunterkunft_zulage', '{"service_type":"fluechtlingsunterkunft"}', '{"absolute_hourly_add":1.50}', 'Fußnote 1) Bayern Zulage Flüchtlingsunterkünfte'),
    ('bdsw_standard_2026_0401', 'mecklenburg-vorpommern', 'fluechtlingsunterkunft_zulage', '{"service_type":"fluechtlingsunterkunft"}', '{"absolute_hourly_add":0.50}', 'Fußnote 2) MV Zulage Flüchtlingsunterkünfte'),
    ('bdsw_standard_2026_0401', 'sachsen', 'sonderregel_objektschutz_allgemein', '{"service_type":"fluechtlingsunterkunft"}', '{"note":"allg. Lohn fuer Objektschutz"}', 'Fußnote 3) Sachsen'),
    ('bdsw_standard_2026_0401', 'sachsen-anhalt', 'fluechtlingsunterkunft_zulage', '{"service_type":"fluechtlingsunterkunft"}', '{"absolute_hourly_add":0.75}', 'Fußnote 4) Sachsen-Anhalt Zulage Flüchtlingsunterkünfte'),
    ('bdsw_standard_2026_0401', 'berlin', 'revier_zulage', '{"service_type":"revierwachdienst"}', '{"absolute_hourly_add":0.65}', 'Fußnote 5) Berlin Revierzulage'),
    ('bdsw_standard_2026_0401', 'brandenburg', 'revier_zulage', '{"service_type":"revierwachdienst"}', '{"absolute_hourly_add":0.65}', 'Fußnote 5) Brandenburg Revierzulage'),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'fluechtlingsunterkunft_zulage', '{"service_type":"fluechtlingsunterkunft"}', '{"absolute_hourly_add":0.40}', 'Fußnote 6) Niedersachsen Zulage Flüchtlingsunterkünfte'),
    ('bdsw_standard_2026_0401', 'niedersachsen', 'feiertag_untere_lg', '{"surcharge_type":"holiday"}', '{"percent_override":75}', 'Fußnote 7) Feiertagszuschlag untere Lohngruppen'),
    ('bdsw_military_2026_0401', 'berlin', 'military_site_allowance', '{"service_type":"bundeswehr"}', '{"absolute_hourly_add":0.70}', 'Militär Fußnote * Berlin'),
    ('bdsw_military_2026_0401', 'brandenburg', 'military_site_allowance', '{"service_type":"bundeswehr"}', '{"absolute_hourly_add":0.70}', 'Militär Fußnote * Brandenburg'),
    ('bdsw_military_2026_0401', 'sachsen-anhalt', 'military_site_allowance', '{"service_type":"bundeswehr"}', '{"absolute_hourly_add":0.50}', 'Militär Fußnote ** Sachsen-Anhalt'),
    ('bdsw_military_2026_0401', 'mecklenburg-vorpommern', 'military_site_allowance', '{"service_type":"bundeswehr"}', '{"absolute_hourly_add":0.75}', 'Militär Fußnote *** Mecklenburg-Vorpommern'),
    ('bdsw_kta_2026_0201', 'all', 'kta_tarifvertrag_eigenstaendig', '{"state":["mecklenburg-vorpommern","niedersachsen","schleswig-holstein"]}', '{"note":"eigenstaendiger Tarifvertrag fuer KTA"}', 'KTA Fußnote * eigenständiger Tarifvertrag')
) as seed(tariff_key, state, rule_type, condition_json, result_json, note)
join public.tariff_sets ts on ts.key = seed.tariff_key
on conflict do nothing;

insert into public.holidays (state, date, name)
values
  ('all', '2026-01-01', 'Neujahr'),
  ('all', '2026-04-03', 'Karfreitag'),
  ('all', '2026-04-06', 'Ostermontag'),
  ('all', '2026-05-01', 'Tag der Arbeit'),
  ('all', '2026-05-14', 'Christi Himmelfahrt'),
  ('all', '2026-05-25', 'Pfingstmontag'),
  ('all', '2026-10-03', 'Tag der Deutschen Einheit'),
  ('all', '2026-12-25', '1. Weihnachtstag'),
  ('all', '2026-12-26', '2. Weihnachtstag')
on conflict (state, date) do update set
  name = excluded.name,
  updated_at = now();
