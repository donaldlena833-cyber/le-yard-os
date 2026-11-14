-- Record the first writer for each current order revision as part of its atomic upsert.
-- Existing revisions have no attributable first writer and retain a null source.
alter table private.church_square_resource_state
  add column observation_source text check (
    observation_source is null or (resource_kind = 'order' and observation_source in ('webhook','scheduled','manual'))
  );

create index church_square_order_receipt_evidence
  on private.church_square_webhook_receipts (organization_id,location_id,merchant_id,square_location_id,resource_id,received_at,event_id)
  where event_type in ('order.created','order.updated','order.fulfillment.updated');

create index church_square_payment_receipt_order_evidence
  on private.church_square_webhook_receipts (organization_id,location_id,merchant_id,square_location_id,related_order_id,received_at,event_id)
  where event_type in ('payment.created','payment.updated') and related_order_id is not null;

create index church_square_payment_receipt_resource_evidence
  on private.church_square_webhook_receipts (organization_id,location_id,merchant_id,square_location_id,resource_id,received_at,event_id)
  where event_type in ('payment.created','payment.updated') and related_order_id is null;

create index church_square_payment_state_order_evidence
  on private.church_square_resource_state (organization_id,location_id,merchant_id,square_location_id, (facts->>'orderId'),resource_id)
  where resource_kind = 'payment' and (facts->>'orderId') is not null;


create or replace function public.service_complete_church_square_receipt(
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
    merchant_id, square_location_id, organization_id, location_id, resource_kind, resource_id, source_updated_at, source_version, facts, observation_source
  ) values (
    p_merchant_id, p_square_location_id, claimed.organization_id, claimed.location_id, claimed_kind, claimed.resource_id,
    (p_facts->>'updatedAt')::timestamptz, (p_facts->>'version')::bigint, p_facts,
    case when claimed_kind = 'order' then 'webhook' end
  )
  on conflict (merchant_id, square_location_id, resource_kind, resource_id) do update
  set source_updated_at = excluded.source_updated_at, source_version = excluded.source_version,
      facts = excluded.facts, saved_at = clock_timestamp(), observation_source = excluded.observation_source
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

create or replace function public.service_commit_church_square_order_backfill(
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
    resource_id, source_updated_at, source_version, facts, observation_source
  )
  select checkpoint.merchant_id, checkpoint.square_location_id, checkpoint.organization_id, checkpoint.location_id,
    'order', entry.facts->>'id', (entry.facts->>'updatedAt')::timestamptz, (entry.facts->>'version')::bigint, entry.facts, 'scheduled'
  from jsonb_array_elements(p_orders) entry(facts)
  order by entry.facts->>'id'
  on conflict (merchant_id, square_location_id, resource_kind, resource_id) do update
  set source_updated_at = excluded.source_updated_at, source_version = excluded.source_version,
      facts = excluded.facts, saved_at = clock_timestamp(), observation_source = excluded.observation_source
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

create or replace function public.service_recover_church_square_order(
  p_actor_id uuid,p_location_id uuid,p_merchant_id text,p_square_location_id text,p_order_id text,p_facts jsonb
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid;
  updated_at timestamptz;
  created_at timestamptz;
  provider_version bigint;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Square recovery service access is required' using errcode = '42501';
  end if;

  -- Use the location lock shared by Square onboarding and backfill.
  perform 1 from public.locations where id = p_location_id for update;
  organization := private.church_square_count_organization(p_location_id);
  if organization is null or p_actor_id is null or not exists (
    select 1 from public.organization_memberships membership where membership.user_id = p_actor_id
      and membership.organization_id = organization and membership.status = 'active'
      and membership.role in ('owner','admin','manager')
  ) or not private.user_has_capability(p_actor_id,organization,p_location_id,'reports.financial.view',
    (statement_timestamp() at time zone 'America/New_York')::date)
    or not private.user_has_capability(p_actor_id,organization,p_location_id,'manager_log.manage',
      (statement_timestamp() at time zone 'America/New_York')::date) then
    raise exception 'Church Street financial reports and Manager Log access are required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from private.church_square_order_backfill backfill
    where backfill.organization_id = organization and backfill.location_id = p_location_id
      and backfill.merchant_id = p_merchant_id and backfill.square_location_id = p_square_location_id
  ) then
    raise exception 'The Square merchant and location do not match the Church Street connection' using errcode = '42501';
  end if;

  updated_at := private.church_square_watch_instant(p_facts->>'updatedAt');
  created_at := private.church_square_watch_instant(p_facts->>'createdAt');
  if coalesce(p_order_id,'') !~ '^[A-Za-z0-9_:-]{1,192}$'
    or jsonb_typeof(p_facts) is distinct from 'object'
    or p_facts->>'kind' is distinct from 'order'
    or p_facts->>'id' is distinct from p_order_id
    or p_facts->>'locationId' is distinct from p_square_location_id
    or p_facts->>'currency' is distinct from 'USD'
    or coalesce(p_facts->>'status','') not in ('OPEN','COMPLETED','CANCELED','DRAFT','UNKNOWN')
    or updated_at is null or created_at is null or created_at > updated_at
    or updated_at > statement_timestamp() + interval '5 minutes'
    or pg_column_size(p_facts) > 512000
    or not (p_facts ? 'version')
    or (p_facts->'version' <> 'null'::jsonb and (
      jsonb_typeof(p_facts->'version') <> 'number' or p_facts->>'version' !~ '^[0-9]{1,16}$'
    )) then
    raise exception 'The verified order is invalid for Church Street recovery' using errcode = '22023';
  end if;
  provider_version := (p_facts->>'version')::bigint;

  -- Compare revisions exactly as the webhook and scheduled backfill do.
  insert into private.church_square_resource_state as current_state (
    merchant_id,square_location_id,organization_id,location_id,resource_kind,resource_id,source_updated_at,source_version,facts,observation_source
  ) values (p_merchant_id,p_square_location_id,organization,p_location_id,'order',p_order_id,updated_at,provider_version,p_facts,'manual')
  on conflict (merchant_id,square_location_id,resource_kind,resource_id) do update
  set source_updated_at = excluded.source_updated_at, source_version = excluded.source_version,
    facts = excluded.facts, saved_at = clock_timestamp(), observation_source = excluded.observation_source
  where current_state.organization_id = excluded.organization_id and current_state.location_id = excluded.location_id
    and case when excluded.source_version is not null and current_state.source_version is not null
      then excluded.source_version > current_state.source_version
        or (excluded.source_version = current_state.source_version and excluded.source_updated_at > current_state.source_updated_at)
      else excluded.source_updated_at > current_state.source_updated_at end;
  if not found then return false; end if;

  insert into private.church_square_order_recoveries (
    organization_id,location_id,merchant_id,square_location_id,order_id,source_updated_at,source_version,recovered_by
  ) values (organization,p_location_id,p_merchant_id,p_square_location_id,p_order_id,updated_at,provider_version,p_actor_id)
  on conflict (merchant_id,square_location_id,order_id,source_updated_at,source_version) do nothing;
  return true;
end
$$;

create or replace function public.get_church_square_order_evidence(
  p_location_id uuid,p_merchant_id text,p_square_location_id text,p_order_id text,
  p_square_updated_at timestamptz,p_square_version bigint
)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_count_organization(p_location_id);
begin
  if auth.uid() is null or organization is null
    or not public.has_org_role(organization,array['owner','admin','manager']::public.app_role[])
    or not private.user_has_capability(auth.uid(),organization,p_location_id,'reports.financial.view',
      (statement_timestamp() at time zone 'America/New_York')::date) then
    raise exception 'Church Street financial reports access is required' using errcode = '42501';
  end if;
  if coalesce(p_merchant_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_square_location_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_order_id,'') !~ '^[A-Za-z0-9_:-]{1,192}$'
    or p_square_updated_at is null or not isfinite(p_square_updated_at) or p_square_version < 0 then
    raise exception 'An exact scoped Square order and update are required' using errcode = '22023';
  end if;

  return (
    select jsonb_build_object(
      'updatedAt',state.source_updated_at,
      'matches',state.source_updated_at = p_square_updated_at
        and state.source_version is not distinct from p_square_version,
      'recoveredAt',recovery.recovered_at,
      'source',state.observation_source,
      'savedAt',case when state.observation_source is not null then state.saved_at end
    )
    from private.church_square_resource_state state
    left join private.church_square_order_recoveries recovery
      on recovery.organization_id = state.organization_id and recovery.location_id = state.location_id
      and recovery.merchant_id = state.merchant_id and recovery.square_location_id = state.square_location_id
      and recovery.order_id = state.resource_id and recovery.source_updated_at = state.source_updated_at
      and recovery.source_version is not distinct from state.source_version
    where state.organization_id = organization and state.location_id = p_location_id
      and state.merchant_id = p_merchant_id and state.square_location_id = p_square_location_id
      and state.resource_kind = 'order' and state.resource_id = p_order_id
  );
end
$$;

create function public.get_church_square_order_receipt_evidence(
  p_location_id uuid,p_merchant_id text,p_square_location_id text,p_order_id text
)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_count_organization(p_location_id);
begin
  if auth.uid() is null or organization is null
    or not public.has_org_role(organization,array['owner','admin','manager']::public.app_role[])
    or not private.user_has_capability(auth.uid(),organization,p_location_id,'reports.financial.view',
      (statement_timestamp() at time zone 'America/New_York')::date) then
    raise exception 'Church Street financial reports access is required' using errcode = '42501';
  end if;

  if coalesce(p_merchant_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_square_location_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_order_id,'') !~ '^[A-Za-z0-9_:-]{1,192}$' then
    raise exception 'An exact scoped Square order is required' using errcode = '22023';
  end if;

  -- This is an order-level delivery trace. The worker re-fetches live Square facts
  -- and can finish an older event after a scheduled scan already saved the same revision.
  -- A payment with conflicting event and confirmed links belongs to neither order trace.
  return (
    with candidates as (
      select 'order' as evidence_kind,receipt.event_id,receipt.event_type,receipt.created_at,
        receipt.received_at,receipt.processed_at,receipt.processing_failure
      from private.church_square_webhook_receipts receipt
      where receipt.organization_id = organization and receipt.location_id = p_location_id
        and receipt.merchant_id = p_merchant_id and receipt.square_location_id = p_square_location_id
        and receipt.resource_id = p_order_id
        and receipt.event_type in ('order.created','order.updated','order.fulfillment.updated')
      union all
      select 'payment',receipt.event_id,receipt.event_type,receipt.created_at,
        receipt.received_at,receipt.processed_at,receipt.processing_failure
      from private.church_square_webhook_receipts receipt
      left join private.church_square_resource_state payment
        on payment.organization_id = receipt.organization_id and payment.location_id = receipt.location_id
        and payment.merchant_id = receipt.merchant_id and payment.square_location_id = receipt.square_location_id
        and payment.resource_kind = 'payment' and payment.resource_id = receipt.resource_id
      where receipt.organization_id = organization and receipt.location_id = p_location_id
        and receipt.merchant_id = p_merchant_id and receipt.square_location_id = p_square_location_id
        and receipt.event_type in ('payment.created','payment.updated') and receipt.related_order_id = p_order_id
        and (payment.facts->>'orderId' is null or payment.facts->>'orderId' = p_order_id)
      union all
      select 'payment',receipt.event_id,receipt.event_type,receipt.created_at,
        receipt.received_at,receipt.processed_at,receipt.processing_failure
      from private.church_square_resource_state payment
      join private.church_square_webhook_receipts receipt
        on receipt.organization_id = payment.organization_id and receipt.location_id = payment.location_id
        and receipt.merchant_id = payment.merchant_id and receipt.square_location_id = payment.square_location_id
        and receipt.resource_id = payment.resource_id and receipt.related_order_id is null
      where payment.organization_id = organization and payment.location_id = p_location_id
        and payment.merchant_id = p_merchant_id and payment.square_location_id = p_square_location_id
        and payment.resource_kind = 'payment' and payment.facts->>'orderId' = p_order_id
        and receipt.event_type in ('payment.created','payment.updated')
    ), first_receipts as (
      select distinct on (candidate.evidence_kind) candidate.*
      from candidates candidate
      order by candidate.evidence_kind,candidate.received_at,candidate.event_id
    ), evidence as (
      select first_receipt.evidence_kind,jsonb_build_object(
        'eventType',first_receipt.event_type,'squareCreatedAt',first_receipt.created_at,
        'receivedAt',first_receipt.received_at,'processedAt',first_receipt.processed_at,
        'state',case
          when first_receipt.processed_at is not null then 'verified'
          when first_receipt.processing_failure in ('invalid_resource','scope_mismatch') then 'needs_review'
          else 'pending'
        end
      ) as facts
      from first_receipts first_receipt
    )
    select jsonb_build_object(
      'order',(select evidence.facts from evidence where evidence.evidence_kind = 'order'),
      'payment',(select evidence.facts from evidence where evidence.evidence_kind = 'payment')
    )
  );
end
$$;

revoke all on function public.get_church_square_order_receipt_evidence(uuid,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_church_square_order_receipt_evidence(uuid,text,text,text)
  to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114170105', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
