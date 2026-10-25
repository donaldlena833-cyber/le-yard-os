-- Allocate immutable brief versions atomically and allow exact publish retries.
-- Acknowledgements stay bound to their original preshift_id.
create or replace function public.save_preshift(
  p_request_id uuid, p_preshift_id uuid, p_organization_id uuid, p_location_id uuid,
  p_business_date date, p_service_period text, p_status text,
  p_booked_covers integer, p_projected_covers integer, p_vip_notes text,
  p_allergy_notes text, p_large_party_notes text, p_specials text,
  p_staffing_notes text, p_station_assignments jsonb, p_previous_handoff text,
  p_service_goal text, p_training_point text, p_manager_notes text
)
returns public.preshifts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  target_id uuid := coalesce(p_preshift_id, p_request_id);
  existing public.preshifts%rowtype;
  result public.preshifts%rowtype;
  claimed boolean;
  next_version integer;
  payload jsonb;
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_request_id is null or target_id is null or p_business_date is null
    or p_status not in ('draft', 'published')
    or jsonb_typeof(coalesce(p_station_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Valid pre-shift details are required' using errcode = '22023';
  end if;
  if not public.has_capability(p_organization_id, p_location_id, 'preshift.manage') then
    raise exception 'Pre-shift capability is required' using errcode = '42501';
  end if;
  -- One short transaction per location serializes version allocation for all
  -- service dates/periods. Draft and published writes use the same boundary.
  perform pg_advisory_xact_lock(hashtextextended(
    'preshift:' || p_organization_id::text || ':' || p_location_id::text, 0
  ));
  select * into existing from public.preshifts preshift where preshift.id = target_id for update;
  if existing.id is not null and (existing.organization_id <> p_organization_id
    or existing.location_id <> p_location_id) then
    raise exception 'Pre-shift not found' using errcode = 'P0002';
  end if;
  payload := jsonb_build_object(
    'preshiftId', target_id, 'businessDate', p_business_date, 'servicePeriod', p_service_period,
    'status', p_status, 'bookedCovers', p_booked_covers, 'projectedCovers', p_projected_covers,
    'vipNotes', p_vip_notes, 'allergyNotes', p_allergy_notes, 'largePartyNotes', p_large_party_notes,
    'specials', p_specials, 'staffingNotes', p_staffing_notes,
    'stationAssignments', coalesce(p_station_assignments, '[]'::jsonb),
    'previousHandoff', p_previous_handoff, 'serviceGoal', p_service_goal,
    'trainingPoint', p_training_point, 'managerNotes', p_manager_notes
  );
  claimed := private.claim_operation_request(
    p_request_id, 'preshift.save', p_organization_id, p_location_id, target_id, payload
  );
  if claimed then
    -- Verify the payload/actor/scope-bound request first. An exact retry of a
    -- successful publish returns its original immutable row without rewriting.
    if existing.status in ('published', 'archived') then
      raise exception 'Published pre-shifts are immutable; create a new version' using errcode = '23514';
    end if;
    if existing.id is not null and (
      existing.business_date <> p_business_date
      or existing.service_period <> p_service_period
    ) then
      raise exception 'Pre-shift scope cannot change; create a new version for the requested service' using errcode = '23514';
    end if;
    if existing.id is null then
      select coalesce(max(preshift.version_number), 0) + 1
      into next_version from public.preshifts preshift
      where preshift.organization_id = p_organization_id
        and preshift.location_id = p_location_id
        and preshift.business_date = p_business_date
        and preshift.service_period = p_service_period;
    else
      next_version := existing.version_number;
    end if;
    insert into public.preshifts (
      id, organization_id, location_id, business_date, service_period, version_number, status,
      booked_covers, projected_covers, vip_notes, allergy_notes, large_party_notes,
      specials, staffing_notes, station_assignments, previous_handoff, service_goal,
      training_point, manager_notes, created_by, published_by, published_at
    ) values (
      target_id, p_organization_id, p_location_id, p_business_date, p_service_period,
      next_version, p_status, p_booked_covers, p_projected_covers, nullif(btrim(p_vip_notes), ''),
      nullif(btrim(p_allergy_notes), ''), nullif(btrim(p_large_party_notes), ''),
      nullif(btrim(p_specials), ''), nullif(btrim(p_staffing_notes), ''),
      coalesce(p_station_assignments, '[]'::jsonb), nullif(btrim(p_previous_handoff), ''),
      nullif(btrim(p_service_goal), ''), nullif(btrim(p_training_point), ''),
      nullif(btrim(p_manager_notes), ''), actor_id,
      case when p_status = 'published' then actor_id end,
      case when p_status = 'published' then now() end
    ) on conflict (id) do update set
      service_period = excluded.service_period, status = excluded.status,
      booked_covers = excluded.booked_covers, projected_covers = excluded.projected_covers,
      vip_notes = excluded.vip_notes, allergy_notes = excluded.allergy_notes,
      large_party_notes = excluded.large_party_notes, specials = excluded.specials,
      staffing_notes = excluded.staffing_notes, station_assignments = excluded.station_assignments,
      previous_handoff = excluded.previous_handoff, service_goal = excluded.service_goal,
      training_point = excluded.training_point, manager_notes = excluded.manager_notes,
      published_by = excluded.published_by, published_at = excluded.published_at;
    perform private.complete_operation_request(p_request_id);
  end if;
  select * into result from public.preshifts preshift where preshift.id = target_id;
  return result;
end
$$;


-- Keep the existing authenticated command surface; no direct table grants.
revoke all on function public.save_preshift(uuid, uuid, uuid, uuid, date, text, text, integer, integer, text, text, text, text, text, jsonb, text, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.save_preshift(uuid, uuid, uuid, uuid, date, text, text, integer, integer, text, text, text, text, text, jsonb, text, text, text, text)
to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261024144113',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
