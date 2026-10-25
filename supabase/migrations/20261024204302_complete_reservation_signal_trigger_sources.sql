-- The existing producer is bound to all four reservation-operating tables.
-- Keep that exact surface; accepting only reservations blocks normal allocations.
do $complete_sources$
declare original text; rewritten text;
begin
  if (select md5(prosrc) from pg_proc where oid='public.broadcast_reservation_change()'::regprocedure)
      is distinct from 'd24db1d920f017559f2da83a8d607f5c' then
    raise exception 'Reviewed reservation signal producer drifted';
  end if;
  select pg_get_functiondef('public.broadcast_reservation_change()'::regprocedure) into original;
  rewritten:=replace(original,
    $old$tg_table_name not in ('reservations')$old$,
    $new$tg_table_name not in ('reservations', 'reservation_table_allocations', 'waitlist_entries', 'table_status_events')$new$);
  if rewritten=original then raise exception 'Reviewed reservation source guard was not found'; end if;
  execute rewritten;
end
$complete_sources$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261024204302',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
