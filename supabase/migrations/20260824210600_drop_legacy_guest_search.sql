-- Remove the organization-wide legacy search that returned full guest rows.
-- All active callers use service_guest_profiles with an explicit location and
-- capability-aware field projection.

revoke all on function public.search_guests(uuid, text, integer)
from public, anon, authenticated, service_role;
drop function public.search_guests(uuid, text, integer);
