create or replace function public.list_church_square_reconciliation(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_count_organization(p_location_id);
begin
  if not private.user_has_capability(auth.uid(), organization, p_location_id, 'reports.financial.view',
    (statement_timestamp() at time zone 'America/New_York')::date) or organization is null then
    raise exception 'Church Street financial reports access is required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'orderCoverageThrough', (select backfill.covered_through from private.church_square_order_backfill backfill
      where backfill.organization_id = organization and backfill.location_id = p_location_id),
    'pending', (select count(*) from private.church_square_webhook_receipts receipt
      where receipt.organization_id = organization and receipt.location_id = p_location_id and receipt.processed_at is null
        and receipt.event_type <> 'inventory.count.updated'
        and (receipt.processing_failure is null or receipt.processing_failure = 'square_unavailable')),
    'needsReview', (select count(*) from private.church_square_webhook_receipts receipt
      where receipt.organization_id = organization and receipt.location_id = p_location_id and receipt.processed_at is null
        and receipt.processing_failure in ('invalid_resource', 'scope_mismatch')),
    'resources', (select coalesce(jsonb_agg(jsonb_build_object(
      'kind', resource.resource_kind, 'reference', right(resource.resource_id, 10),
      'orderReference', right(resource.facts->>'orderId', 10), 'status', resource.facts->>'status',
      'amountCents', coalesce(nullif(resource.facts->'totalCents', 'null'::jsonb), resource.facts->'amountCents'),
      'depositState', resource.facts #>> '{deposit,state}', 'depositDueCents', resource.facts #> '{deposit,dueCents}',
      'depositCompletedCents', resource.facts #> '{deposit,completedCents}', 'serviceDate', resource.facts->>'serviceDate',
      'updatedAt', resource.source_updated_at, 'recoveredAt', recovery.recovered_at
    ) order by resource.source_updated_at desc, resource.resource_kind, resource.resource_id), '[]'::jsonb)
    from (select state.* from private.church_square_resource_state state
      where state.organization_id = organization and state.location_id = p_location_id
        and state.source_updated_at >= statement_timestamp() - interval '7 days'
      order by state.source_updated_at desc, state.resource_kind, state.resource_id limit 30) resource
    left join private.church_square_order_recoveries recovery on resource.resource_kind = 'order'
      and recovery.organization_id = resource.organization_id and recovery.location_id = resource.location_id
      and recovery.merchant_id = resource.merchant_id and recovery.square_location_id = resource.square_location_id
      and recovery.order_id = resource.resource_id and recovery.source_updated_at = resource.source_updated_at
      and recovery.source_version is not distinct from resource.source_version)
  );
end
$$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114162804', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
