create function public.get_church_square_order_evidence(
  p_location_id uuid, p_merchant_id text, p_square_location_id text, p_order_id text,
  p_square_updated_at timestamptz, p_square_version bigint
)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_count_organization(p_location_id);
begin
  if auth.uid() is null or organization is null
    or not public.has_org_role(organization, array['owner','admin','manager']::public.app_role[])
    or not private.user_has_capability(auth.uid(), organization, p_location_id, 'reports.financial.view',
      (statement_timestamp() at time zone 'America/New_York')::date) then
    raise exception 'Church Street financial reports access is required' using errcode = '42501';
  end if;
  if coalesce(p_merchant_id, '') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_square_location_id, '') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_order_id, '') !~ '^[A-Za-z0-9_:-]{1,192}$'
    or p_square_updated_at is null or not isfinite(p_square_updated_at)
    or p_square_version < 0 then
    raise exception 'An exact scoped Square order and update are required' using errcode = '22023';
  end if;

  return (
    select jsonb_build_object(
      'updatedAt', state.source_updated_at,
      'matches', state.source_updated_at = p_square_updated_at
        and state.source_version is not distinct from p_square_version
    )
    from private.church_square_resource_state state
    where state.organization_id = organization and state.location_id = p_location_id
      and state.merchant_id = p_merchant_id and state.square_location_id = p_square_location_id
      and state.resource_kind = 'order' and state.resource_id = p_order_id
  );
end
$$;

revoke all on function public.get_church_square_order_evidence(uuid,text,text,text,timestamptz,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.get_church_square_order_evidence(uuid,text,text,text,timestamptz,bigint)
  to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114154101', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
