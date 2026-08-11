create or replace function public.service_day_provider_health(
  p_organization_id uuid,
  p_location_id uuid
)
returns table (
  provider public.integration_provider,
  display_name text,
  status text,
  last_synced_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  effective_on date;
begin
  select (clock_timestamp() at time zone location.timezone)::date
  into effective_on
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id
    and location.is_active;

  if effective_on is null
    or auth.uid() is null
    or not public.can_access_location(p_organization_id, p_location_id)
    or not public.has_capability(
      p_organization_id,
      p_location_id,
      'integrations.manage',
      effective_on
    )
  then
    raise exception 'Provider health is not available for this workspace.'
      using errcode = '42501';
  end if;

  return query
  select
    connection.provider,
    connection.display_name,
    connection.status,
    connection.last_synced_at,
    connection.updated_at
  from public.integration_connections connection
  where connection.organization_id = p_organization_id
    and (
      connection.location_id is null
      or connection.location_id = p_location_id
    )
  order by connection.provider, connection.display_name, connection.id;
end
$$;

revoke all on function public.service_day_provider_health(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.service_day_provider_health(uuid, uuid)
to authenticated;

comment on function public.service_day_provider_health(uuid, uuid) is
'Returns minimal provider-health fields for one active location after exact integrations.manage authorization on the location-local service date; raw integration tables remain protected by RLS.';
