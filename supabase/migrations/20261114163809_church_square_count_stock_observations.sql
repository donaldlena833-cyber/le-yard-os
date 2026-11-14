create or replace function public.list_church_square_count_items(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off as $$
declare
  target_organization uuid := private.church_square_count_organization(p_location_id);
  items jsonb;
begin
  if not private.can_record_church_square_count(auth.uid(), target_organization, p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', item.id, 'label', item.label,
      'pendingRequestId', pending.id, 'pendingQuantity', pending.quantity,
      'pendingReason', pending.reason, 'pendingObservedAt', pending.observed_at,
      'lastConfirmedQuantity', confirmed.quantity, 'lastConfirmedObservedAt', confirmed.observed_at,
      'squareInStockQuantity', trim_scale(stock.quantity)::text,
      'squareInStockCalculatedAt', stock.calculated_at
    ) order by item.label, item.id
  ), '[]'::jsonb) into items
  from private.church_square_count_items item
  left join private.church_square_stock_state stock on stock.item_id = item.id
  left join private.church_square_count_requests pending
    on pending.item_id = item.id and pending.status = 'pending'
  left join lateral (
    select request.quantity, request.observed_at from private.church_square_count_requests request
    where request.item_id = item.id and request.status = 'confirmed'
    order by request.observed_at desc, request.id desc limit 1
  ) confirmed on true
  where item.organization_id = target_organization and item.location_id = p_location_id and item.is_enabled;

  return items;
end
$$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114163809', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
