-- Managers and the chef persona may edit recipes without gaining owner/admin
-- access to the rest of the inventory catalog.

create or replace function public.save_manager_recipe(
  p_request_id uuid,
  p_workspace_location_id uuid,
  p_recipe_id uuid,
  p_name text,
  p_yield_quantity numeric,
  p_yield_unit_id uuid,
  p_menu_price_cents bigint,
  p_is_active boolean,
  p_ingredients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  organization_id uuid;
  target_id uuid := coalesce(p_recipe_id, p_request_id);
  clean_name text := nullif(btrim(p_name), '');
  active_value boolean := coalesce(p_is_active, true);
  existing_recipe public.recipes%rowtype;
  snapshot_ingredients jsonb;
  version_number integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select location.organization_id
    into organization_id
  from public.locations location
  join public.organization_memberships membership
    on membership.organization_id = location.organization_id
   and membership.user_id = actor_id
   and membership.status = 'active'
   and membership.role = 'manager'
  join public.location_memberships location_membership
    on location_membership.organization_id = location.organization_id
   and location_membership.location_id = location.id
   and location_membership.user_id = actor_id
  where location.id = p_workspace_location_id
    and location.is_active;

  if organization_id is null then
    raise exception 'Manager access to this location is required' using errcode = '42501';
  end if;
  if p_request_id is null or target_id is null or clean_name is null
    or length(clean_name) > 160
    or p_yield_quantity is null or p_yield_quantity <= 0
    or p_yield_quantity >= 1000000000000
    or scale(p_yield_quantity) > 4
    or (p_menu_price_cents is not null and (p_menu_price_cents < 0 or p_menu_price_cents > 9000000000000000))
    or jsonb_typeof(coalesce(p_ingredients, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_ingredients, '[]'::jsonb)) > 500
    or (active_value and jsonb_array_length(coalesce(p_ingredients, '[]'::jsonb)) = 0) then
    raise exception 'Valid recipe yield, price, and ingredients are required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.measurement_units unit
    where unit.id = p_yield_unit_id
      and unit.organization_id = organization_id
      and unit.is_active
  ) then
    raise exception 'Recipe yield unit must be active in this organization' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) ingredient
    where jsonb_typeof(ingredient) <> 'object'
      or not (ingredient ?& array['inventoryItemId', 'unitId', 'quantity', 'wasteFactor'])
      or (ingredient ->> 'quantity')::numeric <= 0
      or (ingredient ->> 'quantity')::numeric >= 1000000000000
      or scale((ingredient ->> 'quantity')::numeric) > 6
      or (ingredient ->> 'wasteFactor')::numeric < 0
      or (ingredient ->> 'wasteFactor')::numeric >= 1
      or scale((ingredient ->> 'wasteFactor')::numeric) > 6
  ) or (
    select count(*) <> count(distinct ingredient ->> 'inventoryItemId')
    from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) ingredient
  ) then
    raise exception 'Recipe ingredients are invalid or duplicated' using errcode = '22023';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) ingredient
    join public.inventory_items item
      on item.id = (ingredient ->> 'inventoryItemId')::uuid
     and item.organization_id = organization_id
     and item.is_active
    join public.measurement_units unit
      on unit.id = (ingredient ->> 'unitId')::uuid
     and unit.organization_id = organization_id
     and unit.is_active
    where private.inventory_conversion_multiplier(
      organization_id, item.id, unit.id, item.base_unit_id
    ) > 0
  ) <> jsonb_array_length(coalesce(p_ingredients, '[]'::jsonb)) then
    raise exception 'Every ingredient requires an active item and canonical unit' using errcode = '23514';
  end if;

  if not private.claim_operation_request(
    p_request_id,
    'inventory.manager.recipe.save',
    organization_id,
    p_workspace_location_id,
    target_id,
    jsonb_build_object(
      'recipeId', p_recipe_id,
      'name', clean_name,
      'yieldQuantity', p_yield_quantity,
      'yieldUnitId', p_yield_unit_id,
      'menuPriceCents', p_menu_price_cents,
      'isActive', active_value,
      'ingredients', p_ingredients
    )
  ) then
    return jsonb_build_object('id', target_id, 'command', 'recipe.save', 'replayed', true);
  end if;

  select * into existing_recipe
  from public.recipes recipe
  where recipe.id = target_id
  for update;
  if existing_recipe.id is not null and existing_recipe.organization_id <> organization_id then
    raise exception 'Recipe not found' using errcode = 'P0002';
  end if;
  if existing_recipe.id is null then
    insert into public.recipes (
      id, organization_id, name, yield_quantity,
      yield_unit_id, menu_price_cents, is_active
    ) values (
      target_id, organization_id, clean_name, p_yield_quantity,
      p_yield_unit_id, p_menu_price_cents, active_value
    );
  else
    update public.recipes recipe
    set name = clean_name,
        yield_quantity = p_yield_quantity,
        yield_unit_id = p_yield_unit_id,
        menu_price_cents = p_menu_price_cents,
        is_active = active_value
    where recipe.id = target_id;
    delete from public.recipe_ingredients ingredient
    where ingredient.recipe_id = target_id;
  end if;

  insert into public.recipe_ingredients (
    organization_id, recipe_id, inventory_item_id,
    unit_id, quantity, waste_factor
  )
  select organization_id, target_id,
    (ingredient ->> 'inventoryItemId')::uuid,
    (ingredient ->> 'unitId')::uuid,
    (ingredient ->> 'quantity')::numeric(16,6),
    (ingredient ->> 'wasteFactor')::numeric(7,6)
  from jsonb_array_elements(coalesce(p_ingredients, '[]'::jsonb)) ingredient;

  select coalesce(jsonb_agg(jsonb_build_object(
    'inventoryItemId', ingredient.inventory_item_id,
    'unitId', ingredient.unit_id,
    'quantity', ingredient.quantity,
    'wasteFactor', ingredient.waste_factor
  ) order by ingredient.inventory_item_id), '[]'::jsonb)
    into snapshot_ingredients
  from public.recipe_ingredients ingredient
  where ingredient.recipe_id = target_id;
  select coalesce(max(version.version_number), 0) + 1
    into version_number
  from public.inventory_recipe_versions version
  where version.recipe_id = target_id;
  insert into public.inventory_recipe_versions (
    organization_id, recipe_id, version_number, snapshot, changed_by
  ) values (
    organization_id, target_id, version_number,
    jsonb_build_object(
      'name', clean_name,
      'yieldQuantity', p_yield_quantity,
      'yieldUnitId', p_yield_unit_id,
      'menuPriceCents', p_menu_price_cents,
      'isActive', active_value,
      'ingredients', snapshot_ingredients
    ),
    actor_id
  );

  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', target_id, 'command', 'recipe.save', 'replayed', false);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'Invalid recipe value' using errcode = '22023';
end
$$;

revoke all on function public.save_manager_recipe(uuid, uuid, uuid, text, numeric, uuid, bigint, boolean, jsonb)
from public, anon, authenticated;
grant execute on function public.save_manager_recipe(uuid, uuid, uuid, text, numeric, uuid, bigint, boolean, jsonb)
to authenticated;

comment on function public.save_manager_recipe(uuid, uuid, uuid, text, numeric, uuid, bigint, boolean, jsonb)
is 'Manager-scoped recipe editor. It can version recipes but cannot configure units, vendors, items, prices, or pars.';
