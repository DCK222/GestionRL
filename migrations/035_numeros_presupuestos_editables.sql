-- Ejecutar después de 034_presupuestos_desde_12.sql.
-- Permite editar números de presupuestos sin alterar facturas ni documentos convertidos.
begin;
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
 y:=extract(year from saved_date);
 num:=nullif(trim(p->>'number'),'');
 if num is null then
  num:=previous.number;
 elsif num ~ '^[0-9]{1,10}$' then
  num:='P-'||y||'-'||num;
 end if;
 if num is not null then
  if num !~ '^P-[0-9]{4}-[0-9]{1,10}$' then
   raise exception 'Número de presupuesto no válido. Usa un número positivo o el formato P-AAAA-0012';
  end if;
  if split_part(num,'-',2)::integer<>y then
   raise exception 'El año del número debe coincidir con la fecha del presupuesto';
  end if;
  if split_part(num,'-',3)::bigint not between 1 and 2147483646 then
   raise exception 'El número de presupuesto debe estar entre 1 y 2147483646';
  end if;
  n:=split_part(num,'-',3)::integer;
  num:='P-'||y||'-'||lpad(n::text,greatest(4,length(n::text)),'0');
 end if;
 -- Serializa la numeración manual y automática de la misma serie.
 insert into rl_sequences values(y,'P','production',1) on conflict do nothing;
 perform 1 from rl_sequences where year=y and series='P' and environment='production' for update;
 if num is null then
  update rl_sequences set next_value=next_value+1 where year=y and series='P' and environment='production' returning next_value-1 into n;
  num:='P-'||y||'-'||lpad(n::text,greatest(4,length(n::text)),'0');
 end if;
 if exists(select 1 from rl_quotes where number=num and id<>rid) then
  raise exception 'Ya existe un presupuesto con el número %',num;
 end if;
 -- Un número manual superior adelanta el contador; uno inferior nunca lo reduce.
 update rl_sequences set next_value=greatest(next_value,n+1) where year=y and series='P' and environment='production';
 insert into rl_quotes(id,number,client_id,client_snapshot,issuer_snapshot,date,valid_until,project_date,location,lines,subtotal,vat,withholding_rate,withholding,total,notes,exemption,payment_terms)
 values(rid,num,c.id,to_jsonb(c),company,saved_date,validity,nullif(p->>'project_date','')::date,coalesce(p->>'location',''),ls,b,v,wr,w,b+v-w,coalesce(p->>'notes',''),coalesce(p->>'exemption',''),coalesce(p->>'payment_terms',''))
 on conflict(id) do update set number=excluded.number,client_id=excluded.client_id,client_snapshot=excluded.client_snapshot,issuer_snapshot=excluded.issuer_snapshot,
 date=excluded.date,valid_until=excluded.valid_until,project_date=excluded.project_date,location=excluded.location,
 lines=excluded.lines,subtotal=excluded.subtotal,vat=excluded.vat,withholding_rate=excluded.withholding_rate,withholding=excluded.withholding,
 total=excluded.total,notes=excluded.notes,exemption=excluded.exemption,payment_terms=excluded.payment_terms,status='draft',version=rl_quotes.version+1;
 return rid;
end $$;
revoke all on function public.rl_save_quote(jsonb) from public,anon;
grant execute on function public.rl_save_quote(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
