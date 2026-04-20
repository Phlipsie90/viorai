alter table public.quotes
  add column if not exists number text,
  add column if not exists service_type text,
  add column if not exists sent_at timestamp with time zone;

alter table public.company_settings
  add column if not exists primary_color text,
  add column if not exists secondary_color text,
  add column if not exists pricing_templates jsonb not null default '{}'::jsonb;

update public.company_settings
   set primary_color = coalesce(nullif(primary_color, ''), '#2563eb'),
       secondary_color = coalesce(nullif(secondary_color, ''), '#0f172a')
 where primary_color is null
    or secondary_color is null;

create unique index if not exists uniq_quotes_tenant_number
  on public.quotes(tenant_id, number)
  where number is not null;

create or replace function public.next_quote_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year text := to_char(now(), 'YYYY');
  next_sequence integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('quote-number:' || p_tenant_id::text || ':' || current_year, 0));

  select coalesce(
           max(
             case
               when number ~ ('^AN-' || current_year || '-[0-9]{4}$')
                 then split_part(number, '-', 3)::integer
               else null
             end
           ),
           0
         ) + 1
    into next_sequence
    from public.quotes
   where tenant_id = p_tenant_id;

  return 'AN-' || current_year || '-' || lpad(next_sequence::text, 4, '0');
end;
$$;

grant execute on function public.next_quote_number(uuid) to authenticated;
