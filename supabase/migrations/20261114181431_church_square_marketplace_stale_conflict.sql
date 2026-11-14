-- Reserve SQLSTATE 40001 for PostgreSQL's own serialization failures.
do $$
declare
  target_oid regprocedure := 'public.service_save_church_square_marketplace_link(uuid,text,text,text,uuid,timestamptz,bigint,text,text,text,text)'::regprocedure;
  original_source text;
  definition text;
  old_code constant text := 'errcode = ''40001''';
  new_code constant text := 'errcode = ''PT409''';
begin
  select procedure.prosrc,pg_get_functiondef(procedure.oid) into strict original_source,definition
  from pg_catalog.pg_proc procedure where procedure.oid = target_oid;
  if md5(original_source) <> '27753c2327294186e0f65112cc731b81' then
    raise exception 'Marketplace order link body differs from the reviewed migration';
  end if;
  execute replace(definition,old_code,new_code);
end
$$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114181431', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
