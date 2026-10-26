-- Native warning triage reproduced a DateStyle-sensitive timestamp validator
-- and clock-dependent functions labeled STABLE. Change only the reviewed
-- timestamp wire predicate and volatility metadata; preserve ownership/ACLs.
DO $reviewed$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.reservation_lifecycle_head_authoritative_kernel(uuid,uuid)'::regprocedure) IS DISTINCT FROM '9ed4f83c3d0ae89af04eb9aca37b1886' THEN RAISE EXCEPTION 'Reviewed SQL warning function body drifted: private.reservation_lifecycle_head_authoritative_kernel'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.service_connected_acceptance_marker(uuid,text,uuid,text)'::regprocedure) IS DISTINCT FROM 'a4d790ee81b111cae8ffe623def828b2' THEN RAISE EXCEPTION 'Reviewed SQL warning function body drifted: public.service_connected_acceptance_marker'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.service_get_managed_reservation(uuid,uuid,text)'::regprocedure) IS DISTINCT FROM 'ef047c8e3f05fe2c418d9caccec7afbb' THEN RAISE EXCEPTION 'Reviewed SQL warning function body drifted: public.service_get_managed_reservation'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.service_reservation_lifecycle_head(uuid,uuid)'::regprocedure) IS DISTINCT FROM 'a45ff1711ea4c988638adcccd8f5e9ad' THEN RAISE EXCEPTION 'Reviewed SQL warning function body drifted: public.service_reservation_lifecycle_head'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.service_reservation_pacing_snapshot(uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure) IS DISTINCT FROM 'fa69e083f8aa65d9ad592dcd02d76018' THEN RAISE EXCEPTION 'Reviewed SQL warning function body drifted: public.service_reservation_pacing_snapshot'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='private.startup_timestamp_is_valid(text)'::regprocedure) IS DISTINCT FROM 'a171678b8843c269f40ace0763d4d027' THEN RAISE EXCEPTION 'Reviewed SQL warning function body drifted: private.startup_timestamp_is_valid'; END IF;
END
$reviewed$;

ALTER FUNCTION private.reservation_lifecycle_head_authoritative_kernel(uuid,uuid) VOLATILE;
ALTER FUNCTION public.service_connected_acceptance_marker(uuid,text,uuid,text) VOLATILE;
ALTER FUNCTION public.service_get_managed_reservation(uuid,uuid,text) VOLATILE;
ALTER FUNCTION public.service_reservation_lifecycle_head(uuid,uuid) VOLATILE;
ALTER FUNCTION public.service_reservation_pacing_snapshot(uuid,uuid,timestamp with time zone,timestamp with time zone) VOLATILE;

CREATE OR REPLACE FUNCTION private.startup_timestamp_is_valid(p_value text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = ''
AS $timestamp$
BEGIN
  IF p_value IS NULL OR p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-](0[0-9]|1[0-5]):[0-5][0-9])$' THEN
    RETURN false;
  END IF;
  -- Strict ISO date input removes DateStyle ambiguity. The helper rejects
  -- impossible calendar days, including non-leap February29 and year zero.
  RETURN private.startup_iso_date_is_valid(left(p_value,10));
END
$timestamp$;

UPDATE private.runtime_schema_contract_expected expected
SET migration_head='20261025052332',table_fingerprint=s.value->>'tableFingerprint',
 function_fingerprint=s.value->>'functionFingerprint',access_fingerprint=s.value->>'accessFingerprint',captured_at=clock_timestamp()
FROM (SELECT private.compute_runtime_schema_fingerprints() value) s
WHERE expected.contract_version='runtime-schema-v2';
