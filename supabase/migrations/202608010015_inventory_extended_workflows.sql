-- Le Yard OS: authoritative purchasing, receiving, waste, and transfer workflows.
-- All tenant/actor evidence is derived in the database. Browser callers provide
-- request ids and observations only; critical records cannot be changed directly.

alter table public.waste_records
add column status public.review_status not null default 'pending',
add column review_note text;

update public.waste_records
set status = 'approved'
where approved_at is not null;

alter table public.waste_records
add constraint waste_review_evidence_check
check (
  (
    status in ('pending', 'in_review')
    and approved_by is null
    and approved_at is null
  )
  or (
    status in ('approved', 'rejected')
    and approved_by is not null
    and approved_at is not null
  )
);

alter table public.inventory_transfers
add column reviewed_by uuid references auth.users(id) on delete set null,
add column reviewed_at timestamptz,
add column review_note text;

update public.inventory_transfers
set reviewed_by = coalesce(received_by, created_by),
    reviewed_at = coalesce(received_at, updated_at)
where status in ('received', 'cancelled');

alter table public.inventory_transfers
add constraint transfer_review_evidence_check
check (
  (
    status in ('draft', 'in_transit')
    and reviewed_by is null
    and reviewed_at is null
  )
  or (
    status = 'received'
    and reviewed_by is not null
    and reviewed_at is not null
    and received_by = reviewed_by
    and sent_at is not null
    and received_at is not null
  )
  or (
    status = 'cancelled'
    and reviewed_by is not null
    and reviewed_at is not null
    and received_by is null
    and received_at is null
  )
);

create unique index purchase_order_line_once_per_item_unit
on public.purchase_order_lines (purchase_order_id, inventory_item_id, unit_id);

create unique index delivery_line_once_per_item_unit
on public.delivery_lines (delivery_id, inventory_item_id, unit_id);

create unique index inventory_transfer_line_once_per_item_unit
on public.inventory_transfer_lines (transfer_id, inventory_item_id, unit_id);

create unique index inventory_delivery_post_once
on public.inventory_transactions (
  organization_id, location_id, reference_id, inventory_item_id, transaction_kind
)
where reference_type = 'delivery'
  and transaction_kind = 'purchase';

create unique index inventory_waste_post_once
on public.inventory_transactions (
  organization_id, location_id, reference_id, inventory_item_id, transaction_kind
)
where reference_type = 'waste_record'
  and transaction_kind = 'waste';

create unique index inventory_transfer_post_once
on public.inventory_transactions (
  organization_id, location_id, reference_id, inventory_item_id, transaction_kind
)
where reference_type = 'inventory_transfer'
  and transaction_kind in ('transfer_in', 'transfer_out');

create function private.inventory_conversion_multiplier(
  p_organization_id uuid,
  p_inventory_item_id uuid,
  p_from_unit_id uuid,
  p_to_unit_id uuid
)
returns numeric
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  result numeric;
begin
  if p_from_unit_id = p_to_unit_id then return 1; end if;

  select case
    when conversion.from_unit_id = p_from_unit_id then conversion.multiplier
    else 1 / conversion.multiplier
  end
  into result
  from public.unit_conversions conversion
  where conversion.organization_id = p_organization_id
    and (conversion.item_id is null or conversion.item_id = p_inventory_item_id)
    and (
      (conversion.from_unit_id = p_from_unit_id and conversion.to_unit_id = p_to_unit_id)
      or
      (conversion.from_unit_id = p_to_unit_id and conversion.to_unit_id = p_from_unit_id)
    )
  order by (conversion.item_id = p_inventory_item_id) desc,
    (conversion.from_unit_id = p_from_unit_id) desc,
    conversion.id
  limit 1;

  if result is null then
    raise exception 'The selected unit has no canonical conversion for this item'
      using errcode = '23514';
  end if;
  return result;
end
$$;

create function private.inventory_base_quantity(
  p_organization_id uuid,
  p_inventory_item_id uuid,
  p_unit_id uuid,
  p_quantity numeric
)
returns numeric
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select round(
    p_quantity * private.inventory_conversion_multiplier(
      p_organization_id,
      p_inventory_item_id,
      p_unit_id,
      item.base_unit_id
    ),
    6
  )
  from public.inventory_items item
  where item.organization_id = p_organization_id
    and item.id = p_inventory_item_id
$$;

create function private.inventory_base_unit_cost(
  p_organization_id uuid,
  p_inventory_item_id uuid,
  p_unit_id uuid,
  p_unit_price_cents bigint
)
returns bigint
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select round(
    p_unit_price_cents / private.inventory_conversion_multiplier(
      p_organization_id,
      p_inventory_item_id,
      p_unit_id,
      item.base_unit_id
    )
  )::bigint
  from public.inventory_items item
  where item.organization_id = p_organization_id
    and item.id = p_inventory_item_id
$$;

revoke all on function private.inventory_conversion_multiplier(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function private.inventory_base_quantity(uuid, uuid, uuid, numeric)
from public, anon, authenticated;
revoke all on function private.inventory_base_unit_cost(uuid, uuid, uuid, bigint)
from public, anon, authenticated;

create function public.guard_waste_review_mutation()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  trusted_actor boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role';
begin
  if trusted_actor then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then
    raise exception 'Waste review evidence is immutable' using errcode = '42501';
  end if;
  if old.status <> 'pending'
    or not exists (
      select 1
      from private.operation_requests request
      where request.operation_kind = 'inventory.waste_review'
        and request.record_id = old.id
        and request.actor_id = auth.uid()
        and request.completed_at is null
    )
    or new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.inventory_item_id is distinct from old.inventory_item_id
    or new.unit_id is distinct from old.unit_id
    or new.quantity is distinct from old.quantity
    or new.reason_code is distinct from old.reason_code
    or new.estimated_cost_cents is distinct from old.estimated_cost_cents
    or new.occurred_at is distinct from old.occurred_at
    or new.notes is distinct from old.notes
    or new.recorded_by is distinct from old.recorded_by
    or new.created_at is distinct from old.created_at
    or new.status not in ('approved', 'rejected')
    or new.approved_by is distinct from auth.uid()
    or new.approved_at is null then
    raise exception 'Waste review evidence can only be changed by its authorized workflow'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger waste_review_mutation_guard
before update or delete on public.waste_records
for each row execute function public.guard_waste_review_mutation();

create function public.guard_inventory_transfer_mutation()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  trusted_actor boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role';
begin
  if trusted_actor then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then
    raise exception 'Transfer review evidence is immutable' using errcode = '42501';
  end if;
  if old.status <> 'draft'
    or not exists (
      select 1
      from private.operation_requests request
      where request.operation_kind = 'inventory.transfer_review'
        and request.record_id = old.id
        and request.actor_id = auth.uid()
        and request.completed_at is null
    )
    or new.organization_id is distinct from old.organization_id
    or new.from_location_id is distinct from old.from_location_id
    or new.to_location_id is distinct from old.to_location_id
    or new.created_by is distinct from old.created_by
    or new.notes is distinct from old.notes
    or new.created_at is distinct from old.created_at
    or new.status not in ('received', 'cancelled')
    or new.reviewed_by is distinct from auth.uid()
    or new.reviewed_at is null
    or (
      new.status = 'received'
      and (
        new.received_by is distinct from auth.uid()
        or new.sent_at is null
        or new.received_at is null
      )
    )
    or (
      new.status = 'cancelled'
      and (
        new.received_by is not null
        or new.sent_at is not null
        or new.received_at is not null
      )
    ) then
    raise exception 'Transfer evidence can only be changed by its authorized workflow'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger inventory_transfer_mutation_guard
before update or delete on public.inventory_transfers
for each row execute function public.guard_inventory_transfer_mutation();

create function public.guard_inventory_transfer_line_mutation()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  trusted_actor boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role';
  line_transfer_id uuid := coalesce(new.transfer_id, old.transfer_id);
begin
  if trusted_actor then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then
    raise exception 'Transfer line evidence is immutable' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from private.operation_requests request
      where request.operation_kind = 'inventory.transfer_create'
        and request.record_id = line_transfer_id
        and request.actor_id = auth.uid()
        and request.completed_at is null
    ) then
      raise exception 'Transfer lines must be created by the authorized workflow'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if not exists (
      select 1 from private.operation_requests request
      where request.operation_kind = 'inventory.transfer_review'
        and request.record_id = line_transfer_id
        and request.actor_id = auth.uid()
        and request.completed_at is null
    )
    or new.organization_id is distinct from old.organization_id
    or new.transfer_id is distinct from old.transfer_id
    or new.inventory_item_id is distinct from old.inventory_item_id
    or new.unit_id is distinct from old.unit_id
    or new.sent_quantity is distinct from old.sent_quantity
    or new.created_at is distinct from old.created_at
    or old.received_quantity is not null
    or new.received_quantity is null
    or new.received_quantity < 0
    or new.received_quantity > new.sent_quantity then
    raise exception 'Transfer line receipt evidence can only be changed by the authorized workflow'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger inventory_transfer_line_mutation_guard
before insert or update or delete on public.inventory_transfer_lines
for each row execute function public.guard_inventory_transfer_line_mutation();

-- Replace the count-only ledger guard with a guard that also recognizes the
-- new, actor-bound inventory workflow evidence.
create or replace function public.guard_inventory_transaction_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  trusted_actor boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role';
  count_row public.inventory_counts%rowtype;
  item_row public.inventory_items%rowtype;
  delivery_row public.deliveries%rowtype;
  delivery_line public.delivery_lines%rowtype;
  waste_row public.waste_records%rowtype;
  transfer_row public.inventory_transfers%rowtype;
  transfer_line public.inventory_transfer_lines%rowtype;
  expected_quantity numeric;
  expected_cost bigint;
begin
  select * into item_row
  from public.inventory_items item
  where item.id = new.inventory_item_id;
  if item_row.id is null
    or item_row.organization_id <> new.organization_id
    or item_row.base_unit_id <> new.unit_id then
    raise exception 'Inventory ledger quantities must use the item base unit'
      using errcode = '23514';
  end if;
  if trusted_actor then return new; end if;

  if new.transaction_kind = 'count_adjustment'
    and new.reference_type = 'inventory_count'
    and new.reference_id is not null then
    select * into count_row
    from public.inventory_counts count_candidate
    where count_candidate.id = new.reference_id;
    if count_row.id is null
      or count_row.organization_id <> new.organization_id
      or count_row.location_id <> new.location_id
      or count_row.status <> 'pending'
      or count_row.counted_by <> new.created_by
      or new.approved_by is distinct from auth.uid()
      or new.approved_at is null
      or not exists (
        select 1
        from private.inventory_count_approval_requests request
        where request.inventory_count_id = count_row.id
          and request.actor_id = auth.uid()
          and request.approve
          and request.completed_at is null
      ) then
      raise exception 'Inventory count adjustment evidence is invalid'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.transaction_kind = 'purchase'
    and new.reference_type = 'delivery'
    and new.reference_id is not null then
    select * into delivery_row
    from public.deliveries delivery
    where delivery.id = new.reference_id;
    select * into delivery_line
    from public.delivery_lines line
    where line.delivery_id = new.reference_id
      and line.inventory_item_id = new.inventory_item_id;
    if delivery_row.id is null
      or delivery_line.id is null
      or delivery_row.organization_id <> new.organization_id
      or delivery_row.location_id <> new.location_id
      or delivery_row.received_by <> auth.uid()
      or new.created_by <> auth.uid()
      or new.approved_by <> auth.uid()
      or new.approved_at is null
      or not exists (
        select 1 from private.operation_requests request
        where request.operation_kind = 'inventory.delivery_receive'
          and request.record_id = delivery_row.id
          and request.actor_id = auth.uid()
          and request.completed_at is null
      ) then
      raise exception 'Delivery inventory evidence is invalid' using errcode = '42501';
    end if;
    expected_quantity := private.inventory_base_quantity(
      delivery_row.organization_id,
      delivery_line.inventory_item_id,
      delivery_line.unit_id,
      delivery_line.accepted_quantity
    );
    expected_cost := private.inventory_base_unit_cost(
      delivery_row.organization_id,
      delivery_line.inventory_item_id,
      delivery_line.unit_id,
      delivery_line.unit_price_cents
    );
    if new.quantity_delta is distinct from expected_quantity
      or new.unit_cost_cents is distinct from expected_cost
      or new.occurred_at is distinct from delivery_row.delivered_at then
      raise exception 'Delivery ledger quantity or cost is not canonical'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.transaction_kind = 'waste'
    and new.reference_type = 'waste_record'
    and new.reference_id is not null then
    select * into waste_row
    from public.waste_records waste
    where waste.id = new.reference_id;
    expected_quantity := private.inventory_base_quantity(
      waste_row.organization_id,
      waste_row.inventory_item_id,
      waste_row.unit_id,
      waste_row.quantity
    );
    expected_cost := case
      when waste_row.estimated_cost_cents is null then null
      else round(waste_row.estimated_cost_cents / expected_quantity)::bigint
    end;
    if waste_row.id is null
      or waste_row.organization_id <> new.organization_id
      or waste_row.location_id <> new.location_id
      or waste_row.status <> 'pending'
      or waste_row.recorded_by <> new.created_by
      or new.approved_by is distinct from auth.uid()
      or new.approved_at is null
      or new.quantity_delta is distinct from -expected_quantity
      or new.unit_cost_cents is distinct from expected_cost
      or new.occurred_at is distinct from waste_row.occurred_at
      or not exists (
        select 1 from private.operation_requests request
        where request.operation_kind = 'inventory.waste_review'
          and request.record_id = waste_row.id
          and request.actor_id = auth.uid()
          and request.completed_at is null
      ) then
      raise exception 'Waste inventory evidence is invalid' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.transaction_kind in ('transfer_in', 'transfer_out')
    and new.reference_type = 'inventory_transfer'
    and new.reference_id is not null then
    select * into transfer_row
    from public.inventory_transfers transfer
    where transfer.id = new.reference_id;
    select * into transfer_line
    from public.inventory_transfer_lines line
    where line.transfer_id = new.reference_id
      and line.inventory_item_id = new.inventory_item_id;
    if transfer_row.id is null
      or transfer_line.id is null
      or transfer_row.organization_id <> new.organization_id
      or transfer_row.status <> 'draft'
      or transfer_row.created_by <> new.created_by
      or new.approved_by is distinct from auth.uid()
      or new.approved_at is null
      or not exists (
        select 1 from private.operation_requests request
        where request.operation_kind = 'inventory.transfer_review'
          and request.record_id = transfer_row.id
          and request.actor_id = auth.uid()
          and request.completed_at is null
      ) then
      raise exception 'Transfer inventory evidence is invalid' using errcode = '42501';
    end if;
    expected_quantity := private.inventory_base_quantity(
      transfer_row.organization_id,
      transfer_line.inventory_item_id,
      transfer_line.unit_id,
      case
        when new.transaction_kind = 'transfer_out' then transfer_line.sent_quantity
        else transfer_line.received_quantity
      end
    );
    if (
        new.transaction_kind = 'transfer_out'
        and (
          new.location_id <> transfer_row.from_location_id
          or new.quantity_delta is distinct from -expected_quantity
        )
      ) or (
        new.transaction_kind = 'transfer_in'
        and (
          new.location_id <> transfer_row.to_location_id
          or new.quantity_delta is distinct from expected_quantity
        )
      ) then
      raise exception 'Transfer ledger quantity or location is not canonical'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'Inventory ledger rows must be created by an authorized workflow'
    using errcode = '42501';
end
$$;

create function public.create_purchase_order(
  p_request_id uuid,
  p_location_id uuid,
  p_vendor_id uuid,
  p_po_number text,
  p_ordered_on date,
  p_expected_on date,
  p_tax_cents bigint,
  p_shipping_cents bigint,
  p_notes text,
  p_lines jsonb
)
returns public.purchase_orders
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  vendor_row public.vendors%rowtype;
  result public.purchase_orders%rowtype;
  clean_number text := nullif(btrim(p_po_number), '');
  clean_notes text := nullif(btrim(p_notes), '');
  canonical_lines jsonb;
  canonical_payload jsonb;
  subtotal bigint;
  claimed boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if clean_number is null or length(clean_number) > 80
    or p_tax_cents is null or p_tax_cents < 0
    or p_shipping_cents is null or p_shipping_cents < 0
    or (p_ordered_on is not null and p_expected_on is not null and p_expected_on < p_ordered_on)
    or (clean_notes is not null and length(clean_notes) > 4000)
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'Invalid purchase order payload' using errcode = '22023';
  end if;

  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_manage_location(location_row.organization_id, location_row.id) then
    raise exception 'Not authorized to create this purchase order'
      using errcode = '42501';
  end if;
  select * into vendor_row
  from public.vendors vendor
  where vendor.id = p_vendor_id
    and vendor.organization_id = location_row.organization_id
    and vendor.is_active;
  if vendor_row.id is null then
    raise exception 'The selected vendor is not active for this organization'
      using errcode = '23514';
  end if;

  begin
    if exists (
      select 1
      from jsonb_array_elements(p_lines) line
      where jsonb_typeof(line) <> 'object'
        or not (line ?& array['inventory_item_id', 'unit_id', 'quantity', 'unit_price_cents'])
        or (line ->> 'quantity')::numeric <= 0
        or (line ->> 'quantity')::numeric >= 1000000000000
        or scale((line ->> 'quantity')::numeric) > 4
        or (line ->> 'unit_price_cents')::numeric < 0
        or scale((line ->> 'unit_price_cents')::numeric) > 0
        or (line ->> 'unit_price_cents')::numeric > 9000000000000000
        or length(coalesce(line ->> 'notes', '')) > 2000
    ) or (
      select count(*) <> count(distinct concat(line ->> 'inventory_item_id', ':', line ->> 'unit_id'))
      from jsonb_array_elements(p_lines) line
    ) then
      raise exception 'Invalid or duplicate purchase order lines' using errcode = '22023';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid purchase order line value' using errcode = '22023';
  end;

  if (
    select count(*)
    from jsonb_array_elements(p_lines) line
    join public.inventory_items item
      on item.id = (line ->> 'inventory_item_id')::uuid
     and item.organization_id = location_row.organization_id
     and item.is_active
     and item.track_inventory
    join public.measurement_units unit
      on unit.id = (line ->> 'unit_id')::uuid
     and unit.organization_id = location_row.organization_id
    where private.inventory_conversion_multiplier(
      location_row.organization_id, item.id, unit.id, item.base_unit_id
    ) > 0
  ) <> jsonb_array_length(p_lines) then
    raise exception 'Every order line must use an active tenant item and compatible unit'
      using errcode = '23514';
  end if;

  select jsonb_agg(jsonb_build_object(
      'inventory_item_id', (line ->> 'inventory_item_id')::uuid,
      'unit_id', (line ->> 'unit_id')::uuid,
      'quantity', (line ->> 'quantity')::numeric,
      'unit_price_cents', (line ->> 'unit_price_cents')::bigint,
      'notes', nullif(btrim(line ->> 'notes'), '')
    ) order by line ->> 'inventory_item_id', line ->> 'unit_id'),
    sum(round((line ->> 'quantity')::numeric * (line ->> 'unit_price_cents')::bigint))::bigint
  into canonical_lines, subtotal
  from jsonb_array_elements(p_lines) line;
  canonical_payload := jsonb_build_object(
    'location_id', location_row.id,
    'vendor_id', vendor_row.id,
    'po_number', clean_number,
    'ordered_on', p_ordered_on,
    'expected_on', p_expected_on,
    'tax_cents', p_tax_cents,
    'shipping_cents', p_shipping_cents,
    'notes', clean_notes,
    'lines', canonical_lines
  );
  claimed := private.claim_operation_request(
    p_request_id, 'inventory.purchase_order_create',
    location_row.organization_id, location_row.id, p_request_id, canonical_payload
  );
  if not claimed then
    select * into result from public.purchase_orders purchase_order
    where purchase_order.id = p_request_id;
    if result.id is null then
      raise exception 'Purchase order replay has no matching result' using errcode = '40001';
    end if;
    return result;
  end if;

  insert into public.purchase_orders (
    id, organization_id, location_id, vendor_id, po_number, status,
    ordered_on, expected_on, subtotal_cents, tax_cents, shipping_cents,
    notes, created_by
  ) values (
    p_request_id, location_row.organization_id, location_row.id, vendor_row.id,
    clean_number, 'submitted', p_ordered_on, p_expected_on, subtotal,
    p_tax_cents, p_shipping_cents, clean_notes, actor_id
  ) returning * into result;

  insert into public.purchase_order_lines (
    organization_id, purchase_order_id, inventory_item_id,
    unit_id, quantity, unit_price_cents, notes
  )
  select location_row.organization_id, result.id,
    (line ->> 'inventory_item_id')::uuid,
    (line ->> 'unit_id')::uuid,
    (line ->> 'quantity')::numeric(16,4),
    (line ->> 'unit_price_cents')::bigint,
    nullif(btrim(line ->> 'notes'), '')
  from jsonb_array_elements(canonical_lines) line;

  perform private.complete_operation_request(p_request_id);
  return result;
end
$$;

create function public.receive_inventory_delivery(
  p_request_id uuid,
  p_location_id uuid,
  p_vendor_id uuid,
  p_purchase_order_id uuid,
  p_delivered_at timestamptz,
  p_invoice_number text,
  p_notes text,
  p_lines jsonb
)
returns public.deliveries
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  vendor_row public.vendors%rowtype;
  order_row public.purchase_orders%rowtype;
  result public.deliveries%rowtype;
  clean_invoice text := nullif(btrim(p_invoice_number), '');
  clean_notes text := nullif(btrim(p_notes), '');
  canonical_lines jsonb;
  canonical_payload jsonb;
  claimed boolean;
  decision_at timestamptz := clock_timestamp();
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_delivered_at is null
    or (clean_invoice is not null and length(clean_invoice) > 120)
    or (clean_notes is not null and length(clean_notes) > 4000)
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'Invalid delivery payload' using errcode = '22023';
  end if;

  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_manage_location(location_row.organization_id, location_row.id) then
    raise exception 'Not authorized to receive this delivery'
      using errcode = '42501';
  end if;
  select * into vendor_row
  from public.vendors vendor
  where vendor.id = p_vendor_id
    and vendor.organization_id = location_row.organization_id
    and vendor.is_active;
  if vendor_row.id is null then
    raise exception 'The selected vendor is not active for this organization'
      using errcode = '23514';
  end if;
  if p_purchase_order_id is not null then
    select * into order_row
    from public.purchase_orders purchase_order
    where purchase_order.id = p_purchase_order_id
    for update;
    if order_row.id is null
      or order_row.organization_id <> location_row.organization_id
      or order_row.location_id <> location_row.id
      or order_row.vendor_id <> vendor_row.id
      or order_row.status in ('received', 'cancelled') then
      raise exception 'The selected purchase order cannot receive this delivery'
        using errcode = '23514';
    end if;
  end if;

  begin
    if exists (
      select 1
      from jsonb_array_elements(p_lines) line
      where jsonb_typeof(line) <> 'object'
        or not (line ?& array['inventory_item_id', 'unit_id', 'quantity', 'accepted_quantity', 'unit_price_cents'])
        or (line ->> 'quantity')::numeric <= 0
        or (line ->> 'quantity')::numeric >= 1000000000000
        or scale((line ->> 'quantity')::numeric) > 4
        or (line ->> 'accepted_quantity')::numeric < 0
        or (line ->> 'accepted_quantity')::numeric > (line ->> 'quantity')::numeric
        or scale((line ->> 'accepted_quantity')::numeric) > 4
        or (line ->> 'unit_price_cents')::numeric < 0
        or scale((line ->> 'unit_price_cents')::numeric) > 0
        or (line ->> 'unit_price_cents')::numeric > 9000000000000000
        or length(coalesce(line ->> 'lot_code', '')) > 120
    ) or (
      select count(*) <> count(distinct concat(line ->> 'inventory_item_id', ':', line ->> 'unit_id'))
      from jsonb_array_elements(p_lines) line
    ) then
      raise exception 'Invalid or duplicate delivery lines' using errcode = '22023';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid delivery line value' using errcode = '22023';
  end;

  if (
    select count(*)
    from jsonb_array_elements(p_lines) line
    join public.inventory_items item
      on item.id = (line ->> 'inventory_item_id')::uuid
     and item.organization_id = location_row.organization_id
     and item.is_active
     and item.track_inventory
    join public.measurement_units unit
      on unit.id = (line ->> 'unit_id')::uuid
     and unit.organization_id = location_row.organization_id
    where private.inventory_conversion_multiplier(
      location_row.organization_id, item.id, unit.id, item.base_unit_id
    ) > 0
  ) <> jsonb_array_length(p_lines) then
    raise exception 'Every delivery line must use an active tenant item and compatible unit'
      using errcode = '23514';
  end if;

  if order_row.id is not null and exists (
    select 1
    from jsonb_array_elements(p_lines) line
    left join public.purchase_order_lines order_line
      on order_line.purchase_order_id = order_row.id
     and order_line.inventory_item_id = (line ->> 'inventory_item_id')::uuid
     and order_line.unit_id = (line ->> 'unit_id')::uuid
    where order_line.id is null
      or coalesce((
        select sum(prior_line.accepted_quantity)
        from public.delivery_lines prior_line
        join public.deliveries prior_delivery on prior_delivery.id = prior_line.delivery_id
        where prior_delivery.purchase_order_id = order_row.id
          and prior_line.inventory_item_id = order_line.inventory_item_id
          and prior_line.unit_id = order_line.unit_id
      ), 0) + (line ->> 'accepted_quantity')::numeric > order_line.quantity
  ) then
    raise exception 'Delivery quantities exceed the selected purchase order'
      using errcode = '23514';
  end if;

  select jsonb_agg(jsonb_build_object(
      'inventory_item_id', (line ->> 'inventory_item_id')::uuid,
      'unit_id', (line ->> 'unit_id')::uuid,
      'quantity', (line ->> 'quantity')::numeric,
      'accepted_quantity', (line ->> 'accepted_quantity')::numeric,
      'unit_price_cents', (line ->> 'unit_price_cents')::bigint,
      'lot_code', nullif(btrim(line ->> 'lot_code'), ''),
      'expires_on', nullif(line ->> 'expires_on', '')::date
    ) order by line ->> 'inventory_item_id', line ->> 'unit_id')
  into canonical_lines
  from jsonb_array_elements(p_lines) line;
  canonical_payload := jsonb_build_object(
    'location_id', location_row.id,
    'vendor_id', vendor_row.id,
    'purchase_order_id', order_row.id,
    'delivered_at', p_delivered_at,
    'invoice_number', clean_invoice,
    'notes', clean_notes,
    'lines', canonical_lines
  );
  claimed := private.claim_operation_request(
    p_request_id, 'inventory.delivery_receive',
    location_row.organization_id, location_row.id, p_request_id, canonical_payload
  );
  if not claimed then
    select * into result from public.deliveries delivery
    where delivery.id = p_request_id;
    if result.id is null then
      raise exception 'Delivery replay has no matching result' using errcode = '40001';
    end if;
    return result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-ledger:' || location_row.organization_id::text || ':'
      || location_row.id::text || ':' || (line ->> 'inventory_item_id'), 0
  ))
  from jsonb_array_elements(canonical_lines) line
  order by line ->> 'inventory_item_id';

  insert into public.deliveries (
    id, organization_id, location_id, vendor_id, purchase_order_id,
    delivered_at, invoice_number, received_by, notes
  ) values (
    p_request_id, location_row.organization_id, location_row.id, vendor_row.id,
    order_row.id, p_delivered_at, clean_invoice, actor_id, clean_notes
  ) returning * into result;

  insert into public.delivery_lines (
    organization_id, delivery_id, inventory_item_id, unit_id,
    quantity, accepted_quantity, unit_price_cents, lot_code, expires_on
  )
  select location_row.organization_id, result.id,
    (line ->> 'inventory_item_id')::uuid,
    (line ->> 'unit_id')::uuid,
    (line ->> 'quantity')::numeric(16,4),
    (line ->> 'accepted_quantity')::numeric(16,4),
    (line ->> 'unit_price_cents')::bigint,
    nullif(btrim(line ->> 'lot_code'), ''),
    nullif(line ->> 'expires_on', '')::date
  from jsonb_array_elements(canonical_lines) line;

  insert into public.inventory_transactions (
    organization_id, location_id, inventory_item_id, unit_id,
    transaction_kind, quantity_delta, unit_cost_cents, occurred_at,
    reference_type, reference_id, reason, created_by, approved_by, approved_at
  )
  select result.organization_id, result.location_id, line.inventory_item_id,
    item.base_unit_id, 'purchase',
    private.inventory_base_quantity(
      result.organization_id, line.inventory_item_id, line.unit_id, line.accepted_quantity
    ),
    private.inventory_base_unit_cost(
      result.organization_id, line.inventory_item_id, line.unit_id, line.unit_price_cents
    ),
    result.delivered_at, 'delivery', result.id, 'Accepted inventory delivery',
    actor_id, actor_id, decision_at
  from public.delivery_lines line
  join public.inventory_items item
    on item.organization_id = line.organization_id
   and item.id = line.inventory_item_id
  where line.delivery_id = result.id
    and line.accepted_quantity > 0;

  insert into public.item_price_history (
    organization_id, inventory_item_id, vendor_id, unit_id,
    unit_price_cents, effective_at, source_type, source_id
  )
  select result.organization_id, line.inventory_item_id, result.vendor_id,
    line.unit_id, line.unit_price_cents, result.delivered_at, 'delivery', result.id
  from public.delivery_lines line
  where line.delivery_id = result.id
    and line.accepted_quantity > 0;

  if order_row.id is not null then
    update public.purchase_orders purchase_order
    set status = case
      when not exists (
        select 1
        from public.purchase_order_lines order_line
        where order_line.purchase_order_id = order_row.id
          and coalesce((
            select sum(delivery_line.accepted_quantity)
            from public.delivery_lines delivery_line
            join public.deliveries delivery on delivery.id = delivery_line.delivery_id
            where delivery.purchase_order_id = order_row.id
              and delivery_line.inventory_item_id = order_line.inventory_item_id
              and delivery_line.unit_id = order_line.unit_id
          ), 0) < order_line.quantity
      ) then 'received'
      else 'partially_received'
    end
    where purchase_order.id = order_row.id;
  end if;

  perform private.complete_operation_request(p_request_id);
  return result;
end
$$;

create function public.submit_waste_record(
  p_request_id uuid,
  p_location_id uuid,
  p_inventory_item_id uuid,
  p_unit_id uuid,
  p_quantity numeric,
  p_reason_code text,
  p_occurred_at timestamptz,
  p_notes text
)
returns public.waste_records
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  item_row public.inventory_items%rowtype;
  result public.waste_records%rowtype;
  clean_reason text := lower(nullif(btrim(p_reason_code), ''));
  clean_notes text := nullif(btrim(p_notes), '');
  base_quantity numeric;
  base_cost bigint;
  estimated_cost bigint;
  canonical_payload jsonb;
  claimed boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity >= 1000000000000
    or scale(p_quantity) > 4
    or clean_reason is null or clean_reason !~ '^[a-z][a-z0-9_]{0,63}$'
    or p_occurred_at is null
    or (clean_notes is not null and length(clean_notes) > 4000) then
    raise exception 'Invalid waste record payload' using errcode = '22023';
  end if;
  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_manage_location(location_row.organization_id, location_row.id) then
    raise exception 'Not authorized to record waste at this location'
      using errcode = '42501';
  end if;
  select * into item_row
  from public.inventory_items item
  where item.id = p_inventory_item_id
    and item.organization_id = location_row.organization_id
    and item.is_active
    and item.track_inventory;
  if item_row.id is null or not exists (
    select 1 from public.measurement_units unit
    where unit.id = p_unit_id and unit.organization_id = location_row.organization_id
  ) then
    raise exception 'The selected waste item or unit is unavailable'
      using errcode = '23514';
  end if;
  base_quantity := private.inventory_base_quantity(
    location_row.organization_id, item_row.id, p_unit_id, p_quantity
  );
  select coalesce(
    (
      select transaction.unit_cost_cents
      from public.inventory_transactions transaction
      where transaction.organization_id = location_row.organization_id
        and transaction.location_id = location_row.id
        and transaction.inventory_item_id = item_row.id
        and transaction.unit_id = item_row.base_unit_id
        and transaction.unit_cost_cents is not null
      order by transaction.occurred_at desc, transaction.id desc
      limit 1
    ),
    (
      select private.inventory_base_unit_cost(
        price.organization_id, price.inventory_item_id, price.unit_id, price.unit_price_cents
      )
      from public.item_price_history price
      where price.organization_id = location_row.organization_id
        and price.inventory_item_id = item_row.id
        and price.effective_at <= p_occurred_at
      order by price.effective_at desc, price.id desc
      limit 1
    )
  ) into base_cost;
  estimated_cost := case
    when base_cost is null then null
    else round(base_quantity * base_cost)::bigint
  end;
  canonical_payload := jsonb_build_object(
    'location_id', location_row.id,
    'inventory_item_id', item_row.id,
    'unit_id', p_unit_id,
    'quantity', p_quantity,
    'reason_code', clean_reason,
    'occurred_at', p_occurred_at,
    'notes', clean_notes
  );
  claimed := private.claim_operation_request(
    p_request_id, 'inventory.waste_submit', location_row.organization_id,
    location_row.id, p_request_id, canonical_payload
  );
  if not claimed then
    select * into result from public.waste_records waste where waste.id = p_request_id;
    if result.id is null then
      raise exception 'Waste replay has no matching result' using errcode = '40001';
    end if;
    return result;
  end if;

  insert into public.waste_records (
    id, organization_id, location_id, inventory_item_id, unit_id,
    quantity, reason_code, estimated_cost_cents, occurred_at,
    notes, recorded_by, status
  ) values (
    p_request_id, location_row.organization_id, location_row.id,
    item_row.id, p_unit_id, p_quantity, clean_reason, estimated_cost,
    p_occurred_at, clean_notes, actor_id, 'pending'
  ) returning * into result;
  perform private.complete_operation_request(p_request_id);
  return result;
end
$$;

create function public.review_waste_record(
  p_request_id uuid,
  p_waste_record_id uuid,
  p_approve boolean,
  p_note text
)
returns public.waste_records
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  result public.waste_records%rowtype;
  item_row public.inventory_items%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  requested_status public.review_status := case
    when p_approve then 'approved'::public.review_status
    else 'rejected'::public.review_status
  end;
  decision_at timestamptz := clock_timestamp();
  base_quantity numeric;
  base_cost bigint;
  canonical_payload jsonb;
  claimed boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_approve is null or (clean_note is not null and length(clean_note) > 2000) then
    raise exception 'A valid waste review decision is required' using errcode = '22023';
  end if;
  select * into result
  from public.waste_records waste
  where waste.id = p_waste_record_id
  for update;
  if result.id is null then
    raise exception 'Waste record not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(result.organization_id, result.location_id) then
    raise exception 'Not authorized to review this waste record' using errcode = '42501';
  end if;
  if result.recorded_by = actor_id then
    raise exception 'Waste records require a different authorized reviewer'
      using errcode = '42501';
  end if;
  canonical_payload := jsonb_build_object(
    'waste_record_id', result.id, 'approve', p_approve, 'note', clean_note
  );
  claimed := private.claim_operation_request(
    p_request_id, 'inventory.waste_review', result.organization_id,
    result.location_id, result.id, canonical_payload
  );
  if not claimed then
    if result.status = requested_status
      and result.approved_by = actor_id
      and result.review_note is not distinct from clean_note then
      return result;
    end if;
    raise exception 'Waste review replay has no matching result' using errcode = '40001';
  end if;
  if result.status <> 'pending' then
    raise exception 'Reviewed waste records are immutable' using errcode = '42501';
  end if;

  if p_approve then
    select * into item_row from public.inventory_items item
    where item.id = result.inventory_item_id;
    base_quantity := private.inventory_base_quantity(
      result.organization_id, result.inventory_item_id, result.unit_id, result.quantity
    );
    base_cost := case
      when result.estimated_cost_cents is null then null
      else round(result.estimated_cost_cents / base_quantity)::bigint
    end;
    perform pg_advisory_xact_lock(hashtextextended(
      'inventory-ledger:' || result.organization_id::text || ':'
        || result.location_id::text || ':' || result.inventory_item_id::text, 0
    ));
    insert into public.inventory_transactions (
      organization_id, location_id, inventory_item_id, unit_id,
      transaction_kind, quantity_delta, unit_cost_cents, occurred_at,
      reference_type, reference_id, reason, created_by, approved_by, approved_at
    ) values (
      result.organization_id, result.location_id, result.inventory_item_id,
      item_row.base_unit_id, 'waste', -base_quantity, base_cost,
      result.occurred_at, 'waste_record', result.id,
      'Approved waste record: ' || result.reason_code,
      result.recorded_by, actor_id, decision_at
    );
  end if;

  update public.waste_records waste
  set status = requested_status,
      approved_by = actor_id,
      approved_at = decision_at,
      review_note = clean_note
  where waste.id = result.id
  returning * into result;
  perform private.complete_operation_request(p_request_id);
  return result;
end
$$;

create function public.create_inventory_transfer(
  p_request_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_notes text,
  p_lines jsonb
)
returns public.inventory_transfers
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  source_row public.locations%rowtype;
  destination_row public.locations%rowtype;
  result public.inventory_transfers%rowtype;
  clean_notes text := nullif(btrim(p_notes), '');
  canonical_lines jsonb;
  canonical_payload jsonb;
  claimed boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_from_location_id = p_to_location_id
    or (clean_notes is not null and length(clean_notes) > 4000)
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'Invalid transfer payload' using errcode = '22023';
  end if;
  select * into source_row from public.locations location
  where location.id = p_from_location_id and location.is_active;
  if source_row.id is null
    or not public.can_manage_location(source_row.organization_id, source_row.id) then
    raise exception 'Not authorized to create a transfer from this location'
      using errcode = '42501';
  end if;
  select * into destination_row from public.locations location
  where location.id = p_to_location_id
    and location.organization_id = source_row.organization_id
    and location.is_active;
  if destination_row.id is null then
    raise exception 'The destination must be an active location in this organization'
      using errcode = '23514';
  end if;
  begin
    if exists (
      select 1 from jsonb_array_elements(p_lines) line
      where jsonb_typeof(line) <> 'object'
        or not (line ?& array['inventory_item_id', 'unit_id', 'sent_quantity'])
        or (line ->> 'sent_quantity')::numeric <= 0
        or (line ->> 'sent_quantity')::numeric >= 1000000000000
        or scale((line ->> 'sent_quantity')::numeric) > 4
    ) or (
      select count(*) <> count(distinct concat(line ->> 'inventory_item_id', ':', line ->> 'unit_id'))
      from jsonb_array_elements(p_lines) line
    ) then
      raise exception 'Invalid or duplicate transfer lines' using errcode = '22023';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'Invalid transfer line value' using errcode = '22023';
  end;
  if (
    select count(*)
    from jsonb_array_elements(p_lines) line
    join public.inventory_items item
      on item.id = (line ->> 'inventory_item_id')::uuid
     and item.organization_id = source_row.organization_id
     and item.is_active
     and item.track_inventory
    join public.measurement_units unit
      on unit.id = (line ->> 'unit_id')::uuid
     and unit.organization_id = source_row.organization_id
    where private.inventory_conversion_multiplier(
      source_row.organization_id, item.id, unit.id, item.base_unit_id
    ) > 0
  ) <> jsonb_array_length(p_lines) then
    raise exception 'Every transfer line must use an active tenant item and compatible unit'
      using errcode = '23514';
  end if;
  select jsonb_agg(jsonb_build_object(
      'inventory_item_id', (line ->> 'inventory_item_id')::uuid,
      'unit_id', (line ->> 'unit_id')::uuid,
      'sent_quantity', (line ->> 'sent_quantity')::numeric
    ) order by line ->> 'inventory_item_id', line ->> 'unit_id')
  into canonical_lines
  from jsonb_array_elements(p_lines) line;
  canonical_payload := jsonb_build_object(
    'from_location_id', source_row.id,
    'to_location_id', destination_row.id,
    'notes', clean_notes,
    'lines', canonical_lines
  );
  claimed := private.claim_operation_request(
    p_request_id, 'inventory.transfer_create', source_row.organization_id,
    source_row.id, p_request_id, canonical_payload
  );
  if not claimed then
    select * into result from public.inventory_transfers transfer
    where transfer.id = p_request_id;
    if result.id is null then
      raise exception 'Transfer replay has no matching result' using errcode = '40001';
    end if;
    return result;
  end if;
  insert into public.inventory_transfers (
    id, organization_id, from_location_id, to_location_id,
    status, created_by, notes
  ) values (
    p_request_id, source_row.organization_id, source_row.id,
    destination_row.id, 'draft', actor_id, clean_notes
  ) returning * into result;
  insert into public.inventory_transfer_lines (
    organization_id, transfer_id, inventory_item_id, unit_id, sent_quantity
  )
  select source_row.organization_id, result.id,
    (line ->> 'inventory_item_id')::uuid,
    (line ->> 'unit_id')::uuid,
    (line ->> 'sent_quantity')::numeric(16,4)
  from jsonb_array_elements(canonical_lines) line;
  perform private.complete_operation_request(p_request_id);
  return result;
end
$$;

create function public.review_inventory_transfer(
  p_request_id uuid,
  p_transfer_id uuid,
  p_approve boolean,
  p_note text,
  p_lines jsonb
)
returns public.inventory_transfers
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  result public.inventory_transfers%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  canonical_lines jsonb := '[]'::jsonb;
  canonical_payload jsonb;
  claimed boolean;
  decision_at timestamptz := clock_timestamp();
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_approve is null
    or (clean_note is not null and length(clean_note) > 2000)
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) > 500 then
    raise exception 'A valid transfer review decision is required' using errcode = '22023';
  end if;
  select * into result
  from public.inventory_transfers transfer
  where transfer.id = p_transfer_id
  for update;
  if result.id is null then
    raise exception 'Inventory transfer not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(result.organization_id, result.to_location_id) then
    raise exception 'Not authorized to review this transfer at its destination'
      using errcode = '42501';
  end if;
  if result.created_by = actor_id then
    raise exception 'Transfers require a different authorized destination reviewer'
      using errcode = '42501';
  end if;
  if p_approve then
    begin
      if jsonb_array_length(p_lines) = 0 or exists (
        select 1 from jsonb_array_elements(p_lines) line
        where jsonb_typeof(line) <> 'object'
          or not (line ?& array['inventory_item_id', 'unit_id', 'received_quantity'])
          or (line ->> 'received_quantity')::numeric < 0
          or (line ->> 'received_quantity')::numeric >= 1000000000000
          or scale((line ->> 'received_quantity')::numeric) > 4
      ) or (
        select count(*) <> count(distinct concat(line ->> 'inventory_item_id', ':', line ->> 'unit_id'))
        from jsonb_array_elements(p_lines) line
      ) then
        raise exception 'Invalid transfer receipt lines' using errcode = '22023';
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Invalid transfer receipt value' using errcode = '22023';
    end;
    if exists (
      select 1
      from public.inventory_transfer_lines transfer_line
      left join jsonb_array_elements(p_lines) line
        on (line ->> 'inventory_item_id')::uuid = transfer_line.inventory_item_id
       and (line ->> 'unit_id')::uuid = transfer_line.unit_id
      where transfer_line.transfer_id = result.id
        and (
          line is null
          or (line ->> 'received_quantity')::numeric > transfer_line.sent_quantity
        )
    ) or jsonb_array_length(p_lines) <> (
      select count(*) from public.inventory_transfer_lines transfer_line
      where transfer_line.transfer_id = result.id
    ) then
      raise exception 'Transfer receipt lines must match the submitted transfer'
        using errcode = '23514';
    end if;
    select jsonb_agg(jsonb_build_object(
        'inventory_item_id', (line ->> 'inventory_item_id')::uuid,
        'unit_id', (line ->> 'unit_id')::uuid,
        'received_quantity', (line ->> 'received_quantity')::numeric
      ) order by line ->> 'inventory_item_id', line ->> 'unit_id')
    into canonical_lines
    from jsonb_array_elements(p_lines) line;
  elsif jsonb_array_length(p_lines) <> 0 then
    raise exception 'Rejected transfers cannot include received quantities'
      using errcode = '22023';
  end if;
  canonical_payload := jsonb_build_object(
    'transfer_id', result.id,
    'approve', p_approve,
    'note', clean_note,
    'lines', canonical_lines
  );
  claimed := private.claim_operation_request(
    p_request_id, 'inventory.transfer_review', result.organization_id,
    result.to_location_id, result.id, canonical_payload
  );
  if not claimed then
    if result.status = (case when p_approve then 'received' else 'cancelled' end)
      and result.reviewed_by = actor_id
      and result.review_note is not distinct from clean_note then
      return result;
    end if;
    raise exception 'Transfer review replay has no matching result' using errcode = '40001';
  end if;
  if result.status <> 'draft' then
    raise exception 'Reviewed transfers are immutable' using errcode = '42501';
  end if;

  if p_approve then
    perform pg_advisory_xact_lock(hashtextextended(
      'inventory-ledger:' || result.organization_id::text || ':'
        || result.from_location_id::text || ':' || transfer_line.inventory_item_id::text, 0
    ))
    from public.inventory_transfer_lines transfer_line
    where transfer_line.transfer_id = result.id
    order by transfer_line.inventory_item_id;
    if exists (
      select 1
      from public.inventory_transfer_lines transfer_line
      where transfer_line.transfer_id = result.id
        and coalesce((
          select sum(transaction.quantity_delta)
          from public.inventory_transactions transaction
          where transaction.organization_id = result.organization_id
            and transaction.location_id = result.from_location_id
            and transaction.inventory_item_id = transfer_line.inventory_item_id
        ), 0) < private.inventory_base_quantity(
          result.organization_id, transfer_line.inventory_item_id,
          transfer_line.unit_id, transfer_line.sent_quantity
        )
    ) then
      raise exception 'The source location no longer has enough stock for this transfer'
        using errcode = '23514';
    end if;
    update public.inventory_transfer_lines transfer_line
    set received_quantity = (line ->> 'received_quantity')::numeric(16,4)
    from jsonb_array_elements(canonical_lines) line
    where transfer_line.transfer_id = result.id
      and transfer_line.inventory_item_id = (line ->> 'inventory_item_id')::uuid
      and transfer_line.unit_id = (line ->> 'unit_id')::uuid;

    insert into public.inventory_transactions (
      organization_id, location_id, inventory_item_id, unit_id,
      transaction_kind, quantity_delta, unit_cost_cents, occurred_at,
      reference_type, reference_id, reason, created_by, approved_by, approved_at
    )
    select result.organization_id, result.from_location_id,
      transfer_line.inventory_item_id, item.base_unit_id, 'transfer_out',
      -private.inventory_base_quantity(
        result.organization_id, transfer_line.inventory_item_id,
        transfer_line.unit_id, transfer_line.sent_quantity
      ),
      (
        select transaction.unit_cost_cents
        from public.inventory_transactions transaction
        where transaction.organization_id = result.organization_id
          and transaction.location_id = result.from_location_id
          and transaction.inventory_item_id = transfer_line.inventory_item_id
          and transaction.unit_id = item.base_unit_id
          and transaction.unit_cost_cents is not null
        order by transaction.occurred_at desc, transaction.id desc
        limit 1
      ),
      decision_at, 'inventory_transfer', result.id,
      'Approved inventory transfer out', result.created_by, actor_id, decision_at
    from public.inventory_transfer_lines transfer_line
    join public.inventory_items item
      on item.organization_id = transfer_line.organization_id
     and item.id = transfer_line.inventory_item_id
    where transfer_line.transfer_id = result.id;

    insert into public.inventory_transactions (
      organization_id, location_id, inventory_item_id, unit_id,
      transaction_kind, quantity_delta, unit_cost_cents, occurred_at,
      reference_type, reference_id, reason, created_by, approved_by, approved_at
    )
    select result.organization_id, result.to_location_id,
      transfer_line.inventory_item_id, item.base_unit_id, 'transfer_in',
      private.inventory_base_quantity(
        result.organization_id, transfer_line.inventory_item_id,
        transfer_line.unit_id, transfer_line.received_quantity
      ),
      (
        select transaction.unit_cost_cents
        from public.inventory_transactions transaction
        where transaction.organization_id = result.organization_id
          and transaction.location_id = result.from_location_id
          and transaction.inventory_item_id = transfer_line.inventory_item_id
          and transaction.unit_id = item.base_unit_id
          and transaction.unit_cost_cents is not null
        order by transaction.occurred_at desc, transaction.id desc
        limit 1
      ),
      decision_at, 'inventory_transfer', result.id,
      'Approved inventory transfer in', result.created_by, actor_id, decision_at
    from public.inventory_transfer_lines transfer_line
    join public.inventory_items item
      on item.organization_id = transfer_line.organization_id
     and item.id = transfer_line.inventory_item_id
    where transfer_line.transfer_id = result.id
      and transfer_line.received_quantity > 0;
  end if;

  update public.inventory_transfers transfer
  set status = case when p_approve then 'received' else 'cancelled' end,
      sent_at = case when p_approve then decision_at else null end,
      received_at = case when p_approve then decision_at else null end,
      received_by = case when p_approve then actor_id else null end,
      reviewed_by = actor_id,
      reviewed_at = decision_at,
      review_note = clean_note,
      updated_at = decision_at
  where transfer.id = result.id
  returning * into result;
  perform private.complete_operation_request(p_request_id);
  return result;
end
$$;

revoke insert, update, delete on public.purchase_orders from authenticated;
revoke insert, update, delete on public.purchase_order_lines from authenticated;
revoke insert, update, delete on public.deliveries from authenticated;
revoke insert, update, delete on public.delivery_lines from authenticated;
revoke insert, update, delete on public.waste_records from authenticated;
revoke insert, update, delete on public.inventory_transfers from authenticated;
revoke insert, update, delete on public.inventory_transfer_lines from authenticated;

revoke all on function public.create_purchase_order(uuid, uuid, uuid, text, date, date, bigint, bigint, text, jsonb)
from public;
revoke all on function public.receive_inventory_delivery(uuid, uuid, uuid, uuid, timestamptz, text, text, jsonb)
from public;
revoke all on function public.submit_waste_record(uuid, uuid, uuid, uuid, numeric, text, timestamptz, text)
from public;
revoke all on function public.review_waste_record(uuid, uuid, boolean, text)
from public;
revoke all on function public.create_inventory_transfer(uuid, uuid, uuid, text, jsonb)
from public;
revoke all on function public.review_inventory_transfer(uuid, uuid, boolean, text, jsonb)
from public;

grant execute on function public.create_purchase_order(uuid, uuid, uuid, text, date, date, bigint, bigint, text, jsonb)
to authenticated;
grant execute on function public.receive_inventory_delivery(uuid, uuid, uuid, uuid, timestamptz, text, text, jsonb)
to authenticated;
grant execute on function public.submit_waste_record(uuid, uuid, uuid, uuid, numeric, text, timestamptz, text)
to authenticated;
grant execute on function public.review_waste_record(uuid, uuid, boolean, text)
to authenticated;
grant execute on function public.create_inventory_transfer(uuid, uuid, uuid, text, jsonb)
to authenticated;
grant execute on function public.review_inventory_transfer(uuid, uuid, boolean, text, jsonb)
to authenticated;

comment on function public.create_purchase_order(uuid, uuid, uuid, text, date, date, bigint, bigint, text, jsonb)
is 'Idempotently creates a tenant-scoped purchase order with server-derived subtotal and actor evidence.';
comment on function public.receive_inventory_delivery(uuid, uuid, uuid, uuid, timestamptz, text, text, jsonb)
is 'Atomically receives a delivery, posts canonical base-unit inventory, records vendor pricing, and advances its purchase order.';
comment on function public.submit_waste_record(uuid, uuid, uuid, uuid, numeric, text, timestamptz, text)
is 'Submits observed waste with server-derived cost evidence and no immediate stock mutation.';
comment on function public.review_waste_record(uuid, uuid, boolean, text)
is 'Independently approves or rejects waste and posts an approved base-unit stock decrement exactly once.';
comment on function public.create_inventory_transfer(uuid, uuid, uuid, text, jsonb)
is 'Idempotently submits an inventory transfer from an authorized source location for destination review.';
comment on function public.review_inventory_transfer(uuid, uuid, boolean, text, jsonb)
is 'Independently accepts or rejects a transfer at its destination and posts paired base-unit ledger evidence exactly once.';
