-- Preserve receiving and immutable inventory history. Change only the two
-- reviewed public command bodies and add a private pure-value validator.
DO $reviewed$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='receive_inventory_delivery_with_exceptions(uuid,uuid,uuid,uuid,timestamp with time zone,text,text,jsonb)'::regprocedure) IS DISTINCT FROM 'd47e0c4a9017ecff8fde4c7c94d65d32' THEN RAISE EXCEPTION 'Reviewed receiving function body drifted: public.receive_inventory_delivery_with_exceptions'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='review_delivery_receiving_exceptions(uuid,uuid,uuid,boolean,text)'::regprocedure) IS DISTINCT FROM '00db6a305e7dd0b4e6cd186a4cab9358' THEN RAISE EXCEPTION 'Reviewed receiving function body drifted: public.review_delivery_receiving_exceptions'; END IF;
END
$reviewed$;

-- Pure value validation shared by fresh receiving and retained pending review.
-- Preserve finite numeric wire strings supported by the existing command.
-- No table access or elevated execution context is necessary.
CREATE FUNCTION private.receiving_proposed_quantities_are_valid(p_lines jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=''
AS $quantities$
DECLARE
  proposed_line jsonb;
  delivered_quantity numeric;
  proposed_quantity numeric;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 500 THEN RETURN false; END IF;
  FOR proposed_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(proposed_line) IS DISTINCT FROM 'object'
      OR proposed_line->>'quantity' IS NULL OR proposed_line->>'accepted_quantity' IS NULL
    THEN RETURN false; END IF;
    BEGIN
      delivered_quantity := (proposed_line->>'quantity')::numeric;
      proposed_quantity := (proposed_line->>'accepted_quantity')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN false;
    END;
    -- Numeric NaN/Infinity compare above finite delivered values; negative
    -- infinity is below zero. These bounds refuse all non-finite proposals.
    IF delivered_quantity <= 0 OR delivered_quantity >= 1000000000000
      OR scale(delivered_quantity) > 4 OR proposed_quantity < 0
      OR proposed_quantity > delivered_quantity OR scale(proposed_quantity) > 4
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$quantities$;
REVOKE ALL ON FUNCTION private.receiving_proposed_quantities_are_valid(jsonb)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.receive_inventory_delivery_with_exceptions(p_request_id uuid, p_location_id uuid, p_vendor_id uuid, p_purchase_order_id uuid, p_delivered_at timestamp with time zone, p_invoice_number text, p_notes text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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

  -- Validate original proposals before exception posting masks them to zero.
  -- Completed exact replays above remain historical and cannot post again.
  if not private.receiving_proposed_quantities_are_valid(p_lines) then
    raise exception 'Accepted quantities must be finite, at most four decimals, and between zero and delivered quantity'
      using errcode = '22023';
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
$function$
;

CREATE OR REPLACE FUNCTION public.review_delivery_receiving_exceptions(p_request_id uuid, p_posting_request_id uuid, p_delivery_id uuid, p_approve boolean, p_note text)
 RETURNS delivery_receiving_batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
    raise exception 'Delivery exception review replay is unavailable' using errcode = 'PT409';
  end if;
  if batch.status <> 'pending_review' then
    raise exception 'Delivery exceptions have already been reviewed' using errcode = '23514';
  end if;
  if p_approve then
    -- A pending batch may predate this guard. Do not normalize or rewrite it;
    -- refuse unsafe approval while leaving explicit rejection available.
    if not private.receiving_proposed_quantities_are_valid(batch.payload -> 'lines') then
      raise exception 'Recorded receiving proposals exceed or do not identify their delivered quantities'
        using errcode = '23514';
    end if;
    if exists (
      select 1 from public.delivery_receiving_exceptions exception
      left join lateral (
        select line
        from jsonb_array_elements(batch.payload -> 'lines') line
        where (line ->> 'inventory_item_id')::uuid = exception.inventory_item_id
          and (line ->> 'unit_id')::uuid = exception.unit_id
      ) source(source_line) on true
      where exception.delivery_id = batch.delivery_id
        and (source.source_line is null
          or exception.proposed_accepted_quantity is distinct from (source.source_line ->> 'accepted_quantity')::numeric
          or exception.exception_kind is distinct from source.source_line ->> 'exception_kind')
    ) then
      raise exception 'Recorded receiving exceptions do not match their original proposal evidence'
        using errcode = '23514';
    end if;
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
$function$
;

UPDATE private.runtime_schema_contract_expected expected
SET migration_head='20261025082041',table_fingerprint=s.value->>'tableFingerprint',function_fingerprint=s.value->>'functionFingerprint',access_fingerprint=s.value->>'accessFingerprint',captured_at=clock_timestamp()
FROM(SELECT private.compute_runtime_schema_fingerprints() value)s WHERE expected.contract_version='runtime-schema-v2';
