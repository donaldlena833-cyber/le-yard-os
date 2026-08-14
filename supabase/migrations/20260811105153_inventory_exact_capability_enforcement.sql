-- Enforce the configured location capability at both the browser command
-- boundary and the actor-derived database RPC boundary. Owners and Admins
-- retain full coverage through public.has_capability; grants and denials for
-- Managers and Employees remain location-local and effective-dated.

create or replace function public.submit_inventory_count(
  p_submission_id uuid,
  p_location_id uuid,
  p_count_type text,
  p_notes text,
  p_lines jsonb
)
returns public.inventory_counts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  result public.inventory_counts%rowtype;
  existing_lines jsonb;
  requested_lines jsonb;
  clean_notes text := nullif(btrim(p_notes), '');
  requested_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_count_type not in ('full', 'cycle', 'spot')
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 1000
    or (clean_notes is not null and length(clean_notes) > 4000) then
    raise exception 'Invalid inventory count payload' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) line
    where jsonb_typeof(line) <> 'object'
      or not (line ?& array['inventory_item_id', 'unit_id', 'counted_quantity'])
      or (line ->> 'inventory_item_id') is null
      or (line ->> 'unit_id') is null
      or (line ->> 'counted_quantity') is null
      or (line ->> 'counted_quantity')::numeric < 0
      or length(coalesce(line ->> 'notes', '')) > 2000
  ) or (
    select count(*) <> count(distinct line ->> 'inventory_item_id')
    from jsonb_array_elements(p_lines) line
  ) then
    raise exception 'Invalid or duplicate inventory count lines' using errcode = '22023';
  end if;

  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active
  for update;
  if location_row.id is null
    or not public.has_capability(
      location_row.organization_id, location_row.id, 'inventory.count.create'
    ) then
    raise exception 'Not authorized to submit this inventory count'
      using errcode = '42501';
  end if;

  select count(*)::integer into requested_count
  from jsonb_array_elements(p_lines) line
  join public.inventory_items item
    on item.organization_id = location_row.organization_id
   and item.id = (line ->> 'inventory_item_id')::uuid
   and item.base_unit_id = (line ->> 'unit_id')::uuid
   and item.is_active
   and item.track_inventory;
  if requested_count <> jsonb_array_length(p_lines) then
    raise exception 'Every count line must use an active item base unit'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-count-submit:' || p_submission_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-ledger:' || location_row.organization_id::text || ':'
      || location_row.id::text || ':' || item.id::text,
    0
  ))
  from public.inventory_items item
  where item.organization_id = location_row.organization_id
    and item.id in (
      select (line ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(p_lines) line
    )
  order by item.id;
  perform 1
  from public.inventory_items item
  where item.organization_id = location_row.organization_id
    and item.id in (
      select (line ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(p_lines) line
    )
  order by item.id
  for update;

  select jsonb_agg(
    jsonb_build_object(
      'inventory_item_id', item.id::text,
      'unit_id', item.base_unit_id::text,
      'counted_quantity', (line ->> 'counted_quantity')::numeric,
      'notes', nullif(btrim(line ->> 'notes'), '')
    ) order by item.id
  ) into requested_lines
  from jsonb_array_elements(p_lines) line
  join public.inventory_items item
    on item.organization_id = location_row.organization_id
   and item.id = (line ->> 'inventory_item_id')::uuid;

  select * into result
  from public.inventory_counts count_row
  where count_row.id = p_submission_id
  for update;
  if result.id is not null then
    select jsonb_agg(
      jsonb_build_object(
        'inventory_item_id', count_line.inventory_item_id::text,
        'unit_id', count_line.unit_id::text,
        'counted_quantity', count_line.counted_quantity,
        'notes', count_line.notes
      ) order by count_line.inventory_item_id
    ) into existing_lines
    from public.inventory_count_lines count_line
    where count_line.inventory_count_id = result.id;
    if result.organization_id = location_row.organization_id
      and result.location_id = location_row.id
      and result.count_type = p_count_type
      and result.counted_by = actor_id
      and result.notes is not distinct from clean_notes
      and existing_lines = requested_lines then
      return result;
    end if;
    raise exception 'Inventory submission id was reused' using errcode = '23505';
  end if;

  insert into public.inventory_counts (
    id, organization_id, location_id, counted_at,
    status, count_type, counted_by, notes
  ) values (
    p_submission_id, location_row.organization_id, location_row.id,
    clock_timestamp(), 'pending', p_count_type, actor_id, clean_notes
  ) returning * into result;

  insert into public.inventory_count_lines (
    organization_id,
    inventory_count_id,
    inventory_item_id,
    unit_id,
    expected_quantity,
    counted_quantity,
    unit_cost_cents,
    notes
  )
  select location_row.organization_id,
    result.id,
    item.id,
    item.base_unit_id,
    coalesce((
      select sum(transaction.quantity_delta)
      from public.inventory_transactions transaction
      where transaction.organization_id = location_row.organization_id
        and transaction.location_id = location_row.id
        and transaction.inventory_item_id = item.id
    ), 0)::numeric(18,6),
    (line ->> 'counted_quantity')::numeric(18,6),
    coalesce(
      (
        select transaction.unit_cost_cents
        from public.inventory_transactions transaction
        where transaction.organization_id = location_row.organization_id
          and transaction.location_id = location_row.id
          and transaction.inventory_item_id = item.id
          and transaction.unit_id = item.base_unit_id
          and transaction.unit_cost_cents is not null
        order by transaction.occurred_at desc, transaction.id desc
        limit 1
      ),
      (
        select price.unit_price_cents
        from public.item_price_history price
        where price.organization_id = location_row.organization_id
          and price.inventory_item_id = item.id
          and price.unit_id = item.base_unit_id
          and price.effective_at <= clock_timestamp()
        order by price.effective_at desc, price.id desc
        limit 1
      )
    ),
    nullif(btrim(line ->> 'notes'), '')
  from jsonb_array_elements(p_lines) line
  join public.inventory_items item
    on item.organization_id = location_row.organization_id
   and item.id = (line ->> 'inventory_item_id')::uuid;
  return result;
end
$$;

create or replace function public.approve_inventory_count(
  p_request_id uuid,
  p_count_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.inventory_counts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  count_row public.inventory_counts%rowtype;
  prior private.inventory_count_approval_requests%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  requested_status public.review_status := case
    when p_approve then 'approved'::public.review_status
    else 'rejected'::public.review_status
  end;
  decision_at timestamptz := clock_timestamp();
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_approve is null or (clean_note is not null and length(clean_note) > 2000) then
    raise exception 'A valid inventory count decision is required'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-count-approval:' || p_request_id::text,
    0
  ));

  select * into count_row
  from public.inventory_counts count_candidate
  where count_candidate.id = p_count_id
    and public.has_capability(
      count_candidate.organization_id,
      count_candidate.location_id,
      'inventory.count.approve'
    )
  for update;
  if count_row.id is null then
    raise exception 'Not authorized to review this inventory count'
      using errcode = '42501';
  end if;
  if count_row.counted_by = actor_id then
    raise exception 'Inventory counts require a different authorized reviewer'
      using errcode = '42501';
  end if;

  select * into prior
  from private.inventory_count_approval_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null and (
    prior.actor_id is distinct from actor_id
    or prior.inventory_count_id is distinct from p_count_id
    or prior.approve is distinct from p_approve
    or prior.review_note is distinct from clean_note
  ) then
    raise exception 'Inventory approval request id was reused' using errcode = '23505';
  end if;

  if prior.request_id is not null then
    if count_row.status = requested_status
      and count_row.approved_by = actor_id
      and count_row.review_note is not distinct from clean_note then
      return count_row;
    end if;
    raise exception 'Inventory approval ledger has no matching result'
      using errcode = '40001';
  end if;
  if count_row.status <> 'pending' then
    raise exception 'Reviewed inventory counts are immutable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.inventory_count_lines line
    where line.inventory_count_id = count_row.id
  ) or exists (
    select 1
    from public.inventory_count_lines line
    join public.inventory_items item
      on item.organization_id = line.organization_id
     and item.id = line.inventory_item_id
    where line.inventory_count_id = count_row.id
      and (
        line.organization_id <> count_row.organization_id
        or line.unit_id <> item.base_unit_id
        or line.expected_quantity is null
        or line.counted_quantity < 0
      )
  ) then
    raise exception 'Inventory count lines are incomplete or noncanonical'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-ledger:' || count_row.organization_id::text || ':'
      || count_row.location_id::text || ':' || line.inventory_item_id::text,
    0
  ))
  from public.inventory_count_lines line
  where line.inventory_count_id = count_row.id
  order by line.inventory_item_id;
  perform 1
  from public.inventory_count_lines line
  where line.inventory_count_id = count_row.id
  order by line.inventory_item_id
  for update;
  perform 1
  from public.inventory_items item
  where item.organization_id = count_row.organization_id
    and item.id in (
      select line.inventory_item_id
      from public.inventory_count_lines line
      where line.inventory_count_id = count_row.id
    )
  order by item.id
  for update;

  if exists (
    select 1
    from public.inventory_transactions transaction
    where transaction.organization_id = count_row.organization_id
      and transaction.reference_type = 'inventory_count'
      and transaction.reference_id = count_row.id
  ) then
    raise exception 'Inventory count already has ledger postings without matching approval evidence'
      using errcode = '40001';
  end if;

  insert into private.inventory_count_approval_requests (
    request_id, organization_id, location_id, inventory_count_id,
    actor_id, approve, review_note
  ) values (
    p_request_id, count_row.organization_id, count_row.location_id,
    count_row.id, actor_id, p_approve, clean_note
  );

  if p_approve then
    insert into public.inventory_transactions (
      organization_id,
      location_id,
      inventory_item_id,
      unit_id,
      transaction_kind,
      quantity_delta,
      unit_cost_cents,
      occurred_at,
      reference_type,
      reference_id,
      reason,
      created_by,
      approved_by,
      approved_at
    )
    select count_row.organization_id,
      count_row.location_id,
      line.inventory_item_id,
      line.unit_id,
      'count_adjustment',
      line.counted_quantity - line.expected_quantity,
      line.unit_cost_cents,
      decision_at,
      'inventory_count',
      count_row.id,
      'Approved inventory count adjustment',
      count_row.counted_by,
      actor_id,
      decision_at
    from public.inventory_count_lines line
    where line.inventory_count_id = count_row.id
      and line.counted_quantity <> line.expected_quantity;
  end if;

  update public.inventory_counts count_update
  set status = requested_status,
      approved_by = actor_id,
      approved_at = decision_at,
      review_note = clean_note,
      updated_at = decision_at
  where count_update.id = count_row.id
  returning * into count_row;
  update private.inventory_count_approval_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return count_row;
end
$$;

create or replace function public.create_purchase_order(
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
    or not public.has_capability(
      location_row.organization_id, location_row.id, 'inventory.purchase.create'
    ) then
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


create or replace function public.receive_inventory_delivery(
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
    or not public.has_capability(
      location_row.organization_id, location_row.id, 'inventory.receive'
    ) then
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

create or replace function public.submit_waste_record(
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
    or not public.has_capability(
      location_row.organization_id, location_row.id, 'inventory.waste.create'
    ) then
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

create or replace function public.review_waste_record(
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
    and public.has_capability(
      waste.organization_id,
      waste.location_id,
      'inventory.waste.approve'
    )
  for update;
  if result.id is null then
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

create or replace function public.create_inventory_transfer(
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
    or not public.has_capability(
      source_row.organization_id, source_row.id, 'inventory.transfer.create'
    ) then
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

create or replace function public.review_inventory_transfer(
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
    and public.has_capability(
      transfer.organization_id,
      transfer.to_location_id,
      'inventory.transfer.approve'
    )
  for update;
  if result.id is null then
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
-- PostgreSQL combines permissive policies with OR. Remove the legacy
-- role-based SELECT routes so an explicit capability denial remains
-- authoritative for each operational record and its line/ledger evidence.

-- These legacy FOR ALL policies also authorize SELECT. Authenticated direct
-- DML is already revoked on every table below; supported mutations run through
-- the actor-derived RPCs redefined above.
drop policy if exists count_line_write on public.inventory_count_lines;
drop policy if exists po_line_write on public.purchase_order_lines;
drop policy if exists delivery_line_write on public.delivery_lines;
drop policy if exists transfer_write on public.inventory_transfers;
drop policy if exists transfer_line_write on public.inventory_transfer_lines;

drop policy if exists manager_location_read on public.inventory_counts;
drop policy if exists capability_count_read on public.inventory_counts;
drop policy if exists service_day_inventory_count_read on public.inventory_counts;
create policy inventory_count_capability_read
on public.inventory_counts
for select
to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array['inventory.count.create', 'inventory.count.approve']
  )
);

drop policy if exists count_line_read on public.inventory_count_lines;
drop policy if exists capability_count_line_read on public.inventory_count_lines;
create policy inventory_count_line_capability_read
on public.inventory_count_lines
for select
to authenticated
using (
  exists (
    select 1
    from public.inventory_counts inventory_count
    where inventory_count.id = inventory_count_lines.inventory_count_id
      and inventory_count.organization_id = inventory_count_lines.organization_id
      and public.has_any_capability(
        inventory_count.organization_id,
        inventory_count.location_id,
        array['inventory.count.create', 'inventory.count.approve']
      )
  )
);

drop policy if exists manager_location_read on public.purchase_orders;
drop policy if exists capability_purchase_order_read on public.purchase_orders;
create policy purchase_order_capability_read
on public.purchase_orders
for select
to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array[
      'inventory.purchase.create',
      'inventory.purchase.approve',
      'inventory.receive'
    ]
  )
);

drop policy if exists po_line_read on public.purchase_order_lines;
drop policy if exists capability_po_line_read on public.purchase_order_lines;
create policy purchase_order_line_capability_read
on public.purchase_order_lines
for select
to authenticated
using (
  exists (
    select 1
    from public.purchase_orders purchase_order
    where purchase_order.id = purchase_order_lines.purchase_order_id
      and purchase_order.organization_id = purchase_order_lines.organization_id
      and public.has_any_capability(
        purchase_order.organization_id,
        purchase_order.location_id,
        array[
          'inventory.purchase.create',
          'inventory.purchase.approve',
          'inventory.receive'
        ]
      )
  )
);

drop policy if exists manager_location_read on public.deliveries;
drop policy if exists capability_delivery_read on public.deliveries;
create policy delivery_capability_read
on public.deliveries
for select
to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array[
      'inventory.receive',
      'inventory.purchase.create',
      'inventory.purchase.approve'
    ]
  )
);

drop policy if exists delivery_line_read on public.delivery_lines;
drop policy if exists capability_delivery_line_read on public.delivery_lines;
create policy delivery_line_capability_read
on public.delivery_lines
for select
to authenticated
using (
  exists (
    select 1
    from public.deliveries delivery
    where delivery.id = delivery_lines.delivery_id
      and delivery.organization_id = delivery_lines.organization_id
      and public.has_any_capability(
        delivery.organization_id,
        delivery.location_id,
        array[
          'inventory.receive',
          'inventory.purchase.create',
          'inventory.purchase.approve'
        ]
      )
  )
);

drop policy if exists manager_location_read on public.waste_records;
drop policy if exists capability_waste_read on public.waste_records;
create policy waste_record_capability_read
on public.waste_records
for select
to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array[
      'inventory.waste.create',
      'inventory.waste.approve',
      'reports.operational.view'
    ]
  )
);

drop policy if exists transfer_read on public.inventory_transfers;
drop policy if exists capability_transfer_read on public.inventory_transfers;
create policy inventory_transfer_capability_read
on public.inventory_transfers
for select
to authenticated
using (
  public.has_capability(
    organization_id,
    from_location_id,
    'inventory.transfer.create'
  )
  or public.has_capability(
    organization_id,
    to_location_id,
    'inventory.transfer.approve'
  )
);

drop policy if exists transfer_line_read on public.inventory_transfer_lines;
drop policy if exists capability_transfer_line_read on public.inventory_transfer_lines;
create policy inventory_transfer_line_capability_read
on public.inventory_transfer_lines
for select
to authenticated
using (
  exists (
    select 1
    from public.inventory_transfers transfer
    where transfer.id = inventory_transfer_lines.transfer_id
      and transfer.organization_id = inventory_transfer_lines.organization_id
      and (
        public.has_capability(
          transfer.organization_id,
          transfer.from_location_id,
          'inventory.transfer.create'
        )
        or public.has_capability(
          transfer.organization_id,
          transfer.to_location_id,
          'inventory.transfer.approve'
        )
      )
  )
);

drop policy if exists manager_location_read on public.inventory_transactions;
drop policy if exists capability_transaction_read on public.inventory_transactions;
create policy inventory_transaction_capability_read
on public.inventory_transactions
for select
to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array[
      'inventory.count.create',
      'inventory.count.approve',
      'inventory.waste.create',
      'inventory.waste.approve',
      'inventory.transfer.create',
      'inventory.transfer.approve',
      'inventory.purchase.create',
      'inventory.purchase.approve',
      'inventory.receive',
      'reports.operational.view',
      'reports.financial.view'
    ]
  )
);

revoke all on function public.submit_inventory_count(uuid, uuid, text, text, jsonb)
from public, anon, authenticated;
revoke all on function public.approve_inventory_count(uuid, uuid, boolean, text)
from public, anon, authenticated;
revoke all on function public.create_purchase_order(
  uuid, uuid, uuid, text, date, date, bigint, bigint, text, jsonb
) from public, anon, authenticated;
revoke all on function public.receive_inventory_delivery(
  uuid, uuid, uuid, uuid, timestamptz, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.submit_waste_record(
  uuid, uuid, uuid, uuid, numeric, text, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.review_waste_record(uuid, uuid, boolean, text)
from public, anon, authenticated;
revoke all on function public.create_inventory_transfer(uuid, uuid, uuid, text, jsonb)
from public, anon, authenticated;
revoke all on function public.review_inventory_transfer(uuid, uuid, boolean, text, jsonb)
from public, anon, authenticated;

grant execute on function public.submit_inventory_count(uuid, uuid, text, text, jsonb)
to authenticated;
grant execute on function public.approve_inventory_count(uuid, uuid, boolean, text)
to authenticated;
grant execute on function public.create_purchase_order(
  uuid, uuid, uuid, text, date, date, bigint, bigint, text, jsonb
) to authenticated;
grant execute on function public.receive_inventory_delivery(
  uuid, uuid, uuid, uuid, timestamptz, text, text, jsonb
) to authenticated;
grant execute on function public.submit_waste_record(
  uuid, uuid, uuid, uuid, numeric, text, timestamptz, text
) to authenticated;
grant execute on function public.review_waste_record(uuid, uuid, boolean, text)
to authenticated;
grant execute on function public.create_inventory_transfer(uuid, uuid, uuid, text, jsonb)
to authenticated;
grant execute on function public.review_inventory_transfer(uuid, uuid, boolean, text, jsonb)
to authenticated;

comment on function public.submit_inventory_count(uuid, uuid, text, text, jsonb) is
  'Submits an authoritative count for an actor with inventory.count.create at the exact location.';
comment on function public.approve_inventory_count(uuid, uuid, boolean, text) is
  'Independently reviews a count for an actor with inventory.count.approve at the exact location.';
comment on function public.create_purchase_order(uuid, uuid, uuid, text, date, date, bigint, bigint, text, jsonb) is
  'Creates a purchase order for an actor with inventory.purchase.create at the exact location.';
comment on function public.receive_inventory_delivery(uuid, uuid, uuid, uuid, timestamptz, text, text, jsonb) is
  'Receives inventory for an actor with inventory.receive at the exact location.';
comment on function public.submit_waste_record(uuid, uuid, uuid, uuid, numeric, text, timestamptz, text) is
  'Submits waste for an actor with inventory.waste.create at the exact location.';
comment on function public.review_waste_record(uuid, uuid, boolean, text) is
  'Independently reviews waste for an actor with inventory.waste.approve at the exact location.';
comment on function public.create_inventory_transfer(uuid, uuid, uuid, text, jsonb) is
  'Creates a transfer for an actor with inventory.transfer.create at the source location.';
comment on function public.review_inventory_transfer(uuid, uuid, boolean, text, jsonb) is
  'Independently reviews a transfer for an actor with inventory.transfer.approve at the destination location.';
