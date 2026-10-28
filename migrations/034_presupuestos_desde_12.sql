-- Ejecutar después de 032_presupuestos.sql.
-- Reserva los números 1 a 11 de 2026 sin renumerar presupuestos existentes.
begin;
insert into public.rl_sequences(year,series,environment,next_value)
values(2026,'P','production',12)
on conflict(year,series,environment) do update
set next_value=greatest(rl_sequences.next_value,excluded.next_value);
commit;
