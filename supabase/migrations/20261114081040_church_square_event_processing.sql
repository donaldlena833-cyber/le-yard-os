alter table private.church_square_webhook_receipts
  add column processing_attempts integer not null default 0 check (processing_attempts >= 0),
  add column processing_lease uuid,
  add column processing_after timestamptz not null default now(),
  add column processed_at timestamptz,
  add column processing_failure text check (processing_failure in ('square_unavailable', 'invalid_resource', 'scope_mismatch'));

create index church_square_receipts_ready
  on private.church_square_webhook_receipts(merchant_id, square_location_id, processing_after, received_at)
  where processed_at is null and event_type <> 'inventory.count.updated';

create table private.church_square_resource_state (
  merchant_id text not null,
  square_location_id text not null,
  organization_id uuid not null,
  location_id uuid not null,
  resource_kind text not null check (resource_kind in ('order', 'payment', 'refund', 'invoice')),
  resource_id text not null check (resource_id ~ '^[A-Za-z0-9_:-]{1,192}$'),
  source_updated_at timestamptz not null,
  source_version bigint,
  saved_at timestamptz not null default clock_timestamp(),
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  primary key (merchant_id, square_location_id, resource_kind, resource_id),
  foreign key (organization_id, location_id) references public.locations(organization_id, id)
);

alter table private.church_square_resource_state enable row level security;
alter table private.church_square_resource_state force row level security;
revoke all on private.church_square_resource_state from public, anon, authenticated, service_role;

create function public.service_claim_church_square_receipts(p_merchant_id text, p_square_location_id text)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  claimed jsonb;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Square worker service access is required' using errcode = '42501';
  end if;
  with ready as (
    select receipt.event_id
    from private.church_square_webhook_receipts receipt
    where receipt.merchant_id = p_merchant_id and receipt.square_location_id = p_square_location_id
      and receipt.organization_id = private.church_square_count_organization(receipt.location_id)
      and receipt.processed_at is null and receipt.event_type <> 'inventory.count.updated'
      and (receipt.processing_failure is null or receipt.processing_failure = 'square_unavailable')
      and receipt.processing_after <= statement_timestamp()
    order by receipt.processing_after, receipt.received_at, receipt.event_id
    limit 6
    for update skip locked
  ), leased as (
    update private.church_square_webhook_receipts receipt
    set processing_lease = gen_random_uuid(),
        processing_attempts = receipt.processing_attempts + 1,
        processing_after = clock_timestamp() + interval '90 seconds'
    from ready
    where receipt.merchant_id = p_merchant_id and receipt.event_id = ready.event_id
    returning receipt.event_id, receipt.event_type, receipt.resource_id, receipt.processing_lease
  )
  select coalesce(jsonb_agg(jsonb_build_object('eventId', event_id, 'eventType', event_type,
      'resourceId', resource_id, 'lease', processing_lease)), '[]'::jsonb) into claimed from leased;
  return claimed;
end
$$;

create function public.service_complete_church_square_receipt(
  p_merchant_id text, p_square_location_id text, p_event_id text, p_lease uuid,
  p_facts jsonb default null, p_failure text default null
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  claimed private.church_square_webhook_receipts%rowtype;
  claimed_kind text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Square worker service access is required' using errcode = '42501';
  end if;

  select * into claimed
  from private.church_square_webhook_receipts receipt
  where receipt.merchant_id = p_merchant_id and receipt.square_location_id = p_square_location_id
    and receipt.event_id = p_event_id and receipt.processing_lease = p_lease
    and receipt.processing_after > statement_timestamp() and receipt.processed_at is null
    and receipt.event_type <> 'inventory.count.updated'
    and receipt.organization_id = private.church_square_count_organization(receipt.location_id)
  for update;
  if not found then return false; end if;

  if p_failure is not null then
    if p_facts is not null or p_failure not in ('square_unavailable', 'invalid_resource', 'scope_mismatch') then
      raise exception 'Invalid Square worker failure' using errcode = '22023';
    end if;
    update private.church_square_webhook_receipts
    set processing_lease = null, processing_failure = p_failure,
        processing_after = clock_timestamp() + make_interval(secs => least(3600, 15 * (1 << least(claimed.processing_attempts, 8))))
    where merchant_id = p_merchant_id and event_id = p_event_id;
    return true;
  end if;

  claimed_kind := split_part(claimed.event_type, '.', 1);
  if jsonb_typeof(p_facts) is distinct from 'object'
    or p_facts->>'kind' is distinct from claimed_kind
    or p_facts->>'id' is distinct from claimed.resource_id
    or p_facts->>'locationId' is distinct from p_square_location_id
    or p_facts->>'currency' is distinct from 'USD'
    or (p_facts->>'updatedAt') is null
    or pg_column_size(p_facts) > 524288 then
    raise exception 'Square worker resource does not match its receipt' using errcode = '22023';
  end if;

  insert into private.church_square_resource_state as current_state (
    merchant_id, square_location_id, organization_id, location_id, resource_kind, resource_id, source_updated_at, source_version, facts
  ) values (
    p_merchant_id, p_square_location_id, claimed.organization_id, claimed.location_id, claimed_kind, claimed.resource_id,
    (p_facts->>'updatedAt')::timestamptz, (p_facts->>'version')::bigint, p_facts
  )
  on conflict (merchant_id, square_location_id, resource_kind, resource_id) do update
  set source_updated_at = excluded.source_updated_at, source_version = excluded.source_version,
      facts = excluded.facts, saved_at = clock_timestamp()
  where case when excluded.source_version is not null and current_state.source_version is not null
    then excluded.source_version > current_state.source_version
      or (excluded.source_version = current_state.source_version and excluded.source_updated_at > current_state.source_updated_at)
    else excluded.source_updated_at > current_state.source_updated_at end;

  update private.church_square_webhook_receipts
  set processed_at = clock_timestamp(), processing_lease = null, processing_failure = null
  where merchant_id = p_merchant_id and event_id = p_event_id;
  return true;
end
$$;

-- Only return fields needed for shift reconciliation. Raw webhook payloads
-- and the private canonical projection cannot be queried by a browser.
create function public.list_church_square_reconciliation(p_location_id uuid)
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
      'updatedAt', resource.source_updated_at
    ) order by resource.source_updated_at desc, resource.resource_kind, resource.resource_id), '[]'::jsonb)
    from (select state.* from private.church_square_resource_state state
      where state.organization_id = organization and state.location_id = p_location_id
        and state.source_updated_at >= statement_timestamp() - interval '7 days'
      order by state.source_updated_at desc, state.resource_kind, state.resource_id limit 30) resource)
  );
end
$$;

revoke all on function public.service_claim_church_square_receipts(text, text),
  public.service_complete_church_square_receipt(text, text, text, uuid, jsonb, text),
  public.list_church_square_reconciliation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_claim_church_square_receipts(text, text),
  public.service_complete_church_square_receipt(text, text, text, uuid, jsonb, text) to service_role;
grant execute on function public.list_church_square_reconciliation(uuid) to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114081040',
  table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint',
  access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
