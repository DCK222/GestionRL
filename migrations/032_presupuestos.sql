-- Ejecutar después de 031_estabilidad_facturas.sql. Actualización incremental sin importación de datos.
begin;
create table if not exists public.rl_quotes (
 id uuid primary key default gen_random_uuid(), number text not null unique,
 client_id uuid not null references public.rl_clients(id), client_snapshot jsonb not null, issuer_snapshot jsonb not null,
 date date not null, valid_until date, due_date date, project_date date, location text not null default '',
 lines jsonb not null check(jsonb_typeof(lines)='array'), subtotal numeric(12,2) not null, vat numeric(12,2) not null,
 withholding_rate numeric(5,2) not null default 0 check(withholding_rate between 0 and 100),
 withholding numeric(12,2) not null, total numeric(12,2) not null,
 status text not null default 'draft' check(status in ('draft','sent','accepted','rejected','converted')),
 invoice_id uuid unique references public.rl_invoices(id),
 invoice_type text not null default 'F1' check(invoice_type='F1'), rectifies uuid check(rectifies is null),
 notes text not null default '', exemption text not null default '', payment_terms text not null default '',
 document_id uuid check(document_id is null), environment text not null default 'production' check(environment='production'),
 payment_reviewed boolean not null default false check(not payment_reviewed), version integer not null default 1,
 created_at timestamptz not null default now(),
 check(valid_until is null or valid_until>=date), check((status='converted')=(invoice_id is not null))
);
alter table public.rl_quotes enable row level security;
revoke all on public.rl_quotes from public,anon,authenticated;
grant select on public.rl_quotes to authenticated;
drop policy if exists member_read on public.rl_quotes;
create policy member_read on public.rl_quotes for select to authenticated using(public.rl_role() is not null);
create index if not exists quote_date on public.rl_quotes(date);
create index if not exists quote_client on public.rl_quotes(client_id);
drop trigger if exists audit_change on public.rl_quotes;
create trigger audit_change after insert or update or delete on public.rl_quotes for each row execute function public.rl_audit_change();

create or replace function public.rl_save_quote(p jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare
 rid uuid; previous rl_quotes; c rl_clients; company jsonb; saved_date date; validity date; y integer; n integer; num text;
 item jsonb; q numeric; price numeric; discount numeric; tax numeric; line_base numeric;
 b numeric:=0; v numeric:=0; wr numeric; w numeric; ls jsonb:='[]';
begin
 if not rl_write() then raise exception 'Acceso denegado'; end if;
 rid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid());
 perform pg_advisory_xact_lock(hashtext(rid::text));
 select * into previous from rl_quotes where id=rid for update;
 if previous.id is not null then
  if previous.invoice_id is not null then raise exception 'El presupuesto ya está convertido en factura y no se puede modificar'; end if;
  if p->>'version' is null or (p->>'version')::integer<>previous.version then
   raise exception 'El presupuesto ha cambiado o ya se guardó desde otra sesión. Cierra el editor y vuelve a abrirlo antes de guardar.';
  end if;
 elsif coalesce((p->>'version')::integer,0)<>0 then
  raise exception 'El presupuesto ya no existe. Actualiza los datos';
 end if;
 select * into strict c from rl_clients where id=(p->>'client_id')::uuid;
 select s.company into strict company from rl_settings s where id=1;
 saved_date:=(p->>'date')::date; validity:=nullif(p->>'valid_until','')::date;
 if saved_date is null or saved_date>(current_timestamp at time zone 'Europe/Madrid')::date then raise exception 'Fecha de presupuesto no válida'; end if;
 if validity<saved_date then raise exception 'La validez no puede ser anterior a la fecha del presupuesto'; end if;
 if previous.id is not null and extract(year from saved_date)<>extract(year from previous.date) then raise exception 'La fecha debe conservar el año del presupuesto numerado'; end if;
 if jsonb_typeof(p->'lines') is distinct from 'array' then raise exception 'Añada las líneas del presupuesto'; end if;
 if jsonb_array_length(p->'lines') not between 1 and 1000 then raise exception 'Añada entre una y mil líneas'; end if;
 for item in select value from jsonb_array_elements(p->'lines') loop
  q:=(item->>'quantity')::numeric; price:=(item->>'price')::numeric;
  discount:=coalesce((item->>'discount')::numeric,0); tax:=coalesce((item->>'vat_rate')::numeric,0);
  if q is null or price is null or q::text in ('NaN','Infinity','-Infinity')
    or price::text in ('NaN','Infinity','-Infinity') or discount::text in ('NaN','Infinity','-Infinity')
    or tax::text in ('NaN','Infinity','-Infinity') then raise exception 'Cantidad, precio, descuento e IVA deben ser números finitos'; end if;
  if q<=0 or price<0 or discount not between 0 and 100 or tax not between 0 and 100
    or length(trim(coalesce(item->>'description','')))=0 then raise exception 'Línea no válida'; end if;
  line_base:=round(q*price*(1-discount/100),2); b:=b+line_base; v:=v+round(line_base*tax/100,2);
  ls:=ls||jsonb_build_array(jsonb_build_object('description',trim(item->>'description'),
   'quantity',q,'price',price,'discount',discount,'vat_rate',tax,'unit',coalesce(item->>'unit',''),
   'base',line_base,'vat',round(line_base*tax/100,2),'historical_amount',false));
 end loop;
 wr:=coalesce((p->>'withholding_rate')::numeric,0);
 if wr::text in ('NaN','Infinity','-Infinity') or wr not between 0 and 100 then raise exception 'Retención no válida'; end if;
 wr:=round(wr,2);
 w:=round(b*wr/100,2);
 num:=previous.number;
 if previous.id is null then
  y:=extract(year from saved_date);
  insert into rl_sequences values(y,'P','production',1) on conflict do nothing;
  update rl_sequences set next_value=next_value+1 where year=y and series='P' and environment='production' returning next_value-1 into n;
  num:='P-'||y||'-'||lpad(n::text,greatest(4,length(n::text)),'0');
 end if;
 insert into rl_quotes(id,number,client_id,client_snapshot,issuer_snapshot,date,valid_until,project_date,location,lines,subtotal,vat,withholding_rate,withholding,total,notes,exemption,payment_terms)
 values(rid,num,c.id,to_jsonb(c),company,saved_date,validity,nullif(p->>'project_date','')::date,coalesce(p->>'location',''),ls,b,v,wr,w,b+v-w,coalesce(p->>'notes',''),coalesce(p->>'exemption',''),coalesce(p->>'payment_terms',''))
 on conflict(id) do update set client_id=excluded.client_id,client_snapshot=excluded.client_snapshot,issuer_snapshot=excluded.issuer_snapshot,
 date=excluded.date,valid_until=excluded.valid_until,project_date=excluded.project_date,location=excluded.location,
 lines=excluded.lines,subtotal=excluded.subtotal,vat=excluded.vat,withholding_rate=excluded.withholding_rate,withholding=excluded.withholding,
 total=excluded.total,notes=excluded.notes,exemption=excluded.exemption,payment_terms=excluded.payment_terms,status='draft',version=rl_quotes.version+1;
 return rid;
end $$;

create or replace function public.rl_set_quote_status(quote uuid,expected_version integer,next_status text) returns void
language plpgsql security definer set search_path=public as $$
declare q rl_quotes;
begin
 if not rl_write() then raise exception 'Acceso denegado'; end if;
 select * into strict q from rl_quotes where id=quote for update;
 if q.invoice_id is not null then raise exception 'El presupuesto ya está convertido en factura'; end if;
 if expected_version is null or expected_version<>q.version then raise exception 'El presupuesto ha cambiado. Actualiza los datos antes de continuar'; end if;
 if next_status is null or next_status not in ('draft','sent','accepted','rejected') then raise exception 'Estado de presupuesto no válido'; end if;
 if next_status='accepted' and q.valid_until<(current_timestamp at time zone 'Europe/Madrid')::date then raise exception 'El presupuesto está caducado. Actualiza su validez'; end if;
 update rl_quotes set status=next_status,version=version+1 where id=q.id;
end $$;

create or replace function public.rl_convert_quote(quote uuid,expected_version integer) returns uuid
language plpgsql security definer set search_path=public as $$
declare q rl_quotes; rid uuid; environment text; current_date_madrid date:=(current_timestamp at time zone 'Europe/Madrid')::date;
begin
 if not rl_write() then raise exception 'Acceso denegado'; end if;
 -- Lock the source so concurrent conversions and retries return the same invoice.
 select * into strict q from rl_quotes where id=quote for update;
 if q.invoice_id is not null then return q.invoice_id; end if;
 if expected_version is null or expected_version<>q.version then raise exception 'El presupuesto ha cambiado. Actualiza los datos antes de convertirlo'; end if;
 if q.status='rejected' then raise exception 'No se puede convertir un presupuesto rechazado'; end if;
 if q.valid_until<current_date_madrid then raise exception 'El presupuesto está caducado. Actualiza su validez'; end if;
 select case when verifactu_enabled then verifactu_environment else 'production' end into strict environment from rl_settings where id=1 for update;
 -- Use the invoice save function to validate and recalculate, without issuing or allocating an invoice number.
 rid:=rl_save_invoice(to_jsonb(q)||jsonb_build_object('id',gen_random_uuid(),'version',0,'date',current_date_madrid,
  'due_date',null,'environment',environment,'notes',concat_ws(E'\n',nullif(q.notes,''),'Presupuesto origen: '||q.number)));
 update rl_invoices set client_snapshot=q.client_snapshot,issuer_snapshot=q.issuer_snapshot,lines=q.lines where id=rid;
 update rl_quotes set status='converted',invoice_id=rid,version=version+1 where id=q.id;
 return rid;
end $$;
revoke all on function public.rl_save_quote(jsonb),public.rl_set_quote_status(uuid,integer,text),public.rl_convert_quote(uuid,integer) from public,anon;
grant execute on function public.rl_save_quote(jsonb),public.rl_set_quote_status(uuid,integer,text),public.rl_convert_quote(uuid,integer) to authenticated;
notify pgrst, 'reload schema';
commit;
