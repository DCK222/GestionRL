-- Actualización incremental. No importa ni sustituye datos o usuarios.
begin;
alter table public.rl_invoices add column if not exists version integer not null default 1;

create or replace function public.rl_immutable_invoice() returns trigger
language plpgsql set search_path=public as $$
begin
 if OLD.status <> 'draft' then
  if TG_OP='DELETE' then raise exception 'No se pueden eliminar facturas numeradas'; end if;
  if (to_jsonb(NEW)-array['payment_reviewed','version']) is distinct from
     (to_jsonb(OLD)-array['payment_reviewed','version']) then
   if (select verifactu_enabled from rl_settings where id=1)
      or exists(select 1 from rl_fiscal_records where invoice_id=OLD.id) then
    raise exception 'Factura protegida por VeriFactu. Emita una factura rectificativa.';
   end if;
   if (NEW.number,NEW.status,NEW.environment,NEW.invoice_type,NEW.rectifies,NEW.issuer_snapshot,NEW.document_id)
      is distinct from (OLD.number,OLD.status,OLD.environment,OLD.invoice_type,OLD.rectifies,OLD.issuer_snapshot,OLD.document_id) then
    raise exception 'No se puede cambiar la numeración, origen ni identidad de una factura emitida';
   end if;
  end if;
 end if;
 if TG_OP='UPDATE' then NEW.version:=OLD.version+1; return NEW; end if;
 return OLD;
end $$;

create or replace function public.rl_save_invoice(p jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare
 rid uuid; c rl_clients; settings rl_settings; previous rl_invoices;
 item jsonb; b numeric:=0; v numeric:=0; w numeric; wr numeric;
 line_base numeric; ls jsonb:='[]'; q numeric; price numeric; discount numeric; tax numeric;
 issued boolean:=false; saved_date date; paid numeric;
begin
 if not rl_write() then raise exception 'Acceso denegado'; end if;
 rid:=coalesce(nullif(p->>'id','')::uuid,gen_random_uuid());
 perform pg_advisory_xact_lock(hashtext(rid::text));
 select * into previous from rl_invoices where id=rid for update;
 select * into strict settings from rl_settings where id=1 for update;
 if previous.id is not null then
  if p->>'version' is null or (p->>'version')::integer<>previous.version then
   raise exception 'La factura ha cambiado o ya se guardó desde otra sesión. Cierra el editor y vuelve a abrirla antes de guardar. Tus cambios no se han sobrescrito.';
  end if;
  issued:=previous.status<>'draft';
  if issued and (settings.verifactu_enabled or exists(select 1 from rl_fiscal_records where invoice_id=rid)) then
   raise exception 'Factura protegida por VeriFactu. Emita una factura rectificativa.';
  end if;
  if issued and (coalesce(p->>'environment',previous.environment)<>previous.environment
     or coalesce(p->>'invoice_type',previous.invoice_type)<>previous.invoice_type
     or nullif(p->>'rectifies','')::uuid is distinct from previous.rectifies) then
   raise exception 'No se puede cambiar el entorno ni tipo de una factura emitida';
  end if;
 elsif coalesce((p->>'version')::integer,0)<>0 then
  raise exception 'La factura ya no existe. Actualiza los datos';
 end if;
 select * into strict c from rl_clients where id=(p->>'client_id')::uuid;
 if jsonb_typeof(p->'lines') is distinct from 'array' then raise exception 'Añada las líneas de la factura'; end if;
 if jsonb_array_length(p->'lines') not between 1 and 1000 then raise exception 'Añada entre una y mil líneas'; end if;
 for item in select value from jsonb_array_elements(p->'lines') loop
  q:=(item->>'quantity')::numeric;
  price:=(item->>'price')::numeric;
  discount:=coalesce((item->>'discount')::numeric,0);
  tax:=coalesce((item->>'vat_rate')::numeric,0);
  if q is null or price is null or q::text in ('NaN','Infinity','-Infinity')
     or price::text in ('NaN','Infinity','-Infinity') or discount::text in ('NaN','Infinity','-Infinity')
     or tax::text in ('NaN','Infinity','-Infinity') then raise exception 'Cantidad, precio, descuento e IVA deben ser números finitos'; end if;
  if q<=0 or discount not between 0 and 100 or tax not between 0 and 100
     or length(trim(coalesce(item->>'description','')))=0
     or (price<0 and coalesce(p->>'invoice_type','F1')='F1') then raise exception 'Línea no válida'; end if;
  line_base:=round(q*price*(1-discount/100),2);
  b:=b+line_base; v:=v+round(line_base*tax/100,2);
  -- Ignore client-supplied totals and historical flags; always recalculate.
  ls:=ls||jsonb_build_array(jsonb_build_object('description',trim(item->>'description'),
    'quantity',q,'price',price,'discount',discount,'vat_rate',tax,
    'base',line_base,'vat',round(line_base*tax/100,2),'historical_amount',false));
 end loop;
 wr:=coalesce((p->>'withholding_rate')::numeric,0);
 if wr::text in ('NaN','Infinity','-Infinity') or wr not between 0 and 100 then raise exception 'Retención no válida'; end if;
 w:=round(b*wr/100,2);
 saved_date:=(p->>'date')::date;
 if saved_date is null or saved_date>(current_timestamp at time zone 'Europe/Madrid')::date then raise exception 'Fecha de factura no válida'; end if;
 if coalesce(p->>'invoice_type','F1')<>'F1' and nullif(p->>'rectifies','') is null then raise exception 'Seleccione la factura rectificada'; end if;
 if issued then
  if extract(year from saved_date)<>extract(year from previous.date) then raise exception 'La fecha debe conservar el año de la factura numerada'; end if;
  select coalesce(sum(amount),0) into paid from rl_payments where invoice_id=rid;
  if paid>0 and b+v-w<paid then raise exception 'El total no puede ser inferior a los cobros registrados'; end if;
  if trim(c.tax_id)='' then raise exception 'Falta el NIF del cliente'; end if;
  if exists(select 1 from jsonb_array_elements(ls) l where (l->>'vat_rate')::numeric=0)
     and trim(coalesce(p->>'exemption',''))='' then raise exception 'Indique el motivo de exención para las líneas sin IVA'; end if;
 end if;
 insert into rl_invoices(id,client_id,client_snapshot,issuer_snapshot,date,due_date,project_date,location,lines,subtotal,vat,withholding_rate,withholding,total,status,invoice_type,rectifies,notes,exemption,payment_terms,environment)
 values(rid,c.id,to_jsonb(c),settings.company,saved_date,nullif(p->>'due_date','')::date,nullif(p->>'project_date','')::date,coalesce(p->>'location',''),ls,b,v,wr,w,b+v-w,'draft',coalesce(p->>'invoice_type','F1'),nullif(p->>'rectifies','')::uuid,coalesce(p->>'notes',''),coalesce(p->>'exemption',''),coalesce(p->>'payment_terms',''),coalesce(p->>'environment','production'))
 on conflict(id) do update set
 client_id=excluded.client_id,
 client_snapshot=case when issued and previous.client_id=excluded.client_id then previous.client_snapshot else excluded.client_snapshot end,
 issuer_snapshot=case when issued then previous.issuer_snapshot else excluded.issuer_snapshot end,
 date=excluded.date,due_date=excluded.due_date,project_date=excluded.project_date,location=excluded.location,
 lines=excluded.lines,subtotal=excluded.subtotal,vat=excluded.vat,withholding_rate=excluded.withholding_rate,
 withholding=excluded.withholding,total=excluded.total,invoice_type=excluded.invoice_type,rectifies=excluded.rectifies,
 notes=excluded.notes,exemption=excluded.exemption,payment_terms=excluded.payment_terms,environment=excluded.environment;
 return rid;
end $$;
revoke all on function public.rl_save_invoice(jsonb) from public,anon;
grant execute on function public.rl_save_invoice(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
