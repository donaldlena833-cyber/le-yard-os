-- Capability dates are operational dates, not PostgreSQL session dates. A
-- nullable effective date means "today at this location" so RLS policies and
-- RPCs make the same decision as the workspace session near UTC midnight.
create function private.location_local_effective_date(
  p_organization_id uuid,
  p_location_id uuid,
  p_observed_at timestamptz default statement_timestamp()
)
returns date
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select (p_observed_at at time zone location.timezone)::date
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id
    and location.is_active
$$;

revoke all on function private.location_local_effective_date(uuid, uuid, timestamptz)
from public, anon, authenticated;

create or replace function public.has_capability(
  p_organization_id uuid,
  p_location_id uuid,
  p_capability_key text,
  p_effective_on date default null
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  with resolved as (
    select coalesce(
      p_effective_on,
      private.location_local_effective_date(p_organization_id, p_location_id)
    ) as effective_on
  )
  select coalesce(
    private.user_has_capability(
      auth.uid(), p_organization_id, p_location_id,
      p_capability_key, resolved.effective_on
    ) or (
      p_capability_key = 'inventory.catalog.manage'
      and private.user_has_capability(
        auth.uid(), p_organization_id, p_location_id,
        'inventory.item.manage', resolved.effective_on
      )
    ),
    false
  )
  from resolved
$$;

create or replace function public.has_any_capability(
  p_organization_id uuid,
  p_location_id uuid,
  p_capability_keys text[],
  p_effective_on date default null
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(bool_or(public.has_capability(
    p_organization_id, p_location_id, capability_key, p_effective_on
  )), false)
  from unnest(coalesce(p_capability_keys, '{}'::text[])) capability_key
$$;

create or replace function public.has_any_location_capability(
  p_organization_id uuid,
  p_capability_keys text[],
  p_effective_on date default null
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.locations location
    where location.organization_id = p_organization_id
      and location.is_active
      and public.has_any_capability(
        p_organization_id, location.id, p_capability_keys, p_effective_on
      )
  )
$$;

create or replace function public.effective_capabilities(
  p_organization_id uuid,
  p_location_id uuid,
  p_effective_on date default null
)
returns table (capability_key text)
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  with resolved as (
    select coalesce(
      p_effective_on,
      private.location_local_effective_date(p_organization_id, p_location_id)
    ) as effective_on
  )
  select definition.capability_key
  from public.capability_definitions definition
  cross join resolved
  where definition.is_active
    and private.user_has_capability(
      auth.uid(), p_organization_id, p_location_id,
      definition.capability_key, resolved.effective_on
    )
  order by definition.capability_key
$$;

revoke all on function public.has_capability(uuid, uuid, text, date)
from public, anon, authenticated;
revoke all on function public.has_any_capability(uuid, uuid, text[], date)
from public, anon, authenticated;
revoke all on function public.has_any_location_capability(uuid, text[], date)
from public, anon, authenticated;
revoke all on function public.effective_capabilities(uuid, uuid, date)
from public, anon, authenticated;
grant execute on function public.has_capability(uuid, uuid, text, date) to authenticated;
grant execute on function public.has_any_capability(uuid, uuid, text[], date) to authenticated;
grant execute on function public.has_any_location_capability(uuid, text[], date) to authenticated;
grant execute on function public.effective_capabilities(uuid, uuid, date) to authenticated;

comment on function private.location_local_effective_date(uuid, uuid, timestamptz) is
  'Returns the calendar date at an active exact-scope location for authorization decisions.';
comment on function public.has_capability(uuid, uuid, text, date) is
  'Checks an exact location capability; a null date resolves to the location-local current date.';
comment on function public.has_any_capability(uuid, uuid, text[], date) is
  'Checks exact location capabilities; a null date resolves to the location-local current date.';
comment on function public.has_any_location_capability(uuid, text[], date) is
  'Checks each active location using its own local date when no explicit date is supplied.';
comment on function public.effective_capabilities(uuid, uuid, date) is
  'Lists exact location capabilities using the location-local current date by default.';
