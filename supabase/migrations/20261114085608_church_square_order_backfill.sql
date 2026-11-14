create table private.church_square_order_backfill (
  location_id uuid primary key,
  organization_id uuid not null,
  merchant_id text not null check (merchant_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  square_location_id text not null check (square_location_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  scan_started_at timestamptz not null,
  covered_through timestamptz,
  window_seconds integer not null default 21600 check (window_seconds between 15 and 21600),
  lease uuid,
  lease_expires_at timestamptz,
  window_from timestamptz,
  window_to timestamptz,
  retry_after timestamptz not null default '-infinity',
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_failure text check (last_failure in ('window_too_large', 'provider_unavailable', 'invalid_source')),
  foreign key (organization_id, location_id) references public.locations(organization_id, id)
);

alter table private.church_square_order_backfill enable row level security;
alter table private.church_square_order_backfill force row level security;
revoke all on private.church_square_order_backfill from public, anon, authenticated, service_role;

create function public.service_claim_church_square_order_backfill(
  p_merchant_id text, p_square_location_id text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  target_organization uuid;
  target_location uuid;
  latest_ready timestamptz := date_trunc('milliseconds', statement_timestamp()) - interval '1 minute';
  checkpoint private.church_square_order_backfill%rowtype;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Square backfill service access is required' using errcode = '42501';
  end if;
  if coalesce(p_merchant_id, '') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_square_location_id, '') !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'Exact Square scope is required' using errcode = '22023';
  end if;
  select location.organization_id, location.id into strict target_organization, target_location
  from public.locations location
  where location.code = 'CHURCH'
    and private.church_square_count_organization(location.id) = location.organization_id
  for update of location;

  if exists (
    select 1 from private.church_square_count_items item
    where item.location_id = target_location
      and (item.merchant_id, item.square_location_id) is distinct from (p_merchant_id, p_square_location_id)
  ) or exists (
    select 1 from private.church_square_webhook_receipts receipt
    where receipt.location_id = target_location
      and (receipt.merchant_id, receipt.square_location_id) is distinct from (p_merchant_id, p_square_location_id)
  ) then
    raise exception 'Square backfill scope does not match Church Street' using errcode = '42501';
  end if;
  if not exists (
    select 1 from private.church_square_count_items item
    where item.location_id = target_location
      and item.merchant_id = p_merchant_id and item.square_location_id = p_square_location_id
  ) and not exists (
    select 1 from private.church_square_webhook_receipts receipt
    where receipt.location_id = target_location
      and receipt.merchant_id = p_merchant_id and receipt.square_location_id = p_square_location_id
  ) then
    raise exception 'Church Street Square scope must be established before backfill' using errcode = '42501';
  end if;

  insert into private.church_square_order_backfill (location_id, organization_id, merchant_id, square_location_id, scan_started_at)
  values (target_location, target_organization, p_merchant_id, p_square_location_id, latest_ready - interval '24 hours')
  on conflict (location_id) do nothing;

  select * into strict checkpoint from private.church_square_order_backfill backfill
  where backfill.location_id = target_location for update;
  if (checkpoint.merchant_id, checkpoint.square_location_id) is distinct from (p_merchant_id, p_square_location_id) then
    raise exception 'Square backfill is bound to another merchant or location' using errcode = '42501';
  end if;
  if checkpoint.lease_expires_at > statement_timestamp() or checkpoint.retry_after > statement_timestamp()
    or checkpoint.covered_through >= latest_ready then return null; end if;

  update private.church_square_order_backfill backfill
  set lease = gen_random_uuid(),
      lease_expires_at = clock_timestamp() + interval '90 seconds',
      window_from = greatest(checkpoint.scan_started_at,
        checkpoint.covered_through - make_interval(secs => least(300, checkpoint.window_seconds / 2))),
      window_to = least(latest_ready, coalesce(checkpoint.covered_through, checkpoint.scan_started_at) +
        make_interval(secs => checkpoint.window_seconds))
  where backfill.location_id = target_location returning * into checkpoint;

  return jsonb_build_object('lease', checkpoint.lease, 'from', checkpoint.window_from, 'to', checkpoint.window_to);
end
$$;

create function public.service_commit_church_square_order_backfill(
  p_merchant_id text, p_square_location_id text, p_lease uuid, p_orders jsonb
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  checkpoint private.church_square_order_backfill%rowtype;
  target_location uuid;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Square backfill service access is required' using errcode = '42501';
  end if;

  -- Count mapping and tenant lifecycle use the public location row as their
  -- serialization point. Acquire it before the backfill row to match claim.
  select location.id into target_location from public.locations location
  join private.church_square_order_backfill backfill on backfill.location_id = location.id
  where backfill.merchant_id = p_merchant_id and backfill.square_location_id = p_square_location_id
    and backfill.lease = p_lease;
  if not found then return false; end if;
  perform 1 from public.locations location where location.id = target_location for update;

  select * into checkpoint from private.church_square_order_backfill backfill
  where backfill.merchant_id = p_merchant_id and backfill.square_location_id = p_square_location_id
    and backfill.lease = p_lease and backfill.lease_expires_at > statement_timestamp()
    and backfill.organization_id = private.church_square_count_organization(backfill.location_id)
  for update;
  if not found then return false; end if;

  if exists (
    select 1 from private.church_square_count_items item
    where item.location_id = checkpoint.location_id
      and (item.merchant_id, item.square_location_id) is distinct from (p_merchant_id, p_square_location_id)
  ) or exists (
    select 1 from private.church_square_webhook_receipts receipt
    where receipt.location_id = checkpoint.location_id
      and (receipt.merchant_id, receipt.square_location_id) is distinct from (p_merchant_id, p_square_location_id)
  ) then
    raise exception 'Square backfill scope does not match Church Street' using errcode = '42501';
  end if;

  if jsonb_typeof(p_orders) is distinct from 'array' then
    raise exception 'Expected a Square order backfill array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_orders) > 150
    or pg_column_size(p_orders) > 2097152 then
    raise exception 'Square order backfill page bounds exceeded' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_orders) entry(facts)
    where jsonb_typeof(entry.facts) is distinct from 'object'
      or entry.facts->>'kind' is distinct from 'order'
      or entry.facts->>'locationId' is distinct from checkpoint.square_location_id
      or entry.facts->>'currency' is distinct from 'USD'
      or coalesce(entry.facts->>'id', '') !~ '^[A-Za-z0-9_:-]{1,192}$'
      or coalesce(entry.facts->>'updatedAt', '') = ''
      or (entry.facts->>'updatedAt')::timestamptz not between checkpoint.window_from and checkpoint.window_to
      or pg_column_size(entry.facts) > 524288
  ) then
    raise exception 'Square order is outside the claimed backfill scope' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_orders) entry(facts)
    group by entry.facts->>'id' having count(*) > 1
  ) then
    raise exception 'Square backfill requires distinct order IDs' using errcode = '22023';
  end if;

  -- The same head ordering used for webhook completion prevents an overlapping
  -- scan from replacing newer Square evidence.
  insert into private.church_square_resource_state as current_state (
    merchant_id, square_location_id, organization_id, location_id, resource_kind,
    resource_id, source_updated_at, source_version, facts
  )
  select checkpoint.merchant_id, checkpoint.square_location_id, checkpoint.organization_id, checkpoint.location_id,
    'order', entry.facts->>'id', (entry.facts->>'updatedAt')::timestamptz, (entry.facts->>'version')::bigint, entry.facts
  from jsonb_array_elements(p_orders) entry(facts)
  order by entry.facts->>'id'
  on conflict (merchant_id, square_location_id, resource_kind, resource_id) do update
  set source_updated_at = excluded.source_updated_at, source_version = excluded.source_version,
      facts = excluded.facts, saved_at = clock_timestamp()
  where case when excluded.source_version is not null and current_state.source_version is not null
    then excluded.source_version > current_state.source_version
      or (excluded.source_version = current_state.source_version and excluded.source_updated_at > current_state.source_updated_at)
    else excluded.source_updated_at > current_state.source_updated_at end;

  update private.church_square_order_backfill backfill
  set covered_through = checkpoint.window_to,
      lease = null, lease_expires_at = null, window_from = null, window_to = null,
      retry_after = '-infinity', consecutive_failures = 0, last_failure = null,
      window_seconds = least(21600, checkpoint.window_seconds * 2)
  where backfill.location_id = checkpoint.location_id;
  return true;
end
$$;

create function public.service_release_church_square_order_backfill(
  p_merchant_id text, p_square_location_id text, p_lease uuid, p_failure text
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off
as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Square backfill service access is required' using errcode = '42501';
  end if;
  if p_failure is null or p_failure not in ('window_too_large', 'provider_unavailable', 'invalid_source') then
    raise exception 'Unsupported backfill failure' using errcode = '22023';
  end if;
  update private.church_square_order_backfill backfill
  set lease = null, lease_expires_at = null, window_from = null, window_to = null,
      consecutive_failures = least(consecutive_failures + 1, 10),
      last_failure = p_failure,
      retry_after = clock_timestamp() + make_interval(secs => least(900, 15 * (1 << least(consecutive_failures, 6)))),
      window_seconds = case when p_failure = 'window_too_large' then greatest(15, window_seconds / 2) else window_seconds end
  where backfill.merchant_id = p_merchant_id and backfill.square_location_id = p_square_location_id
    and backfill.lease = p_lease and backfill.lease_expires_at > statement_timestamp()
    and backfill.organization_id = private.church_square_count_organization(backfill.location_id);
  return found;
end
$$;

revoke all on function public.service_claim_church_square_order_backfill(text,text),
  public.service_commit_church_square_order_backfill(text,text,uuid,jsonb),
  public.service_release_church_square_order_backfill(text,text,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_claim_church_square_order_backfill(text,text),
  public.service_commit_church_square_order_backfill(text,text,uuid,jsonb),
  public.service_release_church_square_order_backfill(text,text,uuid,text) to service_role;

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
      'updatedAt', resource.source_updated_at
    ) order by resource.source_updated_at desc, resource.resource_kind, resource.resource_id), '[]'::jsonb)
    from (select state.* from private.church_square_resource_state state
      where state.organization_id = organization and state.location_id = p_location_id
        and state.source_updated_at >= statement_timestamp() - interval '7 days'
      order by state.source_updated_at desc, state.resource_kind, state.resource_id limit 30) resource)
  );
end
$$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114085608',
  table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint',
  access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
