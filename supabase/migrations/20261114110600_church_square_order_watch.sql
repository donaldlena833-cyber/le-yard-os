create index church_square_order_watch_recent_idx
  on private.church_square_resource_state(organization_id,location_id,source_updated_at desc,resource_id)
  where resource_kind = 'order' and facts->>'status' = 'OPEN';

create function private.church_square_watch_instant(p_value text)
returns timestamptz language sql stable set search_path = ''
as $$
  select case when p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and pg_input_is_valid(p_value,'timestamptz') then p_value::timestamptz end
$$;

create function public.list_church_square_order_watch(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_count_organization(p_location_id);
  checked_at timestamptz := statement_timestamp();
begin
  if organization is null or not public.has_org_role(organization,array['owner','admin','manager']::public.app_role[])
    or not private.user_has_capability(auth.uid(),organization,p_location_id,'reports.financial.view',
    (checked_at at time zone 'America/New_York')::date) then
    raise exception 'Church Street financial reports access is required' using errcode = '42501';
  end if;
  return (
    with ranked as (
      select state.resource_id,state.source_updated_at,
        case when state.facts->>'sourceHint' in ('DOORDASH','UBER_EATS','GRUBHUB','SQUARE_ONLINE','SQUARE_POS','SQUARE_INVOICES')
          then state.facts->>'sourceHint' else 'UNKNOWN' end as source_hint,
        active.fulfillments,active.first_promised_at
      from private.church_square_resource_state state
      cross join lateral (
        select min(instant.promised_at) as first_promised_at,jsonb_agg(jsonb_build_object(
          'type',entry.value->>'type','status',entry.value->>'status',
          'promisedAt',instant.promised_at,'readyAt',private.church_square_watch_instant(entry.value->>'readyAt'),
          'handoffAt',null,'completedAt',null,'canceledAt',null,'rejectedAt',null
        ) order by entry.position) as fulfillments
        from jsonb_array_elements(case when jsonb_typeof(state.facts->'fulfillments') = 'array'
          then state.facts->'fulfillments' else '[]'::jsonb end) with ordinality entry(value,position)
        cross join lateral (select private.church_square_watch_instant(entry.value->>'promisedAt') as promised_at) instant
        where entry.position <= 100 and entry.value->>'type' in ('PICKUP','DELIVERY')
          and entry.value->>'status' in ('PROPOSED','RESERVED','PREPARED')
          and entry.value->>'handoffAt' is null and entry.value->>'completedAt' is null
          and entry.value->>'canceledAt' is null and entry.value->>'rejectedAt' is null
      ) active
      where state.organization_id = organization and state.location_id = p_location_id
        and state.resource_kind = 'order' and state.facts->>'status' = 'OPEN'
        and state.source_updated_at between checked_at - interval '24 hours' and checked_at
        and active.fulfillments is not null
      order by active.first_promised_at nulls last,state.source_updated_at desc,state.resource_id
      limit 51
    ), visible as (
      select * from ranked order by first_promised_at nulls last,source_updated_at desc,resource_id limit 50
    )
    select jsonb_build_object(
      'checkedAt',checked_at,
      'orderCoverageThrough',(select backfill.covered_through from private.church_square_order_backfill backfill
        where backfill.organization_id = organization and backfill.location_id = p_location_id),
      'hasMore',(select count(*) > 50 from ranked),
      'orders',(select coalesce(jsonb_agg(jsonb_build_object(
          'reference',right(visible.resource_id,10),'source',visible.source_hint,'status','OPEN',
          'updatedAt',visible.source_updated_at,'fulfillments',visible.fulfillments
        ) order by visible.first_promised_at nulls last,visible.source_updated_at desc,visible.resource_id),'[]'::jsonb) from visible)
    )
  );
end
$$;

revoke all on function private.church_square_watch_instant(text),public.list_church_square_order_watch(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.list_church_square_order_watch(uuid) to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114110600', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
