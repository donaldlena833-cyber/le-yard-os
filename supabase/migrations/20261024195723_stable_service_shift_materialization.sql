-- A service-day read materializes service shifts. Do not publish an UPDATE
-- when the backing service policy and effective values have not changed:
-- that update invalidates Today and makes its next read invalidate itself.
do $stable_materialization$
declare original text; rewritten text;
begin
  if (select md5(prosrc) from pg_proc where oid='private.ensure_service_shifts(uuid,uuid,date[])'::regprocedure)
      is distinct from 'c883cce3240562247c3c2b370c19de14' then
    raise exception 'Reviewed service-shift materialization body drifted';
  end if;
  select pg_get_functiondef('private.ensure_service_shifts(uuid,uuid,date[])'::regprocedure) into original;
  rewritten := replace(original, $old$materialized_at = excluded.materialized_at, updated_at = excluded.updated_at;$old$, $new$materialized_at = excluded.materialized_at, updated_at = excluded.updated_at
    where (service_shifts.name, service_shifts.starts_at, service_shifts.ends_at, service_shifts.default_duration_minutes, service_shifts.pacing_interval_minutes, service_shifts.pacing_cover_limit, service_shifts.min_party_size, service_shifts.max_party_size, service_shifts.online_enabled, service_shifts.status, service_shifts.configuration_state, service_shifts.source_updated_at)
      is distinct from (excluded.name, excluded.starts_at, excluded.ends_at, excluded.default_duration_minutes, excluded.pacing_interval_minutes, excluded.pacing_cover_limit, excluded.min_party_size, excluded.max_party_size, excluded.online_enabled, excluded.status, excluded.configuration_state, excluded.source_updated_at);$new$);
  if rewritten=original then raise exception 'Materialization update clause was not found'; end if;
  execute rewritten;
end
$stable_materialization$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261024195723',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
