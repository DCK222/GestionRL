-- Solo recuperación técnica. Restaura las dos funciones anteriores, no facturas.
-- La aplicación anterior volverá a bloquear documentos emitidos.
begin;
do $$
declare f jsonb; count_functions integer;
begin
 select jsonb_array_length(payload->'functions') into count_functions
 from rl_maintenance.invoice_review_20261019 where id=1;
 if count_functions is distinct from 2 then raise exception 'Falta una copia válida de las funciones anteriores'; end if;
 for f in select value from rl_maintenance.invoice_review_20261019 s,
 jsonb_array_elements(s.payload->'functions') where s.id=1 loop
   if f->>'name' not in ('rl_save_invoice','rl_immutable_invoice') then raise exception 'Función inesperada en la copia'; end if;
   execute f->>'definition';
 end loop;
end $$;
notify pgrst, 'reload schema';
commit;
