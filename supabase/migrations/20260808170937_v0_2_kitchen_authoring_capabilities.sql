-- Le Yard OS Version 0.2: split kitchen-authoring capabilities and provide a
-- narrow, location-authorized command for the organization-scoped foundation.
-- Existing inventory.catalog.manage grants remain valid as a compatibility
-- umbrella; new assignments can use the more precise capabilities.

insert into public.capability_definitions (capability_key, domain, label, description)
values
  ('inventory.item.manage', 'inventory', 'Manage inventory items', 'Create, edit, deactivate, and restore inventory products.'),
  ('inventory.category.manage', 'inventory', 'Manage inventory categories', 'Create, edit, deactivate, and restore the inventory category hierarchy.'),
  ('inventory.unit.manage', 'inventory', 'Manage inventory units', 'Create, edit, deactivate, and restore measurement units used by kitchen records.')
on conflict (capability_key) do update
set label = excluded.label,
    description = excluded.description,
    is_active = true,
    updated_at = now();

create function public.configure_kitchen_foundation(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_command text,
  p_payload jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  clean_command text := lower(btrim(coalesce(p_command, '')));
  target_id uuid;
  clean_name text;
  clean_symbol text;
  clean_dimension text;
  parent_id uuid;
  active_value boolean;
  base_value boolean;
  existing_unit public.measurement_units%rowtype;
  existing_category public.inventory_categories%rowtype;
  claimed boolean;
  canonical_payload jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null or p_location_id is null
    or jsonb_typeof(p_payload) <> 'object'
    or clean_command not in ('unit.save', 'category.save') then
    raise exception 'A valid kitchen foundation command is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id
      and location.is_active
  ) then
    raise exception 'The location must be active in this organization' using errcode = '23514';
  end if;
  if clean_command = 'unit.save' and not public.has_capability(
    p_organization_id, p_location_id, 'inventory.unit.manage'
  ) then
    raise exception 'Measurement-unit capability is required' using errcode = '42501';
  elsif clean_command = 'category.save' and not public.has_capability(
    p_organization_id, p_location_id, 'inventory.category.manage'
  ) then
    raise exception 'Inventory-category capability is required' using errcode = '42501';
  end if;

  target_id := case
    when nullif(p_payload ->> 'id', '') is null then p_request_id
    else (p_payload ->> 'id')::uuid
  end;
  canonical_payload := jsonb_build_object(
    'command', clean_command, 'locationId', p_location_id, 'payload', p_payload
  );
  claimed := private.claim_operation_request(
    p_request_id, 'inventory.kitchen_foundation.' || clean_command,
    p_organization_id, p_location_id, target_id, canonical_payload
  );
  if not claimed then
    return jsonb_build_object('id', target_id, 'command', clean_command, 'replayed', true);
  end if;

  if clean_command = 'unit.save' then
    clean_name := nullif(btrim(p_payload ->> 'name'), '');
    clean_symbol := nullif(btrim(p_payload ->> 'symbol'), '');
    clean_dimension := lower(btrim(coalesce(p_payload ->> 'dimension', '')));
    base_value := coalesce((p_payload ->> 'isBase')::boolean, false);
    active_value := coalesce((p_payload ->> 'isActive')::boolean, true);
    if clean_name is null or length(clean_name) > 120
      or clean_symbol is null or length(clean_symbol) > 24
      or clean_dimension not in ('count', 'mass', 'volume', 'length') then
      raise exception 'A valid unit name, symbol, and dimension are required' using errcode = '22023';
    end if;
    select * into existing_unit from public.measurement_units unit
    where unit.id = target_id for update;
    if existing_unit.id is not null and existing_unit.organization_id <> p_organization_id then
      raise exception 'Measurement unit not found' using errcode = 'P0002';
    end if;
    if existing_unit.id is not null
      and (existing_unit.symbol <> clean_symbol or existing_unit.dimension <> clean_dimension)
      and exists (
        select 1 from public.inventory_items item where item.base_unit_id = target_id
        union all select 1 from public.vendor_items vendor_item where vendor_item.purchase_unit_id = target_id
        union all select 1 from public.recipe_ingredients ingredient where ingredient.unit_id = target_id
        union all select 1 from public.recipes recipe where recipe.yield_unit_id = target_id
      ) then
      raise exception 'A referenced unit cannot change symbol or dimension' using errcode = '23514';
    end if;
    if not active_value and exists (
      select 1 from public.inventory_items item
      where item.organization_id = p_organization_id and item.base_unit_id = target_id and item.is_active
      union all select 1 from public.vendor_items vendor_item
      where vendor_item.organization_id = p_organization_id and vendor_item.purchase_unit_id = target_id and vendor_item.is_active
      union all select 1 from public.recipes recipe
      where recipe.organization_id = p_organization_id and recipe.yield_unit_id = target_id and recipe.is_active
    ) then
      raise exception 'Deactivate dependent catalog records before this unit' using errcode = '23514';
    end if;
    if existing_unit.id is null then
      insert into public.measurement_units (
        id, organization_id, name, symbol, dimension, is_base, is_active
      ) values (
        target_id, p_organization_id, clean_name, clean_symbol,
        clean_dimension, base_value, active_value
      );
    else
      update public.measurement_units unit
      set name = clean_name, symbol = clean_symbol, dimension = clean_dimension,
          is_base = base_value, is_active = active_value
      where unit.id = target_id;
    end if;
  else
    clean_name := nullif(btrim(p_payload ->> 'name'), '');
    parent_id := nullif(p_payload ->> 'parentId', '')::uuid;
    active_value := coalesce((p_payload ->> 'isActive')::boolean, true);
    if clean_name is null or length(clean_name) > 120 or parent_id = target_id then
      raise exception 'A valid category name and parent are required' using errcode = '22023';
    end if;
    if parent_id is not null and not exists (
      select 1 from public.inventory_categories category
      where category.id = parent_id and category.organization_id = p_organization_id and category.is_active
    ) then
      raise exception 'Parent category must be active in this organization' using errcode = '23514';
    end if;
    if parent_id is not null and exists (
      with recursive ancestors as (
        select category.id, category.parent_id
        from public.inventory_categories category where category.id = parent_id
        union all
        select category.id, category.parent_id
        from public.inventory_categories category
        join ancestors on category.id = ancestors.parent_id
      )
      select 1 from ancestors where id = target_id
    ) then
      raise exception 'Category hierarchy cannot contain a cycle' using errcode = '23514';
    end if;
    select * into existing_category from public.inventory_categories category
    where category.id = target_id for update;
    if existing_category.id is not null and existing_category.organization_id <> p_organization_id then
      raise exception 'Inventory category not found' using errcode = 'P0002';
    end if;
    if not active_value and exists (
      select 1 from public.inventory_categories category
      where category.parent_id = target_id and category.is_active
      union all select 1 from public.inventory_items item
      where item.category_id = target_id and item.is_active
    ) then
      raise exception 'Deactivate or move dependent items and categories first' using errcode = '23514';
    end if;
    if existing_category.id is null then
      insert into public.inventory_categories (
        id, organization_id, name, parent_id, is_active
      ) values (target_id, p_organization_id, clean_name, parent_id, active_value);
    else
      update public.inventory_categories category
      set name = clean_name, parent_id = parent_id, is_active = active_value
      where category.id = target_id;
    end if;
  end if;

  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', target_id, 'command', clean_command, 'replayed', false);
end
$$;

revoke all on function public.configure_kitchen_foundation(uuid, uuid, uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function public.configure_kitchen_foundation(uuid, uuid, uuid, text, jsonb)
to authenticated;

comment on function public.configure_kitchen_foundation(uuid, uuid, uuid, text, jsonb) is
  'Actor-derived and idempotent measurement-unit/category authoring for users with a location-scoped kitchen capability.';

-- The frozen operational item command checks the former umbrella key. Treat a
-- precise item grant as satisfying that one legacy check until callers fully
-- migrate, without making unit/category/vendor permissions implicit.
create or replace function public.has_capability(
  p_organization_id uuid,
  p_location_id uuid,
  p_capability_key text,
  p_effective_on date default current_date
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select private.user_has_capability(
    auth.uid(), p_organization_id, p_location_id, p_capability_key, p_effective_on
  ) or (
    p_capability_key = 'inventory.catalog.manage'
    and private.user_has_capability(
      auth.uid(), p_organization_id, p_location_id, 'inventory.item.manage', p_effective_on
    )
  )
$$;

revoke all on function public.has_capability(uuid, uuid, text, date)
from public, anon, authenticated;
grant execute on function public.has_capability(uuid, uuid, text, date)
to authenticated;
