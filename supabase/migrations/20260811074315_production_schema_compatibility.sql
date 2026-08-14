-- Reassert the public capability helper added to the schedule draft after the
-- first connected preview recorded that migration. This keeps the forward
-- production schema aligned with the generated application contract.
create or replace function public.has_current_location_capability(
  p_organization_id uuid,
  p_location_id uuid,
  p_capability_key text
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select coalesce((
    select private.user_has_capability(
      auth.uid(),
      location.organization_id,
      location.id,
      p_capability_key,
      (statement_timestamp() at time zone location.timezone)::date
    )
    from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id
      and location.is_active
  ), false)
$$;

revoke all on function public.has_current_location_capability(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.has_current_location_capability(uuid, uuid, text)
to authenticated;
