-- Canonicalize live 86/restoration state against existing recipe and inventory
-- IDs. Historical free-text events remain readable but cannot be created by
-- authenticated clients after this migration.

alter table public.service_availability_events
add column subject_id uuid;

create index service_availability_canonical_current_idx
on public.service_availability_events (
  organization_id, location_id, subject_type, subject_id,
  effective_at desc, created_at desc
) where subject_id is not null;

create function public.service_availability_subjects(
  p_organization_id uuid,
  p_location_id uuid
)
returns table (id uuid, "subjectType" text, label text)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
begin
  if auth.uid() is null
    or p_organization_id is null
    or p_location_id is null
    or not public.has_capability(p_organization_id, p_location_id, 'service.availability.manage') then
    raise exception 'Service availability capability is required' using errcode = '42501';
  end if;
  return query
  select recipe.id, 'menu_item'::text, recipe.name
  from public.recipes recipe
  where recipe.organization_id = p_organization_id and recipe.is_active
  union all
  select item.id, 'component'::text, item.name
  from public.inventory_items item
  where item.organization_id = p_organization_id and item.is_active
  order by 2, 3, 1;
end
$$;

create function public.record_canonical_service_availability_event(
  p_request_id uuid, p_organization_id uuid, p_location_id uuid,
  p_subject_type text, p_subject_id uuid, p_expected_event_id uuid, p_status text,
  p_estimated_portions numeric, p_reason text, p_effective_at timestamptz,
  p_expected_restoration_at timestamptz, p_notes text
)
returns public.service_availability_events
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  result public.service_availability_events%rowtype;
  prior_event public.service_availability_events%rowtype;
  resolved_label text;
  normalized_type text := lower(btrim(coalesce(p_subject_type, '')));
  normalized_status text := lower(btrim(coalesce(p_status, '')));
  claimed boolean;
  payload jsonb;
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_request_id is null or p_organization_id is null or p_location_id is null
    or p_subject_id is null
    or normalized_type not in ('menu_item', 'component')
    or normalized_status not in ('available', 'running_low', 'eighty_sixed', 'restored')
    or p_effective_at is null
    or p_estimated_portions < 0
    or length(coalesce(p_reason, '')) > 500
    or length(coalesce(p_notes, '')) > 2000
    or (p_expected_restoration_at is not null and p_expected_restoration_at <= p_effective_at) then
    raise exception 'Valid canonical availability details are required' using errcode = '22023';
  end if;
  if not public.has_capability(p_organization_id, p_location_id, 'service.availability.manage') then
    raise exception 'Service availability capability is required' using errcode = '42501';
  end if;
  if normalized_type = 'menu_item' then
    select recipe.name into resolved_label from public.recipes recipe
    where recipe.organization_id = p_organization_id and recipe.id = p_subject_id and recipe.is_active;
  else
    select item.name into resolved_label from public.inventory_items item
    where item.organization_id = p_organization_id and item.id = p_subject_id and item.is_active;
  end if;
  if resolved_label is null then
    raise exception 'The selected availability subject is unavailable' using errcode = 'P0002';
  end if;
  payload := jsonb_build_object(
    'subjectType', normalized_type, 'subjectId', p_subject_id,
    'expectedEventId', p_expected_event_id,
    'status', normalized_status, 'estimatedPortions', p_estimated_portions,
    'reason', nullif(btrim(p_reason), ''), 'effectiveAt', p_effective_at,
    'expectedRestorationAt', p_expected_restoration_at,
    'notes', nullif(btrim(p_notes), '')
  );
  claimed := private.claim_operation_request(
    p_request_id, 'service.availability.record', p_organization_id,
    p_location_id, p_subject_id, payload
  );
  if claimed then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_organization_id::text || ':' || p_location_id::text || ':' ||
        normalized_type || ':' || p_subject_id::text,
        0
      )
    );
    select event.* into prior_event
    from public.service_availability_events event
    where event.organization_id = p_organization_id
      and event.location_id = p_location_id
      and event.subject_type = normalized_type
      and event.subject_id = p_subject_id
      and event.effective_at <= p_effective_at
    order by event.effective_at desc, event.created_at desc, event.id desc
    limit 1;
    if prior_event.id is distinct from p_expected_event_id then
      raise exception 'Availability changed after this screen loaded' using errcode = '40001';
    end if;
    if normalized_status = 'restored'
      and (prior_event.id is null or prior_event.status not in ('running_low', 'eighty_sixed')) then
      raise exception 'Only a currently constrained item can be restored' using errcode = '23514';
    end if;
    insert into public.service_availability_events (
      id, organization_id, location_id, subject_type, subject_id,
      subject_label, status, estimated_portions, reason, effective_at,
      expected_restoration_at, actor_id, notes
    ) values (
      p_request_id, p_organization_id, p_location_id, normalized_type,
      p_subject_id, resolved_label, normalized_status, p_estimated_portions,
      nullif(btrim(p_reason), ''), p_effective_at,
      p_expected_restoration_at, actor_id, nullif(btrim(p_notes), '')
    );
    perform private.complete_operation_request(p_request_id);
  end if;
  select event.* into result from public.service_availability_events event
  where event.id = p_request_id
    and event.organization_id = p_organization_id
    and event.location_id = p_location_id
    and event.subject_id = p_subject_id;
  if result.id is null then
    raise exception 'Availability replay evidence is unavailable' using errcode = '40001';
  end if;
  return result;
end
$$;

revoke all on function public.record_service_availability_event(
  uuid, uuid, uuid, text, text, text, numeric, text, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.service_availability_subjects(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.record_canonical_service_availability_event(
  uuid, uuid, uuid, text, uuid, uuid, text, numeric, text, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.service_availability_subjects(uuid, uuid) to authenticated;
grant execute on function public.record_canonical_service_availability_event(
  uuid, uuid, uuid, text, uuid, uuid, text, numeric, text, timestamptz, timestamptz, text
) to authenticated;

comment on column public.service_availability_events.subject_id is
'Canonical recipe ID for menu_item or inventory_item ID for component. Null only on legacy events.';
