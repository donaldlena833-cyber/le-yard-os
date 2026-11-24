create function private.church_square_inventory_scope(
  p_merchant_id text,p_square_location_id text
)
returns table(organization_id uuid,location_id uuid)
language plpgsql stable set search_path = ''
as $$
begin
  select location.organization_id,location.id into organization_id,location_id
  from public.locations location
  where location.code = 'CHURCH'
    and private.church_square_count_organization(location.id) = location.organization_id;
  if location_id is null then
    raise exception 'Active Church Street location is required' using errcode = '42501';
  end if;
  if exists (
    select 1 from private.church_square_count_items item
    where item.location_id = church_square_inventory_scope.location_id
      and (item.merchant_id,item.square_location_id) is distinct from (p_merchant_id,p_square_location_id)
  ) then
    raise exception 'Square inventory scope does not match Church Street' using errcode = '42501';
  end if;
  return next;
end
$$;

create function private.apply_church_square_inventory_observations(
  p_organization_id uuid,p_location_id uuid,p_merchant_id text,p_square_location_id text,
  p_inventory jsonb,p_require_mappings boolean
)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  observation record;
  current_stock private.church_square_stock_state%rowtype;
  changed_alert boolean := false;
  matched integer := 0;
  applied integer := 0;
begin
  -- Mapping configuration locks the location before it changes a mapping. Take
  -- the same order before locking items and potentially creating the location signal.
  perform 1 from public.locations location
  where location.id = p_location_id and location.organization_id = p_organization_id
    and private.church_square_count_organization(location.id) = location.organization_id
  for key share of location;
  if not found then
    raise exception 'Active Church Street location is required' using errcode = '42501';
  end if;

  -- Use provider time and a stable order shared by recovery, the webhook and acknowledgment.
  for observation in
    select distinct on (item.id) item.id,
      (stock.value->>'quantity')::numeric(17,5) as quantity,
      (stock.value->>'calculatedAt')::timestamptz as calculated_at
    from jsonb_array_elements(p_inventory) as stock(value)
    join private.church_square_count_items item
      on item.merchant_id = p_merchant_id and item.square_location_id = p_square_location_id
      and item.variation_id = stock.value->>'variationId' and item.organization_id = p_organization_id
      and item.location_id = p_location_id and item.is_enabled
    where stock.value->>'quantity' ~ '^-?[0-9]{1,12}(\.[0-9]{1,5})?$'
      and stock.value->>'calculatedAt' is not null
    order by item.id,calculated_at desc,quantity desc
  loop
    perform pg_advisory_xact_lock(hashtextextended('church-square-stock:' || observation.id::text,0));
    perform 1 from private.church_square_count_items item
    where item.id = observation.id and item.organization_id = p_organization_id and item.location_id = p_location_id
      and item.merchant_id = p_merchant_id and item.square_location_id = p_square_location_id and item.is_enabled
    for share;
    if not found then continue; end if;
    matched := matched + 1;
    select * into current_stock from private.church_square_stock_state stock where stock.item_id = observation.id;
    if current_stock.calculated_at >= observation.calculated_at then continue; end if;

    if (current_stock.episode_id is not null or observation.quantity <= 5)
      and (current_stock.quantity is distinct from observation.quantity or current_stock.episode_id is null) then
      changed_alert := true;
    end if;
    insert into private.church_square_stock_state(item_id,quantity,calculated_at,episode_id)
    values (
      observation.id,observation.quantity,observation.calculated_at,
      case when observation.quantity <= 5 then coalesce(current_stock.episode_id,gen_random_uuid()) end
    ) on conflict(item_id) do update set
      quantity = excluded.quantity,calculated_at = excluded.calculated_at,episode_id = excluded.episode_id;
    applied := applied + 1;
  end loop;

  if p_require_mappings and matched <> jsonb_array_length(p_inventory) then
    raise exception 'A Square inventory snapshot item is outside the active Church mapping' using errcode = 'PT409';
  end if;
  if changed_alert then
    insert into public.church_square_stock_invalidation_signals as signal(organization_id,location_id)
    values (p_organization_id,p_location_id)
    on conflict(organization_id,location_id) do update
      set revision = signal.revision + 1,updated_at = clock_timestamp();
  end if;
  return jsonb_build_object('applied',applied,'ignored',jsonb_array_length(p_inventory) - applied);
end
$$;

create or replace function public.service_record_church_square_webhook(
  p_merchant_id text,p_square_location_id text,p_event_id text,p_event_type text,
  p_created_at timestamptz,p_resource_id text,p_inventory jsonb,p_related_order_id text default null
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  target_organization uuid;
  target_location uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Square webhook service access is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_inventory) is distinct from 'array' then
    raise exception 'Invalid Square inventory projection' using errcode = '22023';
  end if;
  if jsonb_array_length(p_inventory) > 2000
    or (p_event_type <> 'inventory.count.updated' and p_inventory <> '[]'::jsonb) then
    raise exception 'Invalid Square inventory projection' using errcode = '22023';
  end if;
  select scope.organization_id,scope.location_id into target_organization,target_location
  from private.church_square_inventory_scope(p_merchant_id,p_square_location_id) scope;

  insert into private.church_square_webhook_receipts (
    merchant_id,square_location_id,event_id,event_type,resource_id,related_order_id,organization_id,location_id,created_at
  ) values (
    p_merchant_id,p_square_location_id,p_event_id,p_event_type,p_resource_id,p_related_order_id,
    target_organization,target_location,p_created_at
  ) on conflict(merchant_id,event_id) do nothing;
  if not found then return false; end if;

  if p_event_type = 'inventory.count.updated' then
    perform private.apply_church_square_inventory_observations(
      target_organization,target_location,p_merchant_id,p_square_location_id,p_inventory,false
    );
  end if;
  return true;
end
$$;

create function public.service_list_church_square_stock_mappings(p_merchant_id text,p_square_location_id text)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  target_organization uuid;
  target_location uuid;
  mappings jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Square inventory recovery service access is required' using errcode = '42501';
  end if;
  if coalesce(p_merchant_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_square_location_id,'') !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'Exact Square inventory scope is required' using errcode = '22023';
  end if;
  select scope.organization_id,scope.location_id into target_organization,target_location
  from private.church_square_inventory_scope(p_merchant_id,p_square_location_id) scope;
  select coalesce(jsonb_agg(candidate.variation_id order by candidate.variation_id),'[]'::jsonb) into mappings
  from (
    select item.variation_id from private.church_square_count_items item
    where item.organization_id = target_organization and item.location_id = target_location
      and item.merchant_id = p_merchant_id and item.square_location_id = p_square_location_id and item.is_enabled
    order by item.variation_id limit 201
  ) candidate;
  if jsonb_array_length(mappings) > 200 then
    raise exception 'Square inventory recovery mapping limit exceeded' using errcode = '22023';
  end if;
  return mappings;
end
$$;

create function public.service_reconcile_church_square_stock(
  p_merchant_id text,p_square_location_id text,p_inventory jsonb
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  target_organization uuid;
  target_location uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Square inventory recovery service access is required' using errcode = '42501';
  end if;
  if coalesce(p_merchant_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_square_location_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or jsonb_typeof(p_inventory) is distinct from 'array' then
    raise exception 'Exact Square inventory scope and an observation array are required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_inventory) > 200 or pg_column_size(p_inventory) > 100000 or exists (
    select 1 from jsonb_array_elements(p_inventory) observation(value)
    where case when jsonb_typeof(observation.value) = 'object' then
      observation.value - array['variationId','quantity','calculatedAt'] <> '{}'::jsonb
      or jsonb_typeof(observation.value->'variationId') is distinct from 'string'
      or coalesce(observation.value->>'variationId','') !~ '^[A-Za-z0-9_-]{1,100}$'
      or jsonb_typeof(observation.value->'quantity') is distinct from 'string'
      or coalesce(observation.value->>'quantity','') !~ '^-?[0-9]{1,12}(\.[0-9]{1,5})?$'
      or jsonb_typeof(observation.value->'calculatedAt') is distinct from 'string'
      or coalesce(observation.value->>'calculatedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      or not pg_input_is_valid(observation.value->>'calculatedAt','timestamptz')
    else true end
  ) or (
    select count(distinct observation.value->>'variationId') from jsonb_array_elements(p_inventory) observation(value)
  ) <> jsonb_array_length(p_inventory) then
    raise exception 'Invalid or duplicate Square inventory observations' using errcode = '22023';
  end if;

  select scope.organization_id,scope.location_id into target_organization,target_location
  from private.church_square_inventory_scope(p_merchant_id,p_square_location_id) scope;
  return private.apply_church_square_inventory_observations(
    target_organization,target_location,p_merchant_id,p_square_location_id,p_inventory,true
  );
end
$$;

revoke all on function private.church_square_inventory_scope(text,text),
  private.apply_church_square_inventory_observations(uuid,uuid,text,text,jsonb,boolean),
  public.service_record_church_square_webhook(text,text,text,text,timestamptz,text,jsonb,text),
  public.service_list_church_square_stock_mappings(text,text),
  public.service_reconcile_church_square_stock(text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.service_record_church_square_webhook(text,text,text,text,timestamptz,text,jsonb,text),
  public.service_list_church_square_stock_mappings(text,text),public.service_reconcile_church_square_stock(text,text,jsonb)
  to service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114110300', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
