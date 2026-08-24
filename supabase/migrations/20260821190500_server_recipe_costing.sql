-- Compute recipe batch and portion costs in PostgreSQL from the newest
-- effective item cost and canonical unit conversions. Browser arithmetic is
-- never treated as accounting evidence.

create function public.recipe_cost_snapshot(
  p_organization_id uuid,
  p_location_id uuid,
  p_observed_at timestamptz default clock_timestamp()
)
returns table (
  "recipeId" uuid,
  name text,
  "yieldQuantity" numeric,
  "yieldUnitId" uuid,
  "menuPriceCents" bigint,
  "ingredientCount" integer,
  "costedIngredientCount" integer,
  "missingCostCount" integer,
  "batchCostCents" bigint,
  "portionCostCents" bigint,
  "foodCostPercent" numeric
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
begin
  if auth.uid() is null
    or p_organization_id is null
    or p_location_id is null
    or p_observed_at is null then
    raise exception 'Valid recipe cost scope is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id
      and location.is_active
  ) or not public.can_access_location(p_organization_id, p_location_id)
    or not (
      public.can_manage_org(p_organization_id)
      or public.has_any_location_capability(
        p_organization_id,
        array[
          'inventory.catalog.manage', 'inventory.item.manage',
          'inventory.price.manage', 'inventory.purchase.create',
          'inventory.purchase.approve', 'inventory.receive',
          'recipe.manage', 'prep.manage', 'prep.complete', 'menu.manage'
        ]::text[],
        current_date
      )
    ) then
    raise exception 'Recipe cost access is required' using errcode = '42501';
  end if;

  return query
  with ingredient_costs as (
    select
      recipe.id as recipe_id,
      ingredient.id as ingredient_id,
      case when price.id is null then null else
        private.inventory_base_quantity(
          recipe.organization_id,
          ingredient.inventory_item_id,
          ingredient.unit_id,
          ingredient.quantity / (1 - ingredient.waste_factor)
        ) * (
          (price.unit_price_cents::numeric / price.price_quantity) /
          private.inventory_conversion_multiplier(
            recipe.organization_id,
            ingredient.inventory_item_id,
            price.unit_id,
            item.base_unit_id
          )
        )
      end as ingredient_cost_cents
    from public.recipes recipe
    join public.recipe_ingredients ingredient
      on ingredient.organization_id = recipe.organization_id
     and ingredient.recipe_id = recipe.id
    join public.inventory_items item
      on item.organization_id = ingredient.organization_id
     and item.id = ingredient.inventory_item_id
    left join lateral (
      select history.*
      from public.item_price_history history
      where history.organization_id = ingredient.organization_id
        and history.inventory_item_id = ingredient.inventory_item_id
        and history.effective_at <= p_observed_at
      order by history.effective_at desc, history.created_at desc, history.id desc
      limit 1
    ) price on true
    where recipe.organization_id = p_organization_id
      and recipe.is_active
  ), totals as (
    select
      recipe.id,
      recipe.name,
      recipe.yield_quantity,
      recipe.yield_unit_id,
      recipe.menu_price_cents,
      count(cost.ingredient_id)::integer as ingredient_count,
      count(cost.ingredient_cost_cents)::integer as costed_count,
      (count(cost.ingredient_id) - count(cost.ingredient_cost_cents))::integer as missing_count,
      case
        when count(cost.ingredient_id) = 0
          or count(cost.ingredient_cost_cents) <> count(cost.ingredient_id)
        then null
        else round(sum(cost.ingredient_cost_cents))::bigint
      end as batch_cost
    from public.recipes recipe
    left join ingredient_costs cost on cost.recipe_id = recipe.id
    where recipe.organization_id = p_organization_id and recipe.is_active
    group by recipe.id
  )
  select
    totals.id,
    totals.name,
    totals.yield_quantity,
    totals.yield_unit_id,
    totals.menu_price_cents,
    totals.ingredient_count,
    totals.costed_count,
    totals.missing_count,
    totals.batch_cost,
    case when totals.batch_cost is null then null
      else round(totals.batch_cost::numeric / totals.yield_quantity)::bigint
    end,
    case
      when totals.batch_cost is null or totals.menu_price_cents is null
        or totals.menu_price_cents = 0 then null
      else round(
        (totals.batch_cost::numeric / totals.yield_quantity) /
        totals.menu_price_cents * 100,
        2
      )
    end
  from totals
  order by totals.name, totals.id;
end
$$;

revoke all on function public.recipe_cost_snapshot(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.recipe_cost_snapshot(uuid, uuid, timestamptz)
to authenticated;

comment on function public.recipe_cost_snapshot(uuid, uuid, timestamptz) is
'Authorized, effective-dated recipe batch and portion costing with canonical unit conversion and explicit missing-cost state.';
