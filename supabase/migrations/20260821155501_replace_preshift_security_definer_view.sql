-- A SECURITY DEFINER view bypasses caller RLS implicitly and is rejected by
-- the Supabase security advisor. Use an explicit RPC instead: the scope and
-- manager-only field projection are visible in the function contract and the
-- base table remains unavailable through PostgREST.
drop view if exists public.preshifts_safe;

create function public.read_preshifts_safe(
  p_organization_id uuid,
  p_location_id uuid,
  p_from_business_date date,
  p_limit integer default 12
)
returns table (
  id uuid,
  organization_id uuid,
  location_id uuid,
  business_date date,
  service_period text,
  version_number integer,
  status text,
  booked_covers integer,
  projected_covers integer,
  vip_notes text,
  allergy_notes text,
  large_party_notes text,
  specials text,
  staffing_notes text,
  station_assignments jsonb,
  previous_handoff text,
  service_goal text,
  training_point text,
  manager_notes text,
  published_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
set row_security = off
as $$
declare
  can_manage boolean;
begin
  if p_organization_id is null
    or p_location_id is null
    or p_from_business_date is null
    or p_limit is null
    or p_limit < 1
    or p_limit > 50 then
    raise exception 'A valid organization, location, date, and limit are required'
      using errcode = '22023';
  end if;

  can_manage := public.has_capability(
    p_organization_id,
    p_location_id,
    'preshift.manage'
  );

  if not public.can_access_location(p_organization_id, p_location_id)
    and not can_manage then
    raise exception 'Not authorized to read pre-shift records'
      using errcode = '42501';
  end if;

  return query
  select
    preshift.id,
    preshift.organization_id,
    preshift.location_id,
    preshift.business_date,
    preshift.service_period,
    preshift.version_number,
    preshift.status,
    preshift.booked_covers,
    preshift.projected_covers,
    preshift.vip_notes,
    preshift.allergy_notes,
    preshift.large_party_notes,
    preshift.specials,
    preshift.staffing_notes,
    preshift.station_assignments,
    preshift.previous_handoff,
    preshift.service_goal,
    preshift.training_point,
    case when can_manage then preshift.manager_notes else null end,
    preshift.published_at,
    preshift.updated_at
  from public.preshifts preshift
  where preshift.organization_id = p_organization_id
    and preshift.location_id = p_location_id
    and preshift.business_date >= p_from_business_date
    and (can_manage or preshift.status in ('published', 'archived'))
  order by preshift.business_date, preshift.version_number desc
  limit p_limit;
end
$$;

revoke all on function public.read_preshifts_safe(uuid, uuid, date, integer)
from public, anon, authenticated;
grant execute on function public.read_preshifts_safe(uuid, uuid, date, integer)
to authenticated;

comment on function public.read_preshifts_safe(uuid, uuid, date, integer) is
  'Location-scoped staff pre-shift projection. Drafts and manager_notes require preshift.manage.';
