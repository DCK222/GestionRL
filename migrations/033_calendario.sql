-- Actualización incremental: ejecutar sobre una instalación existente de Gestión RL.
begin;
create table if not exists public.rl_events (
 id uuid primary key default gen_random_uuid(), version integer not null default 1,
 title text not null check(length(trim(title)) between 1 and 200),
 client_id uuid not null references public.rl_clients(id), date date not null check(isfinite(date)),
 start_time time not null, end_time time not null, check(end_time>start_time),
 location text not null check(length(trim(location)) between 1 and 1000),
 map_url text not null default '' check(map_url='' or map_url ~ '^https://(www\.google\.(com|es)|maps\.google\.com)/maps(\?|/embed(\?|/|$))'),
 price numeric(12,2) not null default 0 check(price>=0 and price::text not in ('NaN','Infinity','-Infinity')),
 participants integer not null default 0 check(participants between 0 and 1000000),
 participant_names text not null default '',
 category text not null check(category in ('workshop','birthday','school','meeting','other')),
 status text not null default 'planned' check(status in ('planned','confirmed','cancelled')),
 notes text not null default '', created_at timestamptz not null default now()
);
create index if not exists events_date on public.rl_events(date,start_time);
alter table public.rl_events enable row level security;
revoke all on public.rl_events from public,anon,authenticated;
grant select on public.rl_events to authenticated;
drop policy if exists member_read on public.rl_events;
create policy member_read on public.rl_events for select to authenticated using(public.rl_role() is not null);
drop trigger if exists audit_change on public.rl_events;
create trigger audit_change after insert or update or delete on public.rl_events for each row execute function public.rl_audit_change();

create or replace function public.rl_save_event(p jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare rid uuid; previous rl_events;
begin
 if not rl_write() then raise exception 'Acceso denegado'; end if;
 rid:=(p->>'id')::uuid;
 if rid is null then raise exception 'Identificador de evento obligatorio'; end if;
 perform pg_advisory_xact_lock(hashtext(rid::text));
 select * into previous from rl_events where id=rid for update;
 if previous.id is not null then
  if (p->>'version')::integer is distinct from previous.version then
   raise exception 'Otro usuario ha modificado este evento. Cierra el editor y actualiza el calendario.';
  end if;
 elsif (p->>'version')::integer is distinct from 0 then
  raise exception 'El evento ya no existe. Actualiza el calendario.';
 end if;
 insert into rl_events(id,title,client_id,date,start_time,end_time,location,map_url,price,participants,participant_names,category,status,notes)
 values(rid,trim(p->>'title'),(p->>'client_id')::uuid,(p->>'date')::date,(p->>'start_time')::time,(p->>'end_time')::time,
 trim(p->>'location'),coalesce(p->>'map_url',''),(p->>'price')::numeric,(p->>'participants')::integer,
 coalesce(p->>'participant_names',''),p->>'category',p->>'status',coalesce(p->>'notes',''))
 on conflict(id) do update set title=excluded.title,client_id=excluded.client_id,date=excluded.date,
 start_time=excluded.start_time,end_time=excluded.end_time,location=excluded.location,map_url=excluded.map_url,
 price=excluded.price,participants=excluded.participants,participant_names=excluded.participant_names,
 category=excluded.category,status=excluded.status,notes=excluded.notes,version=rl_events.version+1;
 return rid;
end $$;
create or replace function public.rl_delete_event(p_id uuid,p_version integer) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not rl_write() then raise exception 'Acceso denegado'; end if;
 delete from rl_events where id=p_id and version=p_version;
 if not found then raise exception 'El evento ha cambiado o ya no existe. Actualiza el calendario.'; end if;
end $$;
revoke all on function public.rl_save_event(jsonb),public.rl_delete_event(uuid,integer) from public,anon,authenticated;
grant execute on function public.rl_save_event(jsonb),public.rl_delete_event(uuid,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
