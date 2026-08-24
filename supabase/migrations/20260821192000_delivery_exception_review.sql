-- Preserve receiving discrepancies as structured evidence. Normal accepted
-- lines post immediately; exception lines post zero until a different
-- authorized receiver approves a linked corrective delivery.

create table public.delivery_receiving_batches (
  delivery_id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null check (status in ('posted', 'pending_review', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text,
  corrective_delivery_id uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, delivery_id) references public.deliveries(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, corrective_delivery_id) references public.deliveries(organization_id, id) on delete restrict,
  check ((reviewed_by is null and reviewed_at is null) or (reviewed_by is not null and reviewed_at is not null))
);

create table public.delivery_receiving_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  delivery_id uuid not null,
  inventory_item_id uuid not null,
  unit_id uuid not null,
  exception_kind text not null check (exception_kind in ('damaged', 'rejected', 'substituted', 'missing', 'unexpected', 'short', 'over')),
  proposed_accepted_quantity numeric(16,4) not null check (proposed_accepted_quantity >= 0),
  note text not null check (length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (organization_id, delivery_id) references public.deliveries(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete restrict,
  foreign key (organization_id, unit_id) references public.measurement_units(organization_id, id) on delete restrict,
  unique (delivery_id, inventory_item_id, unit_id)
);

alter table public.delivery_receiving_batches enable row level security;
alter table public.delivery_receiving_batches force row level security;
alter table public.delivery_receiving_exceptions enable row level security;
alter table public.delivery_receiving_exceptions force row level security;
create policy delivery_receiving_batches_read on public.delivery_receiving_batches
for select to authenticated using (
  public.can_access_location(organization_id, location_id)
  and public.has_capability(organization_id, location_id, 'inventory.receive')
);
create policy delivery_receiving_exceptions_read on public.delivery_receiving_exceptions
for select to authenticated using (
  public.can_access_location(organization_id, location_id)
  and public.has_capability(organization_id, location_id, 'inventory.receive')
);
grant select on public.delivery_receiving_batches, public.delivery_receiving_exceptions to authenticated;
create trigger delivery_receiving_batches_audit after insert or update or delete
on public.delivery_receiving_batches for each row execute function public.capture_audit_event();
create trigger delivery_receiving_exceptions_audit after insert or update or delete
on public.delivery_receiving_exceptions for each row execute function public.capture_audit_event();

create function public.receive_inventory_delivery_with_exceptions(
  p_request_id uuid, p_location_id uuid, p_vendor_id uuid,
  p_purchase_order_id uuid, p_delivered_at timestamptz,
  p_invoice_number text, p_notes text, p_lines jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  delivery public.deliveries%rowtype;
  existing public.delivery_receiving_batches%rowtype;
  canonical_payload jsonb;
  posting_lines jsonb;
  exception_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500
    or exists (
      select 1 from jsonb_array_elements(p_lines) line
      where coalesce(line ->> 'exception_kind', 'none') not in
        ('none', 'damaged', 'rejected', 'substituted', 'missing', 'unexpected', 'short', 'over')
        or (coalesce(line ->> 'exception_kind', 'none') <> 'none'
          and length(btrim(coalesce(line ->> 'exception_note', ''))) not between 1 and 2000)
    ) then
    raise exception 'Every receiving exception requires a valid type and note' using errcode = '22023';
  end if;
  select jsonb_agg(
    jsonb_build_object(
      'inventory_item_id', line ->> 'inventory_item_id',
      'unit_id', line ->> 'unit_id',
      'quantity', line ->> 'quantity',
      'accepted_quantity', line ->> 'accepted_quantity',
      'unit_price_cents', line ->> 'unit_price_cents',
      'lot_code', nullif(btrim(line ->> 'lot_code'), ''),
      'expires_on', nullif(line ->> 'expires_on', ''),
      'exception_kind', coalesce(line ->> 'exception_kind', 'none'),
      'exception_note', nullif(btrim(line ->> 'exception_note'), '')
    ) order by line ->> 'inventory_item_id', line ->> 'unit_id'
  ) into canonical_payload from jsonb_array_elements(p_lines) line;
  canonical_payload := jsonb_build_object(
    'locationId', p_location_id, 'vendorId', p_vendor_id,
    'purchaseOrderId', p_purchase_order_id, 'deliveredAt', p_delivered_at,
    'invoiceNumber', nullif(btrim(p_invoice_number), ''),
    'notes', nullif(btrim(p_notes), ''), 'lines', canonical_payload
  );
  select * into existing from public.delivery_receiving_batches batch
  where batch.delivery_id = p_request_id;
  if existing.delivery_id is not null then
    if not public.has_capability(existing.organization_id, existing.location_id, 'inventory.receive') then
      raise exception 'Not authorized to receive this delivery' using errcode = '42501';
    end if;
    if existing.payload is distinct from canonical_payload then
      raise exception 'Delivery request id was reused with different exception evidence' using errcode = '23505';
    end if;
    return jsonb_build_object('id', existing.delivery_id, 'status', existing.status,
      'exceptionCount', (select count(*) from public.delivery_receiving_exceptions exception where exception.delivery_id = existing.delivery_id));
  end if;

  select count(*)::integer into exception_count
  from jsonb_array_elements(p_lines) line
  where coalesce(line ->> 'exception_kind', 'none') <> 'none';
  select jsonb_agg(
    (line - 'exception_kind' - 'exception_note') ||
    jsonb_build_object('accepted_quantity', case
      when coalesce(line ->> 'exception_kind', 'none') = 'none'
        then line -> 'accepted_quantity'
      else to_jsonb(0)
    end)
    order by line ->> 'inventory_item_id', line ->> 'unit_id'
  ) into posting_lines from jsonb_array_elements(p_lines) line;

  delivery := public.receive_inventory_delivery(
    p_request_id, p_location_id, p_vendor_id, p_purchase_order_id,
    p_delivered_at, p_invoice_number, p_notes, posting_lines
  );
  insert into public.delivery_receiving_batches (
    delivery_id, organization_id, location_id, payload, status
  ) values (
    delivery.id, delivery.organization_id, delivery.location_id,
    canonical_payload, case when exception_count > 0 then 'pending_review' else 'posted' end
  );
  insert into public.delivery_receiving_exceptions (
    organization_id, location_id, delivery_id, inventory_item_id, unit_id,
    exception_kind, proposed_accepted_quantity, note
  )
  select delivery.organization_id, delivery.location_id, delivery.id,
    (line ->> 'inventory_item_id')::uuid, (line ->> 'unit_id')::uuid,
    line ->> 'exception_kind', (line ->> 'accepted_quantity')::numeric,
    btrim(line ->> 'exception_note')
  from jsonb_array_elements(p_lines) line
  where coalesce(line ->> 'exception_kind', 'none') <> 'none';
  return jsonb_build_object('id', delivery.id,
    'status', case when exception_count > 0 then 'pending_review' else 'posted' end,
    'exceptionCount', exception_count);
end
$$;

create function public.review_delivery_receiving_exceptions(
  p_request_id uuid, p_posting_request_id uuid, p_delivery_id uuid,
  p_approve boolean, p_note text
)
returns public.delivery_receiving_batches
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  batch public.delivery_receiving_batches%rowtype;
  delivery public.deliveries%rowtype;
  corrective public.deliveries%rowtype;
  claimed boolean;
  posting_lines jsonb;
  clean_note text := nullif(btrim(p_note), '');
  target_status text := case when p_approve then 'approved' else 'rejected' end;
begin
  if actor_id is null or p_request_id is null or p_posting_request_id is null
    or p_delivery_id is null or p_approve is null
    or length(coalesce(clean_note, '')) > 2000 then
    raise exception 'Valid delivery exception review evidence is required' using errcode = '22023';
  end if;
  select candidate.* into batch
  from public.delivery_receiving_batches candidate
  where candidate.delivery_id = p_delivery_id
    and public.has_capability(candidate.organization_id, candidate.location_id, 'inventory.receive')
  for update;
  if batch.delivery_id is null then
    raise exception 'Not authorized to review this delivery' using errcode = '42501';
  end if;
  select * into delivery from public.deliveries source
  where source.id = batch.delivery_id;
  if delivery.received_by = actor_id then
    raise exception 'A different authorized receiver must review exceptions' using errcode = '42501';
  end if;
  claimed := private.claim_operation_request(
    p_request_id, 'inventory.delivery_exception_review', batch.organization_id,
    batch.location_id, batch.delivery_id,
    jsonb_build_object('deliveryId', batch.delivery_id, 'approve', p_approve,
      'note', clean_note, 'postingRequestId', p_posting_request_id)
  );
  if not claimed then
    if batch.status = target_status and batch.reviewed_by = actor_id
      and batch.review_note is not distinct from clean_note then return batch; end if;
    raise exception 'Delivery exception review replay is unavailable' using errcode = '40001';
  end if;
  if batch.status <> 'pending_review' then
    raise exception 'Delivery exceptions have already been reviewed' using errcode = '23514';
  end if;
  if p_approve then
    select jsonb_agg(jsonb_build_object(
      'inventory_item_id', exception.inventory_item_id,
      'unit_id', exception.unit_id,
      'quantity', exception.proposed_accepted_quantity,
      'accepted_quantity', exception.proposed_accepted_quantity,
      'unit_price_cents', (source_line ->> 'unit_price_cents')::bigint,
      'lot_code', source_line ->> 'lot_code',
      'expires_on', source_line ->> 'expires_on'
    ) order by exception.inventory_item_id, exception.unit_id)
    into posting_lines
    from public.delivery_receiving_exceptions exception
    join lateral (
      select line
      from jsonb_array_elements(batch.payload -> 'lines') line
      where (line ->> 'inventory_item_id')::uuid = exception.inventory_item_id
        and (line ->> 'unit_id')::uuid = exception.unit_id
    ) source(source_line) on true
    where exception.delivery_id = batch.delivery_id
      and exception.proposed_accepted_quantity > 0;
    if posting_lines is not null then
      corrective := public.receive_inventory_delivery(
        p_posting_request_id, delivery.location_id, delivery.vendor_id,
        delivery.purchase_order_id, clock_timestamp(), delivery.invoice_number,
        'Approved receiving exceptions for delivery ' || delivery.id::text,
        posting_lines
      );
    end if;
  end if;
  update public.delivery_receiving_batches candidate
  set status = target_status, reviewed_by = actor_id, reviewed_at = clock_timestamp(),
    review_note = clean_note, corrective_delivery_id = corrective.id
  where candidate.delivery_id = batch.delivery_id returning * into batch;
  perform private.complete_operation_request(p_request_id);
  return batch;
end
$$;

revoke all on function public.receive_inventory_delivery_with_exceptions(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.review_delivery_receiving_exceptions(uuid,uuid,uuid,boolean,text)
from public, anon, authenticated, service_role;
grant execute on function public.receive_inventory_delivery_with_exceptions(uuid,uuid,uuid,uuid,timestamptz,text,text,jsonb) to authenticated;
grant execute on function public.review_delivery_receiving_exceptions(uuid,uuid,uuid,boolean,text) to authenticated;
