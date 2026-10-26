-- A high revision number in one service must not hide another current brief.
-- Share the bounded result between each service and status before its history.
do $fair_briefs$
declare original text; rewritten text;
begin
  if (select md5(prosrc) from pg_proc where oid='public.read_preshifts_safe(uuid,uuid,date,integer)'::regprocedure)
      is distinct from '3f4209e5647578870a64f21767a104b1' then
    raise exception 'Reviewed safe pre-shift projection body drifted';
  end if;
  select pg_get_functiondef('public.read_preshifts_safe(uuid,uuid,date,integer)'::regprocedure) into original;
  rewritten := replace(original,
    $old$order by preshift.business_date, preshift.version_number desc$old$,
    $new$order by preshift.business_date,
    row_number() over (
      partition by preshift.business_date, preshift.service_period, preshift.status
      order by preshift.version_number desc, preshift.id
    ),
    case preshift.status when 'published' then 0 when 'draft' then 1 else 2 end,
    preshift.service_period, preshift.version_number desc, preshift.id$new$);
  if rewritten=original then raise exception 'Reviewed pre-shift ordering clause was not found'; end if;
  execute rewritten;
end
$fair_briefs$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261024203427',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
