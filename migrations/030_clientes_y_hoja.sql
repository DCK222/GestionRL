-- Ejecutar una vez después de completar la importación original (001 a 029).
-- Puede repetirse. No modifica facturas emitidas ni los documentos originales.
begin;
create or replace function public.rl_sync_invoice_clients() returns integer
language plpgsql security definer set search_path=public as $$
declare i record; c rl_clients; target_id uuid; nif text; changed integer:=0; affected integer;
begin
 if not rl_write() then raise exception 'Acceso denegado'; end if;
 perform pg_advisory_xact_lock(44195);
 for i in select client_id,client_snapshot from rl_invoices order by date desc,id loop
  if nullif(trim(i.client_snapshot->>'name'),'') is null then continue; end if;
  nif:=regexp_replace(upper(coalesce(i.client_snapshot->>'tax_id','')),'[^A-Z0-9]','','g');
  select * into c from rl_clients x where x.id=i.client_id
   or (nif<>'' and regexp_replace(upper(x.tax_id),'[^A-Z0-9]','','g')=nif)
   or (i.client_id is null and nif='' and trim(lower(x.name))=trim(lower(i.client_snapshot->>'name'))
       and trim(lower(x.address))=trim(lower(coalesce(i.client_snapshot->>'address',''))))
   order by (x.id=i.client_id) desc nulls last,x.id limit 1;
  if not found then
   target_id:=coalesce(i.client_id,gen_random_uuid());
   insert into rl_clients(id,name,tax_id,address,email,phone,notes) values
    (target_id,trim(i.client_snapshot->>'name'),coalesce(i.client_snapshot->>'tax_id',''),
     coalesce(i.client_snapshot->>'address',''),coalesce(i.client_snapshot->>'email',''),
     coalesce(i.client_snapshot->>'phone',''),'Recuperado de las facturas');
   changed:=changed+1;
  else
   update rl_clients set
    tax_id=case when trim(tax_id)='' then coalesce(i.client_snapshot->>'tax_id','') else tax_id end,
    address=case when trim(address)='' then coalesce(i.client_snapshot->>'address','') else address end,
    email=case when trim(email)='' then coalesce(i.client_snapshot->>'email','') else email end,
    phone=case when trim(phone)='' then coalesce(i.client_snapshot->>'phone','') else phone end
   where id=c.id and (
    (trim(tax_id)='' and nullif(trim(i.client_snapshot->>'tax_id'),'') is not null) or
    (trim(address)='' and nullif(trim(i.client_snapshot->>'address'),'') is not null) or
    (trim(email)='' and nullif(trim(i.client_snapshot->>'email'),'') is not null) or
    (trim(phone)='' and nullif(trim(i.client_snapshot->>'phone'),'') is not null));
   get diagnostics affected=row_count;
   changed:=changed+affected;
  end if;
 end loop;
 return changed;
end $$;

create or replace function public.rl_save_enrollments(rows_data jsonb) returns integer
language plpgsql security definer set search_path=public as $$
declare p jsonb; amount integer;
begin
 if not rl_write() then raise exception 'Acceso denegado'; end if;
 if jsonb_typeof(rows_data) is distinct from 'array' then raise exception 'Se esperaba una lista de filas'; end if;
 amount:=jsonb_array_length(rows_data);
 if amount<1 or amount>500 then raise exception 'Guarda entre 1 y 500 filas cada vez'; end if;
 if exists(select 1 from jsonb_array_elements(rows_data) r where
    nullif(r->>'id','') is null or nullif(r->>'version','') is null or nullif(trim(r->>'category'),'') is null)
 then raise exception 'Cada fila necesita identificador, versión y actividad'; end if;
 if (select count(distinct r->>'id') from jsonb_array_elements(rows_data) r)<>amount
 then raise exception 'Hay filas duplicadas en la solicitud'; end if;
 -- El orden de bloqueo es estable; cualquier conflicto revierte el lote completo.
 for p in select value from jsonb_array_elements(rows_data) order by value->>'id' loop
  perform rl_save_enrollment(p);
 end loop;
 return amount;
end $$;
revoke all on function public.rl_sync_invoice_clients(),public.rl_save_enrollments(jsonb) from public,anon;
grant execute on function public.rl_sync_invoice_clients(),public.rl_save_enrollments(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
select 'Actualización lista. Abre Clientes y alumnos para recuperar los clientes de las facturas.' as resultado;
