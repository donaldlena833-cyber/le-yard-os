-- Refuse malformed checklist drafts before insert/normalization. Keep the
-- supported missing-field defaults, binary validation-size and total-wire
-- limits. STABLE conservatively matches pg_column_size's catalog contract.
DO $reviewed$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.checklist_authoring_items_are_valid(jsonb)'::regprocedure) IS DISTINCT FROM 'f1b75e34cef9051c1e773dda2c731dc5' THEN
    RAISE EXCEPTION 'Reviewed checklist authoring validator body drifted';
  END IF;
END
$reviewed$;

CREATE OR REPLACE FUNCTION private.checklist_authoring_items_are_valid(p_items jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
begin
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p_items) not between 1 and 100
    or octet_length(p_items::text) > 100000 then
    return false;
  end if;
  return not exists (
    select 1
    from jsonb_array_elements(p_items) item(value)
    where case when jsonb_typeof(item.value) is distinct from 'object' then true
    else jsonb_typeof(item.value -> 'label') is distinct from 'string'
      or length(btrim(item.value ->> 'label')) not between 1 and 500
      or (item.value ? 'instructions'
          and jsonb_typeof(item.value -> 'instructions') not in ('string', 'null'))
      or length(coalesce(nullif(btrim(item.value ->> 'instructions'), ''), '')) > 5000
      or coalesce(item.value ->> 'response_type', 'checkbox') not in (
        'checkbox', 'text', 'number', 'photo', 'temperature'
      )
      or (item.value ? 'required' and jsonb_typeof(item.value -> 'required') <> 'boolean')
      or (item.value ? 'validation' and jsonb_typeof(item.value -> 'validation') <> 'object')
      or pg_column_size(coalesce(item.value -> 'validation', '{}'::jsonb)) > 8192
      or exists (
        select 1
        from jsonb_object_keys(item.value) item_key(value)
        where item_key.value not in (
          'label', 'instructions', 'response_type', 'required', 'validation'
        )
      )
    end
  );
end
$function$
;

UPDATE private.runtime_schema_contract_expected expected
SET migration_head='20261025055258',table_fingerprint=s.value->>'tableFingerprint',
 function_fingerprint=s.value->>'functionFingerprint',access_fingerprint=s.value->>'accessFingerprint',captured_at=clock_timestamp()
FROM (SELECT private.compute_runtime_schema_fingerprints() value) s
WHERE expected.contract_version='runtime-schema-v2';
