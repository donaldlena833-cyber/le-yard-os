-- Exact Church Street Square variations and physical count receipts are private.
create table private.church_square_count_items (
  id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  label text not null check (length(label) between 1 and 120),
  merchant_id text not null check (merchant_id ~ '^[A-Za-z0-9_-]{1,192}$'),
  square_location_id text not null check (square_location_id ~ '^[A-Za-z0-9_-]{1,192}$'),
  variation_id text not null check (variation_id ~ '^[A-Za-z0-9_-]{1,192}$'),
  is_enabled boolean not null,
  configured_by uuid not null,
  configured_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id),
  unique (merchant_id, square_location_id, variation_id)
);

create table private.church_square_count_requests (
  id uuid primary key,
  item_id uuid not null references private.church_square_count_items(id),
  requested_by uuid not null,
  quantity text not null check (quantity ~ '^(0|[1-9][0-9]{0,5})$'),
  reason text not null check (length(reason) between 1 and 160),
  observed_at timestamptz not null,
  status text not null check (status in ('pending', 'confirmed', 'rejected')),
  attempt_id uuid not null,
  attempt_actor_id uuid not null,
  attempt_expires_at timestamptz not null,
  dispatched_at timestamptz,
  provider_count_id text check (provider_count_id ~ '^[A-Za-z0-9_-]{1,192}$'),
  completed_at timestamptz
);

create unique index church_square_one_pending_count
  on private.church_square_count_requests(item_id) where status = 'pending';
create index church_square_count_request_history
  on private.church_square_count_requests(item_id, observed_at desc);

alter table private.church_square_count_items enable row level security;
alter table private.church_square_count_requests enable row level security;
revoke all on private.church_square_count_items, private.church_square_count_requests
  from public, anon, authenticated, service_role;

create function private.church_square_count_organization(p_location_id uuid)
returns uuid language sql stable set search_path = '' as $$
  select organization.id
  from public.organizations organization
  join public.locations location on location.organization_id = organization.id
  where organization.slug = 'le-yard-church-street' and organization.status = 'active'
    and location.id = p_location_id and location.is_active and location.code = 'CHURCH'
    and private.is_counter_service_org(organization.id)
$$;

create function private.can_record_church_square_count(
  p_actor_id uuid, p_organization_id uuid, p_location_id uuid
)
returns boolean language sql stable set search_path = '' as $$
  select p_actor_id is not null and p_organization_id is not null and (
    private.user_has_capability(
      p_actor_id, p_organization_id, p_location_id, 'inventory.count.create',
      (statement_timestamp() at time zone 'America/New_York')::date
    ) or exists (
      select 1 from public.organization_memberships membership
      join public.location_memberships assignment
        on assignment.organization_id = membership.organization_id and assignment.user_id = membership.user_id
      where membership.organization_id = p_organization_id and membership.user_id = p_actor_id
        and membership.role = 'manager' and membership.status = 'active'
        and assignment.location_id = p_location_id
        and not exists (
          select 1 from public.user_capability_overrides override
          where override.organization_id = p_organization_id and override.user_id = p_actor_id
            and override.capability_key = 'inventory.count.create'
            and override.effect = 'deny' and override.is_active
            and (override.location_id is null or override.location_id = p_location_id)
            and override.effective_from <= (statement_timestamp() at time zone 'America/New_York')::date
            and (override.effective_to is null
              or override.effective_to >= (statement_timestamp() at time zone 'America/New_York')::date)
        )
    )
  )
$$;

revoke all on function private.church_square_count_organization(uuid),
  private.can_record_church_square_count(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.service_configure_church_square_count_item(
  p_actor_id uuid,
  p_location_id uuid,
  p_item_id uuid,
  p_label text,
  p_merchant_id text,
  p_square_location_id text,
  p_variation_id text,
  p_enabled boolean
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  target_organization uuid := private.church_square_count_organization(p_location_id);
  item private.church_square_count_items%rowtype;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role'
    or not exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = target_organization and membership.user_id = p_actor_id
        and membership.status = 'active' and membership.role in ('owner', 'admin')
    ) then
    raise exception 'Church Street owner or admin access is required' using errcode = '42501';
  end if;

  if p_item_id is null or p_enabled is null or coalesce(length(btrim(p_label)), 0) not between 1 and 120
    or coalesce(p_merchant_id, '') !~ '^[A-Za-z0-9_-]{1,192}$'
    or coalesce(p_square_location_id, '') !~ '^[A-Za-z0-9_-]{1,192}$'
    or coalesce(p_variation_id, '') !~ '^[A-Za-z0-9_-]{1,192}$' then
    raise exception 'An exact Square variation and item label are required' using errcode = '22023';
  end if;

  -- Serialize configuration for this location and lock any existing item
  -- before inspecting its requests or changing its status.
  perform 1 from public.locations location where location.id = p_location_id for update;
  select * into item from private.church_square_count_items mapping
  where mapping.id = p_item_id for update;

  if item.id is not null and (
    item.organization_id <> target_organization or item.location_id <> p_location_id
    or item.merchant_id <> p_merchant_id or item.square_location_id <> p_square_location_id
    or item.variation_id <> p_variation_id
  ) then
    raise exception 'This count item already has a different identity' using errcode = 'PT409';
  end if;

  if exists (
    select 1 from private.church_square_count_items mapping
    where mapping.location_id = p_location_id
      and (mapping.merchant_id <> p_merchant_id or mapping.square_location_id <> p_square_location_id)
  ) then
    raise exception 'Church Street already has a different Square merchant or location' using errcode = 'PT409';
  end if;

  if not p_enabled and exists (
    select 1 from private.church_square_count_requests request
    where request.item_id = p_item_id and request.status = 'pending'
  ) then
    raise exception 'Resolve the pending count before disabling this item' using errcode = 'PT409';
  end if;

  insert into private.church_square_count_items (
    id, organization_id, location_id, label, merchant_id, square_location_id, variation_id,
    is_enabled, configured_by
  ) values (
    p_item_id, target_organization, p_location_id, btrim(p_label), p_merchant_id,
    p_square_location_id, p_variation_id, p_enabled, p_actor_id
  ) on conflict (id) do update
    set label = excluded.label, is_enabled = excluded.is_enabled,
      configured_by = p_actor_id, configured_at = clock_timestamp();

  return jsonb_build_object('id', p_item_id, 'enabled', p_enabled);
end
$$;

create function public.list_church_square_count_items(p_location_id uuid)
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
      'lastConfirmedQuantity', confirmed.quantity, 'lastConfirmedObservedAt', confirmed.observed_at
    ) order by item.label, item.id
  ), '[]'::jsonb) into items
  from private.church_square_count_items item
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

create function public.service_claim_church_square_count(
  p_actor_id uuid, p_location_id uuid, p_item_id uuid, p_request_id uuid,
  p_quantity text, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  target_organization uuid := private.church_square_count_organization(p_location_id);
  item private.church_square_count_items%rowtype;
  count_request private.church_square_count_requests%rowtype;
  now_at timestamptz;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role'
    or not private.can_record_church_square_count(p_actor_id, target_organization, p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;

  if p_item_id is null or p_request_id is null or coalesce(p_quantity, '') !~ '^(0|[1-9][0-9]{0,5})$'
    or coalesce(length(btrim(p_reason)), 0) not between 1 and 160 then
    raise exception 'A whole item quantity and count reason are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('church-square-count:' || p_request_id::text, 0));
  select * into item from private.church_square_count_items mapping
  where mapping.id = p_item_id and mapping.location_id = p_location_id
    and mapping.organization_id = target_organization and mapping.is_enabled for update;
  if item.id is null then
    raise exception 'This item is not enabled for Square counts' using errcode = 'PT409';
  end if;

  now_at := clock_timestamp();
  select * into count_request from private.church_square_count_requests request where request.id = p_request_id for update;
  if count_request.id is not null then
    if count_request.item_id <> p_item_id or count_request.quantity <> p_quantity
      or count_request.reason <> btrim(p_reason) then
      raise exception 'This count request ID already belongs to different facts' using errcode = 'PT409';
    end if;
    if count_request.status in ('confirmed', 'rejected') then
      return jsonb_build_object(
        'status', count_request.status, 'requestId', count_request.id,
        'observedAt', count_request.observed_at, 'quantity', count_request.quantity
      );
    end if;
    if count_request.attempt_expires_at > now_at then
      return jsonb_build_object(
        'status', 'in_progress', 'requestId', count_request.id,
        'observedAt', count_request.observed_at, 'quantity', count_request.quantity
      );
    end if;

    update private.church_square_count_requests request
    set attempt_id = gen_random_uuid(), attempt_actor_id = p_actor_id,
      attempt_expires_at = now_at + interval '90 seconds'
    where request.id = p_request_id returning * into count_request;
  else
    if exists (
      select 1 from private.church_square_count_requests request
      where request.item_id = p_item_id and request.status = 'pending'
    ) then
      raise exception 'A prior count for this item still requires confirmation' using errcode = 'PT409';
    end if;

    insert into private.church_square_count_requests (
      id, item_id, requested_by, quantity, reason, observed_at, status, attempt_id, attempt_actor_id, attempt_expires_at
    ) values (
      p_request_id, p_item_id, p_actor_id, p_quantity, btrim(p_reason), date_trunc('milliseconds', now_at),
      'pending', gen_random_uuid(), p_actor_id, now_at + interval '90 seconds'
    ) returning * into count_request;
  end if;

  return jsonb_build_object(
    'status', case when count_request.observed_at <= now_at - interval '24 hours'
      then 'recovery_required' else 'pending' end,
    'requestId', count_request.id, 'attemptId', count_request.attempt_id,
    'wasDispatched', count_request.dispatched_at is not null,
    'observedAt', count_request.observed_at, 'quantity', count_request.quantity,
    'merchantId', item.merchant_id, 'squareLocationId', item.square_location_id, 'variationId', item.variation_id
  );
end
$$;

create function public.service_mark_church_square_count_dispatched(
  p_request_id uuid, p_attempt_id uuid
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off as $$
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Square count dispatch is restricted to the server' using errcode = '42501';
  end if;

  update private.church_square_count_requests request
  set dispatched_at = coalesce(request.dispatched_at, clock_timestamp())
  from private.church_square_count_items item
  where request.id = p_request_id and request.attempt_id = p_attempt_id
    and request.status = 'pending' and request.attempt_expires_at > clock_timestamp()
    and request.observed_at > clock_timestamp() - interval '24 hours'
    and request.item_id = item.id and item.is_enabled
    and private.church_square_count_organization(item.location_id) = item.organization_id
    and private.can_record_church_square_count(request.attempt_actor_id, item.organization_id, item.location_id);
  if not found then
    raise exception 'This count can no longer be sent to Square' using errcode = 'PT409';
  end if;
  return true;
end
$$;

create function public.service_finish_church_square_count(
  p_request_id uuid, p_attempt_id uuid, p_status text, p_provider_count_id text default null
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  count_request private.church_square_count_requests%rowtype;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Square count completion is restricted to the server' using errcode = '42501';
  end if;
  if p_request_id is null or p_attempt_id is null
    or p_status is null or p_status not in ('confirmed', 'rejected')
    or (p_provider_count_id is not null and (
      p_provider_count_id !~ '^[A-Za-z0-9_-]{1,192}$' or p_status <> 'confirmed'
    )) then
    raise exception 'A count attempt and definite provider outcome are required' using errcode = '22023';
  end if;

  select * into count_request from private.church_square_count_requests request
  where request.id = p_request_id for update;
  if count_request.id is null or count_request.attempt_id <> p_attempt_id
    or count_request.status not in ('pending', p_status) then
    raise exception 'This count attempt is no longer current' using errcode = 'PT409';
  end if;

  if p_status = 'rejected' and count_request.dispatched_at is not null then
    raise exception 'A count which may have reached Square requires confirmation' using errcode = 'PT409';
  end if;
  if p_status = 'confirmed' and count_request.dispatched_at is null then
    raise exception 'A count that was never sent cannot be confirmed' using errcode = 'PT409';
  end if;
  if p_status = 'confirmed' and count_request.attempt_expires_at - interval '90 seconds' >= count_request.observed_at + interval '24 hours'
    and p_provider_count_id is null then
    raise exception 'An expired count can only be confirmed by its Square physical count receipt' using errcode = 'PT409';
  end if;

  if count_request.status = 'pending' then
    update private.church_square_count_requests request
    set status = p_status, provider_count_id = p_provider_count_id, completed_at = clock_timestamp()
    where request.id = p_request_id
    returning * into count_request;
  end if;

  return jsonb_build_object(
    'status', count_request.status, 'requestId', count_request.id,
    'observedAt', count_request.observed_at, 'quantity', count_request.quantity
  );
end
$$;

revoke all on function public.list_church_square_count_items(uuid),
  public.service_configure_church_square_count_item(uuid, uuid, uuid, text, text, text, text, boolean),
  public.service_claim_church_square_count(uuid, uuid, uuid, uuid, text, text),
  public.service_mark_church_square_count_dispatched(uuid, uuid),
  public.service_finish_church_square_count(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.list_church_square_count_items(uuid) to authenticated;
grant execute on function public.service_configure_church_square_count_item(uuid, uuid, uuid, text, text, text, text, boolean),
  public.service_claim_church_square_count(uuid, uuid, uuid, uuid, text, text),
  public.service_mark_church_square_count_dispatched(uuid, uuid),
  public.service_finish_church_square_count(uuid, uuid, text, text) to service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114063316',
  table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint',
  access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
