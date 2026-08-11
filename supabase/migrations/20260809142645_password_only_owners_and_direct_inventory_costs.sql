-- Le Yard OS 0.2 follow-up: password-only Owner sessions during the current
-- rollout phase and direct, vendor-neutral inventory costing.
--
-- This migration intentionally keeps MFA factors enrolled in Supabase Auth.
-- It removes the application authorization requirement; it does not delete
-- factors or weaken tenant, role, capability, location, or idempotency checks.

create or replace function public.can_access_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  )
$$;

create or replace function public.has_org_role(
  p_organization_id uuid,
  p_roles public.app_role[]
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role = any(p_roles)
  )
$$;

create or replace function public.can_access_location(
  p_organization_id uuid,
  p_location_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_memberships organization_membership
    where organization_membership.organization_id = p_organization_id
      and organization_membership.user_id = auth.uid()
      and organization_membership.status = 'active'
      and (
        organization_membership.role in ('owner', 'admin')
        or (
          organization_membership.role in ('manager', 'employee')
          and exists (
            select 1
            from public.location_memberships location_membership
            where location_membership.organization_id = p_organization_id
              and location_membership.location_id = p_location_id
              and location_membership.user_id = auth.uid()
          )
        )
      )
  )
$$;

create or replace function public.can_manage_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
  )
$$;

create or replace function public.shares_active_org(p_other_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = p_other_user_id
      and theirs.status = 'active'
  )
$$;

create or replace function public.is_self_employee(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.employees employee
    join public.organization_memberships membership
      on membership.organization_id = employee.organization_id
     and membership.user_id = employee.user_id
    where employee.id = p_employee_id
      and employee.user_id = auth.uid()
      and membership.status = 'active'
  )
$$;

create or replace function public.is_owner_pending_mfa(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select false
$$;

comment on function public.can_manage_org(uuid)
is 'Owner and Admin organization management authorization. MFA is optional during the current rollout; tenant membership remains mandatory.';

comment on function public.is_owner_pending_mfa(uuid)
is 'Compatibility helper retained for existing policies. Owner MFA is optional during the current rollout, so it always returns false.';

-- Preserve the mature invitation implementation and wrap it with the revised
-- Owner policy. The legacy body still performs every role, scope, expiry,
-- target-account, and final-owner invariant; only its historical AAL2 check is
-- satisfied inside this tightly scoped compatibility wrapper.
alter function public.provision_user_invitation(
  uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid
) rename to provision_user_invitation_aal2_legacy;

revoke all on function public.provision_user_invitation_aal2_legacy(
  uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid
) from public, anon, authenticated;

create function public.provision_user_invitation(
  p_auth_user_id uuid,
  p_organization_id uuid,
  p_email text,
  p_display_name text,
  p_role public.app_role,
  p_location_ids uuid[],
  p_token_hash text,
  p_expires_at timestamptz,
  p_employee_id uuid
)
returns uuid
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  prior_claims text := current_setting('request.jwt.claims', true);
  claims jsonb := coalesce(nullif(prior_claims, '')::jsonb, '{}'::jsonb);
  result_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_set(claims, '{aal}', '"aal2"'::jsonb, true)::text,
    true
  );
  result_id := public.provision_user_invitation_aal2_legacy(
    p_auth_user_id, p_organization_id, p_email, p_display_name, p_role,
    p_location_ids, p_token_hash, p_expires_at, p_employee_id
  );
  perform set_config('request.jwt.claims', prior_claims, true);
  return result_id;
end
$$;

revoke all on function public.provision_user_invitation(
  uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.provision_user_invitation(
  uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid
) to authenticated;

-- Checklist photo binding is service-only. Preserve the existing evidence
-- verifier while translating AAL1 only for an active Owner actor now permitted
-- by the rollout policy. The browser never receives service credentials.
alter function public.bind_verified_checklist_photo_response(
  uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint
) rename to bind_verified_checklist_photo_response_aal2_legacy;

revoke all on function public.bind_verified_checklist_photo_response_aal2_legacy(
  uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint
) from public, anon, authenticated, service_role;

create function public.bind_verified_checklist_photo_response(
  p_request_id uuid,
  p_actor_id uuid,
  p_actor_aal text,
  p_run_id uuid,
  p_template_item_id uuid,
  p_response jsonb,
  p_storage_path text,
  p_notes text,
  p_mime_type text,
  p_size_bytes bigint
)
returns public.checklist_responses
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  effective_aal text := p_actor_aal;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Verified checklist photo binding is service-only'
      using errcode = '42501';
  end if;
  if p_actor_aal = 'aal1' and exists (
    select 1
    from public.organization_memberships membership
    join public.checklist_runs run
      on run.organization_id = membership.organization_id
    where run.id = p_run_id
      and membership.user_id = p_actor_id
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then
    effective_aal := 'aal2';
  end if;
  return public.bind_verified_checklist_photo_response_aal2_legacy(
    p_request_id, p_actor_id, effective_aal, p_run_id, p_template_item_id,
    p_response, p_storage_path, p_notes, p_mime_type, p_size_bytes
  );
end
$$;

revoke all on function public.bind_verified_checklist_photo_response(
  uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.bind_verified_checklist_photo_response(
  uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint
) to service_role;

-- Vendor-neutral costing. A direct price is an append-only effective-dated
-- record and may be expressed in any active unit that converts to the item's
-- canonical base unit. Existing vendor price history remains unchanged.
alter table public.item_price_history
  alter column vendor_id drop not null,
  add column price_quantity numeric(16,6) not null default 1
    check (price_quantity > 0),
  add column notes text;

create index item_price_history_manual_source_idx
on public.item_price_history (organization_id, inventory_item_id, effective_at desc)
where vendor_id is null;

create trigger item_price_history_audit
after insert or update or delete on public.item_price_history
for each row execute function public.capture_audit_event();

create function public.record_inventory_item_cost(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_inventory_item_id uuid,
  p_unit_id uuid,
  p_price_quantity numeric,
  p_unit_price_cents bigint,
  p_effective_at timestamptz,
  p_notes text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  claimed boolean;
  item_row public.inventory_items%rowtype;
  clean_notes text := nullif(btrim(p_notes), '');
  canonical_payload jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null or p_location_id is null
    or p_inventory_item_id is null or p_unit_id is null
    or p_price_quantity is null or p_price_quantity <= 0
    or p_price_quantity >= 1000000000000 or scale(p_price_quantity) > 6
    or p_unit_price_cents is null or p_unit_price_cents < 0
    or p_unit_price_cents > 9000000000000000
    or p_effective_at is null
    or p_effective_at > clock_timestamp() + interval '366 days'
    or length(coalesce(clean_notes, '')) > 2000 then
    raise exception 'A valid effective-dated inventory cost is required'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.locations location
    where location.id = p_location_id
      and location.organization_id = p_organization_id
      and location.is_active
  ) or not public.can_access_location(p_organization_id, p_location_id) then
    raise exception 'The inventory cost location is outside your access scope'
      using errcode = '42501';
  end if;
  if not (
    public.can_manage_org(p_organization_id)
    or public.has_capability(
      p_organization_id, p_location_id, 'inventory.price.manage'
    )
  ) then
    raise exception 'Inventory price management is required'
      using errcode = '42501';
  end if;
  select * into item_row
  from public.inventory_items item
  where item.id = p_inventory_item_id
    and item.organization_id = p_organization_id
    and item.is_active;
  if item_row.id is null or not exists (
    select 1 from public.measurement_units unit
    where unit.id = p_unit_id
      and unit.organization_id = p_organization_id
      and unit.is_active
  ) then
    raise exception 'The inventory item and cost unit must be active tenant records'
      using errcode = '23514';
  end if;
  perform private.inventory_conversion_multiplier(
    p_organization_id, p_inventory_item_id, p_unit_id, item_row.base_unit_id
  );

  canonical_payload := jsonb_build_object(
    'inventoryItemId', p_inventory_item_id,
    'unitId', p_unit_id,
    'priceQuantity', p_price_quantity,
    'unitPriceCents', p_unit_price_cents,
    'effectiveAt', p_effective_at,
    'notes', clean_notes
  );
  claimed := private.claim_operation_request(
    p_request_id,
    'inventory.item_cost.record',
    p_organization_id,
    p_location_id,
    p_request_id,
    canonical_payload
  );
  if not claimed then
    return jsonb_build_object('id', p_request_id, 'replayed', true);
  end if;

  insert into public.item_price_history (
    id, organization_id, inventory_item_id, vendor_id, unit_id,
    price_quantity, unit_price_cents, effective_at, source_type, source_id, notes
  ) values (
    p_request_id, p_organization_id, p_inventory_item_id, null, p_unit_id,
    p_price_quantity, p_unit_price_cents, p_effective_at, 'manual_unit_cost', p_request_id,
    clean_notes
  );

  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', p_request_id, 'replayed', false);
end
$$;

revoke insert, update, delete on public.item_price_history from authenticated;
revoke all on function public.record_inventory_item_cost(
  uuid, uuid, uuid, uuid, uuid, numeric, bigint, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.record_inventory_item_cost(
  uuid, uuid, uuid, uuid, uuid, numeric, bigint, timestamptz, text
) to authenticated;

comment on function public.record_inventory_item_cost(
  uuid, uuid, uuid, uuid, uuid, numeric, bigint, timestamptz, text
)
is 'Actor-derived, capability- and location-scoped, idempotent append-only inventory unit cost history without a required vendor.';
