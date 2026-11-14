create table private.church_square_webhook_receipts (
  merchant_id text not null check (merchant_id ~ '^[A-Za-z0-9_:-]{1,192}$'),
  square_location_id text not null check (square_location_id ~ '^[A-Za-z0-9_:-]{1,192}$'),
  event_id text not null check (event_id ~ '^[A-Za-z0-9_:-]{1,192}$'),
  event_type text not null check (event_type in (
    'inventory.count.updated', 'order.created', 'order.updated', 'payment.created', 'payment.updated',
    'refund.created', 'refund.updated', 'invoice.published', 'invoice.updated', 'invoice.payment_made',
    'invoice.refunded', 'invoice.canceled'
  )),
  resource_id text not null check (resource_id ~ '^[A-Za-z0-9_:-]{1,192}$'),
  related_order_id text check (related_order_id ~ '^[A-Za-z0-9_:-]{1,192}$'),
  organization_id uuid not null,
  location_id uuid not null,
  created_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  primary key (merchant_id, event_id),
  foreign key (organization_id, location_id) references public.locations(organization_id, id)
);

create index church_square_webhook_receipts_location_received
  on private.church_square_webhook_receipts (location_id, received_at desc);

create table private.church_square_stock_state (
  item_id uuid primary key references private.church_square_count_items(id) on delete cascade,
  quantity numeric(17,5) not null,
  calculated_at timestamptz not null,
  episode_id uuid,
  check ((quantity <= 5) = (episode_id is not null))
);

alter table private.church_square_webhook_receipts enable row level security;
alter table private.church_square_webhook_receipts force row level security;
alter table private.church_square_stock_state enable row level security;
alter table private.church_square_stock_state force row level security;
revoke all on private.church_square_webhook_receipts, private.church_square_stock_state
  from public, anon, authenticated, service_role;

create table public.church_square_stock_invalidation_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, location_id),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade
);

alter table public.church_square_stock_invalidation_signals enable row level security;
alter table public.church_square_stock_invalidation_signals force row level security;
revoke all on public.church_square_stock_invalidation_signals from public, anon, authenticated, service_role;
grant select on public.church_square_stock_invalidation_signals to authenticated, service_role;

create function public.can_read_church_square_stock_scope(p_organization_id uuid, p_location_id uuid)
returns boolean language sql stable security definer set search_path = '' set row_security = off
as $$
  select p_organization_id is not null
    and p_organization_id is not distinct from private.church_square_count_organization(p_location_id)
    and private.can_record_church_square_count(auth.uid(), p_organization_id, p_location_id)
$$;

create policy church_square_stock_signals_read
  on public.church_square_stock_invalidation_signals for select to authenticated
  using (public.can_read_church_square_stock_scope(organization_id, location_id));

comment on table public.church_square_stock_invalidation_signals is
  'One revision per location. Alert content is only available through the authorized stock alert projection.';

create function public.list_church_square_stock_alerts(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  target_organization uuid := private.church_square_count_organization(p_location_id);
begin
  if not private.can_record_church_square_count(auth.uid(), target_organization, p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id, 'label', item.label, 'quantity', trim_scale(stock.quantity)::text,
      'calculatedAt', stock.calculated_at, 'episode', stock.episode_id
    ) order by stock.quantity, item.label, item.id), '[]'::jsonb)
    from private.church_square_count_items item
    join private.church_square_stock_state stock on stock.item_id = item.id
    where item.organization_id = target_organization and item.location_id = p_location_id
      and item.is_enabled and stock.episode_id is not null
  );
end
$$;

create function public.list_church_square_webhook_receipts(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  target_organization uuid := private.church_square_count_organization(p_location_id);
  current_user_id uuid := auth.uid();
begin
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = target_organization and membership.user_id = current_user_id
      and membership.status = 'active'
      and (
        membership.role in ('owner', 'admin')
        or (membership.role = 'manager' and exists (
          select 1 from public.location_memberships assignment
          where assignment.organization_id = target_organization and assignment.user_id = current_user_id
            and assignment.location_id = p_location_id
        ))
      )
  ) then
    raise exception 'Church Street management access is required' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'type', recent.event_type, 'createdAt', recent.created_at, 'receivedAt', recent.received_at
    ) order by recent.received_at desc, recent.event_id desc), '[]'::jsonb)
    from (
      select receipt.event_type, receipt.created_at, receipt.received_at, receipt.event_id
      from private.church_square_webhook_receipts receipt
      where receipt.organization_id = target_organization and receipt.location_id = p_location_id
      order by receipt.received_at desc, receipt.event_id desc
      limit 20
    ) recent
  );
end
$$;

create function public.service_record_church_square_webhook(
  p_merchant_id text, p_square_location_id text, p_event_id text, p_event_type text,
  p_created_at timestamptz, p_resource_id text, p_inventory jsonb, p_related_order_id text default null
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  target_organization uuid;
  target_location uuid;
  observation record;
  current_stock private.church_square_stock_state%rowtype;
  changed_alert boolean := false;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'Square webhook service access is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_inventory) is distinct from 'array' or jsonb_array_length(p_inventory) > 2000
    or (p_event_type <> 'inventory.count.updated' and p_inventory <> '[]'::jsonb) then
    raise exception 'Invalid Square inventory projection' using errcode = '22023';
  end if;

  select organization.id, location.id into target_organization, target_location
  from public.organizations organization
  join public.locations location on location.organization_id = organization.id
  where organization.slug = 'le-yard-church-street' and organization.status = 'active'
    and location.code = 'CHURCH' and location.is_active
    and private.is_counter_service_org(organization.id);
  if target_location is null then
    raise exception 'Active Church Street location is required' using errcode = '42501';
  end if;

  -- Church Square scope never changes silently after a mapping exists. The
  -- route independently verifies every signed event against the configured scope.
  if exists (
    select 1 from private.church_square_count_items item
    where item.location_id = target_location
      and (item.merchant_id, item.square_location_id) is distinct from (p_merchant_id, p_square_location_id)
  ) then
    raise exception 'Square webhook scope does not match Church Street' using errcode = '42501';
  end if;

  insert into private.church_square_webhook_receipts (
    merchant_id, square_location_id, event_id, event_type, resource_id, related_order_id,
    organization_id, location_id, created_at
  ) values (
    p_merchant_id, p_square_location_id, p_event_id, p_event_type, p_resource_id, p_related_order_id,
    target_organization, target_location, p_created_at
  ) on conflict (merchant_id, event_id) do nothing;
  if not found then return false; end if;

  -- Process multiple variations in stable order to avoid cross-request locks
  -- in opposite directions. The latest timestamp wins for repeated items.
  for observation in
    select distinct on (item.id) item.id,
      (stock.value->>'quantity')::numeric(17,5) as quantity,
      (stock.value->>'calculatedAt')::timestamptz as calculated_at
    from jsonb_array_elements(p_inventory) as stock(value)
    join private.church_square_count_items item
      on item.merchant_id = p_merchant_id and item.square_location_id = p_square_location_id
      and item.variation_id = stock.value->>'variationId' and item.location_id = target_location and item.is_enabled
    where stock.value->>'quantity' ~ '^-?[0-9]{1,12}(\.[0-9]{1,5})?$'
      and stock.value->>'calculatedAt' is not null
    order by item.id, calculated_at desc, quantity desc
  loop
    perform pg_advisory_xact_lock(hashtextextended('church-square-stock:' || observation.id::text, 0));
    select * into current_stock from private.church_square_stock_state stock where stock.item_id = observation.id;
    if current_stock.calculated_at >= observation.calculated_at then continue; end if;

    if (current_stock.episode_id is not null or observation.quantity <= 5)
      and (current_stock.quantity is distinct from observation.quantity or current_stock.episode_id is null) then
      changed_alert := true;
    end if;

    insert into private.church_square_stock_state(item_id, quantity, calculated_at, episode_id)
    values (
      observation.id, observation.quantity, observation.calculated_at,
      case when observation.quantity <= 5 then coalesce(current_stock.episode_id, gen_random_uuid()) end
    )
    on conflict (item_id) do update set
      quantity = excluded.quantity, calculated_at = excluded.calculated_at, episode_id = excluded.episode_id;
  end loop;

  if changed_alert then
    insert into public.church_square_stock_invalidation_signals as signal (organization_id, location_id)
    values (target_organization, target_location)
    on conflict (organization_id, location_id) do update
      set revision = signal.revision + 1, updated_at = clock_timestamp();
  end if;
  return true;
end
$$;

revoke all on function public.can_read_church_square_stock_scope(uuid, uuid),
  public.list_church_square_stock_alerts(uuid), public.list_church_square_webhook_receipts(uuid),
  public.service_record_church_square_webhook(text, text, text, text, timestamptz, text, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.can_read_church_square_stock_scope(uuid, uuid),
  public.list_church_square_stock_alerts(uuid), public.list_church_square_webhook_receipts(uuid) to authenticated;
grant execute on function public.service_record_church_square_webhook(text, text, text, text, timestamptz, text, jsonb, text)
  to service_role;

do $church_stock_realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'church_square_stock_invalidation_signals'
    ) then
    alter publication supabase_realtime add table public.church_square_stock_invalidation_signals;
  end if;
end
$church_stock_realtime$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114074000',
  table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint',
  access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
