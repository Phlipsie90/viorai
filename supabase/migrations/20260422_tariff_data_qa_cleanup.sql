create or replace function public.normalize_tariff_state(input text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(input, '')))
    when '' then 'all'
    when 'all' then 'all'
    when 'baden-württemberg' then 'baden-wuerttemberg'
    when 'baden württemberg' then 'baden-wuerttemberg'
    when 'baden-wuerttemberg' then 'baden-wuerttemberg'
    when 'thüringen' then 'thueringen'
    when 'thuringen' then 'thueringen'
    when 'nrw' then 'nordrhein-westfalen'
    when 'nordrhein westfalen' then 'nordrhein-westfalen'
    when 'rheinland pfalz' then 'rheinland-pfalz'
    when 'rheinland-pfalz-/' then 'rheinland-pfalz'
    when 'mecklenburg vorpommern' then 'mecklenburg-vorpommern'
    when 'mecklenburg-' then 'mecklenburg-vorpommern'
    when 'sachsen anhalt' then 'sachsen-anhalt'
    when 'schleswig holstein' then 'schleswig-holstein'
    else lower(trim(input))
  end;
$$;

with ranked as (
  select
    id,
    row_number() over (
      partition by
        tariff_set_id,
        public.normalize_tariff_state(state),
        service_context,
        service_type,
        wage_group,
        duration_from_hours,
        duration_to_hours
      order by updated_at desc, created_at desc, id desc
    ) as rn
  from public.tariff_entries
)
delete from public.tariff_entries t
using ranked r
where t.id = r.id
  and r.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by
        tariff_set_id,
        public.normalize_tariff_state(state),
        surcharge_type,
        mode,
        value,
        time_from,
        time_to,
        applies_to_service_type
      order by updated_at desc, created_at desc, id desc
    ) as rn
  from public.tariff_surcharges
)
delete from public.tariff_surcharges t
using ranked r
where t.id = r.id
  and r.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by
        tariff_set_id,
        public.normalize_tariff_state(state),
        rule_type
      order by updated_at desc, created_at desc, id desc
    ) as rn
  from public.tariff_special_rules
)
delete from public.tariff_special_rules t
using ranked r
where t.id = r.id
  and r.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by
        public.normalize_tariff_state(state),
        date
      order by updated_at desc, created_at desc, id desc
    ) as rn
  from public.holidays
)
delete from public.holidays t
using ranked r
where t.id = r.id
  and r.rn > 1;

update public.tariff_entries
set state = public.normalize_tariff_state(state)
where state <> public.normalize_tariff_state(state);

update public.tariff_surcharges
set state = public.normalize_tariff_state(state)
where state <> public.normalize_tariff_state(state);

update public.tariff_special_rules
set state = public.normalize_tariff_state(state)
where state <> public.normalize_tariff_state(state);

update public.holidays
set state = public.normalize_tariff_state(state)
where state <> public.normalize_tariff_state(state);

update public.tariff_surcharges s
set
  applies_to_service_type = 'veranstaltungsdienst',
  note = trim(concat(coalesce(s.note, ''), ' [QA: auf Veranstaltungsdienst begrenzt]'))
from public.tariff_sets ts
where s.tariff_set_id = ts.id
  and ts.key = 'bdsw_standard_2026_0401'
  and s.applies_to_service_type is null
  and s.mode = 'percent'
  and s.value = 10
  and s.note ilike '(10%';

create or replace view public.missing_rates as
with required_standard as (
  select * from (
    values
      ('objektschutz'::text, 'separatwachdienst'::text),
      ('nsl'::text, 'nrz_nsl'::text),
      ('revier'::text, 'revierwachdienst'::text),
      ('werkschutz'::text, 'gssk'::text),
      ('werkschutz'::text, 'fachkraft_schutz_sicherheit'::text),
      ('veranstaltung'::text, 'veranstaltungsdienst'::text),
      ('unterkunft'::text, 'fluechtlingsunterkunft'::text)
  ) v(service_context, service_type)
),
active_standard_sets as (
  select id, key
  from public.tariff_sets
  where category = 'standard'
    and is_active = true
),
states_per_set as (
  select distinct e.tariff_set_id, public.normalize_tariff_state(e.state) as state
  from public.tariff_entries e
  join active_standard_sets s on s.id = e.tariff_set_id
  where public.normalize_tariff_state(e.state) <> 'all'
)
select
  s.key as tariff_set_key,
  sp.state,
  rs.service_context,
  rs.service_type,
  'missing_required_standard_rate'::text as issue
from states_per_set sp
join active_standard_sets s on s.id = sp.tariff_set_id
cross join required_standard rs
left join public.tariff_entries e
  on e.tariff_set_id = sp.tariff_set_id
 and public.normalize_tariff_state(e.state) = sp.state
 and e.service_context = rs.service_context
 and e.service_type = rs.service_type
where e.id is null
union all
select
  ts.key as tariff_set_key,
  public.normalize_tariff_state(e.state) as state,
  e.service_context,
  e.service_type,
  'invalid_hourly_rate'::text as issue
from public.tariff_entries e
join public.tariff_sets ts on ts.id = e.tariff_set_id
where e.hourly_rate is null or e.hourly_rate <= 0;

create or replace view public.invalid_time_ranges as
select
  ts.key as tariff_set_key,
  public.normalize_tariff_state(s.state) as state,
  s.surcharge_type,
  s.mode,
  s.value,
  s.time_from,
  s.time_to,
  s.applies_to_service_type,
  case
    when s.time_from is null and s.time_to is not null then 'time_from_missing'
    when s.time_from is not null and s.time_to is null then 'time_to_missing'
    when s.time_from = s.time_to then 'zero_length_time_window'
    else 'unknown'
  end as issue
from public.tariff_surcharges s
join public.tariff_sets ts on ts.id = s.tariff_set_id
where (s.time_from is null and s.time_to is not null)
   or (s.time_from is not null and s.time_to is null)
   or (s.time_from = s.time_to);

create or replace view public.duplicate_business_keys as
with entry_dupes as (
  select
    'tariff_entries'::text as table_name,
    ts.key as tariff_set_key,
    public.normalize_tariff_state(e.state) as state,
    e.service_context,
    e.service_type,
    e.wage_group,
    e.duration_from_hours,
    e.duration_to_hours,
    null::text as surcharge_type,
    null::text as mode,
    null::numeric as value,
    null::time as time_from,
    null::time as time_to,
    null::text as applies_to_service_type,
    null::text as rule_type,
    count(*)::int as duplicate_count
  from public.tariff_entries e
  join public.tariff_sets ts on ts.id = e.tariff_set_id
  group by
    ts.key,
    public.normalize_tariff_state(e.state),
    e.service_context,
    e.service_type,
    e.wage_group,
    e.duration_from_hours,
    e.duration_to_hours
  having count(*) > 1
),
surcharge_dupes as (
  select
    'tariff_surcharges'::text as table_name,
    ts.key as tariff_set_key,
    public.normalize_tariff_state(s.state) as state,
    null::text as service_context,
    null::text as service_type,
    null::text as wage_group,
    null::numeric as duration_from_hours,
    null::numeric as duration_to_hours,
    s.surcharge_type,
    s.mode,
    s.value,
    s.time_from,
    s.time_to,
    s.applies_to_service_type,
    null::text as rule_type,
    count(*)::int as duplicate_count
  from public.tariff_surcharges s
  join public.tariff_sets ts on ts.id = s.tariff_set_id
  group by
    ts.key,
    public.normalize_tariff_state(s.state),
    s.surcharge_type,
    s.mode,
    s.value,
    s.time_from,
    s.time_to,
    s.applies_to_service_type
  having count(*) > 1
),
rule_dupes as (
  select
    'tariff_special_rules'::text as table_name,
    ts.key as tariff_set_key,
    public.normalize_tariff_state(r.state) as state,
    null::text as service_context,
    null::text as service_type,
    null::text as wage_group,
    null::numeric as duration_from_hours,
    null::numeric as duration_to_hours,
    null::text as surcharge_type,
    null::text as mode,
    null::numeric as value,
    null::time as time_from,
    null::time as time_to,
    null::text as applies_to_service_type,
    r.rule_type,
    count(*)::int as duplicate_count
  from public.tariff_special_rules r
  join public.tariff_sets ts on ts.id = r.tariff_set_id
  group by
    ts.key,
    public.normalize_tariff_state(r.state),
    r.rule_type
  having count(*) > 1
)
select * from entry_dupes
union all
select * from surcharge_dupes
union all
select * from rule_dupes;
