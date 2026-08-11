-- Keep provider custody and public-management identifiers out of browser
-- reservation reads. Hosts consume one bounded, exact-scope projection;
-- CRM and operational reporting retain only the columns their existing read
-- models use. The service role remains the raw integration boundary.

drop policy if exists reservation_capability_read on public.reservations;
drop policy if exists reservation_crm_report_read on public.reservations;

create policy reservation_crm_report_read
on public.reservations for select to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array['guest.manage', 'reports.operational.view']::text[],
    null
  )
);

revoke select on table public.reservations from authenticated;
grant select on table public.reservations to service_role;
grant select (
  id,
  organization_id,
  location_id,
  guest_id,
  reserved_at,
  party_size,
  status,
  table_label,
  special_requests,
  source,
  created_at,
  updated_at
) on table public.reservations to authenticated;

create function public.service_reservation_host_snapshot(
  p_organization_id uuid,
  p_location_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  id uuid,
  guest_id uuid,
  reserved_at timestamptz,
  duration_minutes integer,
  party_size integer,
  status text,
  table_label text,
  special_requests text,
  source text,
  booking_channel text
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Reservation access is required' using errcode = '42501';
  end if;

  if p_organization_id is null
    or p_location_id is null
    or p_from is null
    or p_to is null
    or p_to <= p_from
    or p_to > p_from + interval '30 hours'
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'A valid reservation snapshot scope is required'
      using errcode = '22023';
  end if;

  if not public.has_any_capability(
    p_organization_id,
    p_location_id,
    array[
      'reservations.view',
      'reservations.operate',
      'reservations.override',
      'reservations.configure'
    ]::text[],
    null
  ) then
    raise exception 'Reservation access is required' using errcode = '42501';
  end if;

  return query
  select
    reservation.id,
    reservation.guest_id,
    reservation.reserved_at,
    reservation.duration_minutes,
    reservation.party_size,
    reservation.status,
    reservation.table_label,
    reservation.special_requests,
    reservation.source,
    reservation.booking_channel
  from public.reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.reserved_at >= p_from
    and reservation.reserved_at < p_to
  order by reservation.reserved_at, reservation.id;
end
$$;

revoke all on function public.service_reservation_host_snapshot(
  uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.service_reservation_host_snapshot(
  uuid, uuid, timestamptz, timestamptz
) to authenticated;

comment on function public.service_reservation_host_snapshot(
  uuid, uuid, timestamptz, timestamptz
) is
  'Returns the fixed non-provider Host reservation DTO for an exact authorized location and a half-open window of at most 30 hours.';

-- Guest identities are organization-owned, but a location-scoped capability
-- must not turn into an organization-wide CRM read. Owners/Admins retain the
-- intentional tenant-wide operating model; other users need a current exact
-- capability at a location linked to the guest.
create function public.can_read_guest_profile_scope(
  p_organization_id uuid,
  p_guest_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select auth.uid() is not null and (
    public.has_org_role(
      p_organization_id,
      array['owner', 'admin']::public.app_role[]
    )
    or exists (
      select 1
      from public.guests guest
      join public.guest_locations guest_location
        on guest_location.organization_id = guest.organization_id
       and guest_location.guest_id = coalesce(guest.merged_into_id, guest.id)
      where guest.organization_id = p_organization_id
        and guest.id = p_guest_id
        and public.has_any_capability(
          p_organization_id,
          guest_location.location_id,
          array['guest.manage', 'guest.sensitive_notes.view']::text[],
          null
        )
    )
  )
$$;

create function public.can_manage_guest_profile_scope(
  p_organization_id uuid,
  p_guest_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select auth.uid() is not null and (
    public.has_org_role(
      p_organization_id,
      array['owner', 'admin']::public.app_role[]
    )
    or exists (
      select 1
      from public.guests guest
      join public.guest_locations guest_location
        on guest_location.organization_id = guest.organization_id
       and guest_location.guest_id = coalesce(guest.merged_into_id, guest.id)
      where guest.organization_id = p_organization_id
        and guest.id = p_guest_id
        and public.has_capability(
          p_organization_id,
          guest_location.location_id,
          'guest.manage',
          null
        )
    )
  )
$$;

create function public.can_read_guest_note_scope(
  p_organization_id uuid,
  p_guest_id uuid,
  p_note_location_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select auth.uid() is not null and (
    public.has_org_role(
      p_organization_id,
      array['owner', 'admin']::public.app_role[]
    )
    or exists (
      select 1
      from public.guest_locations guest_location
      where guest_location.organization_id = p_organization_id
        and guest_location.guest_id = p_guest_id
        and (
          p_note_location_id is null
          or guest_location.location_id = p_note_location_id
        )
        and public.has_any_capability(
          p_organization_id,
          guest_location.location_id,
          array['guest.manage', 'guest.sensitive_notes.view']::text[],
          null
        )
    )
  )
$$;

revoke all on function public.can_read_guest_profile_scope(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.can_manage_guest_profile_scope(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.can_read_guest_note_scope(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.can_read_guest_profile_scope(uuid, uuid)
to authenticated;
grant execute on function public.can_manage_guest_profile_scope(uuid, uuid)
to authenticated;
grant execute on function public.can_read_guest_note_scope(uuid, uuid, uuid)
to authenticated;

drop policy if exists guest_capability_read on public.guests;
create policy guest_location_capability_read
on public.guests for select to authenticated
using (public.can_read_guest_profile_scope(organization_id, id));

drop policy if exists guest_capability_read on public.guest_locations;
create policy guest_location_capability_read
on public.guest_locations for select to authenticated
using (
  public.has_org_role(
    organization_id,
    array['owner', 'admin']::public.app_role[]
  )
  or public.has_capability(
    organization_id,
    location_id,
    'guest.manage',
    null
  )
);

-- Location rollups contain spend evidence. Browser sessions may use the
-- non-financial location association fields through exact guest.manage RLS,
-- but spend remains available only through a sensitive fixed DTO.
revoke select on table public.guest_locations from authenticated;
grant select (
  id,
  organization_id,
  guest_id,
  location_id,
  is_home_location,
  first_visit_at,
  last_visit_at,
  visit_count,
  created_at,
  updated_at
) on table public.guest_locations to authenticated;
grant select on table public.guest_locations to service_role;

-- Visit notes and spend are sensitive hospitality context. Keep exact
-- location RLS and remove upstream provider/check/server identifiers from the
-- authenticated Data API projection.
drop policy if exists guest_visits_capability_read on public.guest_visits;
create policy guest_visits_capability_read
on public.guest_visits for select to authenticated
using (
  public.has_capability(
    organization_id,
    location_id,
    'guest.sensitive_notes.view',
    null
  )
);

revoke select on table public.guest_visits from authenticated;
grant select (
  id,
  organization_id,
  location_id,
  guest_id,
  visited_at,
  party_size,
  covers,
  spend_cents,
  source,
  notes,
  created_at
) on table public.guest_visits to authenticated;
grant select on table public.guest_visits to service_role;

drop policy if exists guest_capability_read on public.guest_contacts;
create policy guest_location_capability_read
on public.guest_contacts for select to authenticated
using (public.can_manage_guest_profile_scope(organization_id, guest_id));

-- guest_tags are organization-wide definitions, so their existing policy
-- deliberately remains "guest.manage at any active location". Assignments
-- are guest-linked and therefore use the stricter guest scope below.
drop policy if exists guest_capability_read on public.guest_tag_assignments;
create policy guest_location_capability_read
on public.guest_tag_assignments for select to authenticated
using (public.can_manage_guest_profile_scope(organization_id, guest_id));

drop policy if exists guest_capability_read on public.guest_notes;
create policy guest_location_capability_read
on public.guest_notes for select to authenticated
using (
  public.can_read_guest_note_scope(organization_id, guest_id, location_id)
);

drop policy if exists guest_capability_read on public.guest_consents;
create policy guest_location_capability_read
on public.guest_consents for select to authenticated
using (public.can_manage_guest_profile_scope(organization_id, guest_id));

drop policy if exists guest_capability_read on public.guest_merge_events;
create policy guest_location_capability_read
on public.guest_merge_events for select to authenticated
using (
  public.can_manage_guest_profile_scope(organization_id, source_guest_id)
  and
  public.can_manage_guest_profile_scope(organization_id, target_guest_id)
);

comment on function public.can_read_guest_profile_scope(uuid, uuid) is
  'Allows tenant Owners/Admins or exact location capabilities linked through guest_locations to read a guest profile.';
comment on function public.can_manage_guest_profile_scope(uuid, uuid) is
  'Allows tenant Owners/Admins or exact guest.manage capability linked through guest_locations to read guest management evidence.';
comment on function public.can_read_guest_note_scope(uuid, uuid, uuid) is
  'Requires an exact linked-location guest capability; location-owned notes additionally require capability at the note location.';

-- A row policy cannot distinguish operational guest fields from hospitality
-- context. Keep the raw Data API surface useful for ordinary guest management,
-- but make sensitive fields impossible to select directly for every browser
-- role (including Owners/Admins). Authorized callers use the fixed DTOs below.
revoke select on table public.guests from authenticated;
grant select (
  id,
  organization_id,
  first_name,
  last_name,
  display_name,
  vip,
  first_visit_at,
  last_visit_at,
  visit_count,
  source,
  merged_into_id,
  created_at,
  updated_at
) on table public.guests to authenticated;
grant select on table public.guests to service_role;

revoke select on table public.guest_notes from authenticated;
grant select (
  id,
  organization_id,
  guest_id,
  location_id,
  author_id,
  created_at,
  updated_at
) on table public.guest_notes to authenticated;
grant select on table public.guest_notes to service_role;

create function public.service_guest_profiles(
  p_organization_id uuid,
  p_location_id uuid,
  p_query text default null,
  p_limit integer default 250,
  p_guest_ids uuid[] default null
)
returns table (
  id uuid,
  first_name text,
  last_name text,
  display_name text,
  email text,
  phone text,
  birthday date,
  vip boolean,
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  visit_count integer,
  source text
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  tenant_wide boolean;
  can_manage_contact boolean;
  can_search_sensitive boolean;
  clean_query text := nullif(btrim(p_query), '');
begin
  if auth.uid() is null then
    raise exception 'Guest management access is required' using errcode = '42501';
  end if;

  if p_organization_id is null
    or p_location_id is null
    or p_limit not between 1 and 1000
    or (
      p_guest_ids is not null
      and coalesce(cardinality(p_guest_ids), 0) not between 1 and 1000
    )
    or length(coalesce(clean_query, '')) > 120
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'A valid bounded guest scope is required'
      using errcode = '22023';
  end if;

  if not public.has_any_capability(
    p_organization_id,
    p_location_id,
    array['guest.manage', 'guest.sensitive_notes.view']::text[],
    null
  ) then
    raise exception 'Guest management access is required' using errcode = '42501';
  end if;

  tenant_wide := public.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  );
  can_manage_contact := public.has_capability(
    p_organization_id,
    p_location_id,
    'guest.manage',
    null
  );
  can_search_sensitive := public.has_capability(
    p_organization_id,
    p_location_id,
    'guest.sensitive_notes.view',
    null
  );

  return query
  select
    guest.id,
    guest.first_name,
    guest.last_name,
    guest.display_name,
    case when can_manage_contact then guest.email else null end,
    case when can_manage_contact then guest.phone else null end,
    case when can_manage_contact then guest.birthday else null end,
    guest.vip,
    guest.first_visit_at,
    guest.last_visit_at,
    guest.visit_count,
    guest.source
  from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.merged_into_id is null
    and (p_guest_ids is null or guest.id = any(p_guest_ids))
    and (
      clean_query is null
      or to_tsvector(
        'simple'::regconfig,
        concat_ws(
          ' ',
          guest.first_name,
          guest.last_name,
          guest.display_name,
          case when can_manage_contact then guest.email else null end,
          case when can_manage_contact then guest.phone else null end,
          case when can_search_sensitive then guest.preferences else null end,
          case when can_search_sensitive then guest.allergies else null end,
          case when can_search_sensitive then guest.notes else null end
        )
      ) @@ websearch_to_tsquery('simple'::regconfig, clean_query)
    )
    and (
      tenant_wide
      or exists (
        select 1
        from public.guest_locations guest_location
        where guest_location.organization_id = guest.organization_id
          and guest_location.guest_id = guest.id
          and guest_location.location_id = p_location_id
      )
    )
  order by guest.last_visit_at desc nulls last, guest.id
  limit p_limit;
end
$$;

create function public.service_guest_sensitive_profiles(
  p_organization_id uuid,
  p_location_id uuid,
  p_guest_ids uuid[]
)
returns table (
  id uuid,
  preferences text,
  allergies text,
  notes text,
  lifetime_spend_cents bigint
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  tenant_wide boolean;
begin
  if auth.uid() is null then
    raise exception 'Sensitive guest access is required' using errcode = '42501';
  end if;

  if p_organization_id is null
    or p_location_id is null
    or coalesce(cardinality(p_guest_ids), 0) = 0
    or cardinality(p_guest_ids) > 1000
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'A valid bounded guest scope is required'
      using errcode = '22023';
  end if;

  if not public.has_capability(
    p_organization_id,
    p_location_id,
    'guest.sensitive_notes.view',
    null
  ) then
    raise exception 'Sensitive guest access is required' using errcode = '42501';
  end if;

  tenant_wide := public.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  );

  return query
  select
    guest.id,
    guest.preferences,
    guest.allergies,
    guest.notes,
    guest.lifetime_spend_cents
  from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.id = any(p_guest_ids)
    and guest.merged_into_id is null
    and (
      tenant_wide
      or exists (
        select 1
        from public.guest_locations guest_location
        where guest_location.organization_id = guest.organization_id
          and guest_location.guest_id = guest.id
          and guest_location.location_id = p_location_id
      )
    )
  order by guest.id;
end
$$;

create function public.service_guest_sensitive_notes(
  p_organization_id uuid,
  p_location_id uuid,
  p_guest_ids uuid[]
)
returns table (
  id uuid,
  guest_id uuid,
  location_id uuid,
  note text,
  is_sensitive boolean,
  author_id uuid,
  created_at timestamptz
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  tenant_wide boolean;
begin
  if auth.uid() is null then
    raise exception 'Sensitive guest access is required' using errcode = '42501';
  end if;

  if p_organization_id is null
    or p_location_id is null
    or coalesce(cardinality(p_guest_ids), 0) = 0
    or cardinality(p_guest_ids) > 1000
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'A valid bounded guest scope is required'
      using errcode = '22023';
  end if;

  if not public.has_capability(
    p_organization_id,
    p_location_id,
    'guest.sensitive_notes.view',
    null
  ) then
    raise exception 'Sensitive guest access is required' using errcode = '42501';
  end if;

  tenant_wide := public.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  );

  return query
  select
    guest_note.id,
    guest_note.guest_id,
    guest_note.location_id,
    guest_note.note,
    guest_note.is_sensitive,
    guest_note.author_id,
    guest_note.created_at
  from public.guest_notes guest_note
  where guest_note.organization_id = p_organization_id
    and guest_note.guest_id = any(p_guest_ids)
    and (
      tenant_wide
      or (
        (guest_note.location_id is null or guest_note.location_id = p_location_id)
        and exists (
          select 1
          from public.guest_locations guest_location
          where guest_location.organization_id = guest_note.organization_id
            and guest_location.guest_id = guest_note.guest_id
            and guest_location.location_id = p_location_id
        )
      )
    )
  order by guest_note.created_at desc, guest_note.id
  limit 1000;
end
$$;

create function public.service_guest_sensitive_metrics(
  p_organization_id uuid,
  p_location_id uuid
)
returns table (profiles_with_allergies bigint)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  tenant_wide boolean;
begin
  if auth.uid() is null
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'A valid guest scope is required' using errcode = '22023';
  end if;

  if not public.has_capability(
    p_organization_id,
    p_location_id,
    'guest.sensitive_notes.view',
    null
  ) then
    raise exception 'Sensitive guest access is required' using errcode = '42501';
  end if;

  tenant_wide := public.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  );

  return query
  select count(*)::bigint
  from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.merged_into_id is null
    and nullif(btrim(guest.allergies), '') is not null
    and (
      tenant_wide
      or exists (
        select 1
        from public.guest_locations guest_location
        where guest_location.organization_id = guest.organization_id
          and guest_location.guest_id = guest.id
          and guest_location.location_id = p_location_id
      )
    );
end
$$;

revoke all on function public.service_guest_sensitive_profiles(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;
revoke all on function public.service_guest_profiles(
  uuid, uuid, text, integer, uuid[]
)
from public, anon, authenticated, service_role;
revoke all on function public.service_guest_sensitive_notes(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;
revoke all on function public.service_guest_sensitive_metrics(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.service_guest_sensitive_profiles(uuid, uuid, uuid[])
to authenticated;
grant execute on function public.service_guest_profiles(
  uuid, uuid, text, integer, uuid[]
)
to authenticated;
grant execute on function public.service_guest_sensitive_notes(uuid, uuid, uuid[])
to authenticated;
grant execute on function public.service_guest_sensitive_metrics(uuid, uuid)
to authenticated;

comment on function public.service_guest_sensitive_profiles(uuid, uuid, uuid[]) is
  'Returns bounded profile hospitality context only for the exact active location-sensitive capability; Owners/Admins retain tenant-wide scope.';
comment on function public.service_guest_profiles(
  uuid, uuid, text, integer, uuid[]
) is
  'Returns a bounded guest directory for one exact location. Contact fields and search terms require guest.manage independently from sensitive hospitality context.';
comment on function public.service_guest_sensitive_notes(uuid, uuid, uuid[]) is
  'Returns bounded note bodies only for the exact active location-sensitive capability; non-tenant-wide callers cannot read another location note.';
comment on function public.service_guest_sensitive_metrics(uuid, uuid) is
  'Counts allergy-bearing profiles only inside an exact authorized sensitive guest scope.';

-- The original commands return table composites and therefore bypass column
-- grants from inside SECURITY DEFINER. Keep them as trusted/service boundaries,
-- and expose fixed response DTOs to browser sessions.
-- Email identity is location-scoped for non-tenant-wide operators. The old
-- organization-wide unique index both prevented that contract and exposed
-- whether an address existed at another location. The service command below
-- serializes and enforces the appropriate exact-location (or tenant-wide)
-- duplicate check instead.
drop index if exists public.guests_email_unique;
create index if not exists guests_email_lookup
on public.guests (organization_id, lower(email))
where email is not null and merged_into_id is null;

-- Browser callers cannot execute these composite-returning kernels directly.
-- Their outer service_* commands remain the exact location/link boundary;
-- these bounded fallbacks only prevent a valid capability-only employee from
-- failing a second, legacy Manager-role check inside the trusted kernel.
create or replace function public.save_guest(
  p_request_id uuid,
  p_organization_id uuid,
  p_guest_id uuid,
  p_first_name text,
  p_last_name text,
  p_display_name text,
  p_email text,
  p_phone text,
  p_birthday date,
  p_vip boolean,
  p_preferences text,
  p_allergies text,
  p_notes text
)
returns public.guests
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  guest_row public.guests%rowtype;
  result_id uuid := coalesce(p_guest_id, p_request_id);
  operation_kind text := case when p_guest_id is null then 'guest.create' else 'guest.update' end;
  clean_first_name text := nullif(btrim(p_first_name), '');
  clean_last_name text := nullif(btrim(p_last_name), '');
  clean_display_name text := btrim(p_display_name);
  clean_email text := lower(nullif(btrim(p_email), ''));
  clean_phone text := nullif(btrim(p_phone), '');
  clean_preferences text := nullif(btrim(p_preferences), '');
  clean_allergies text := nullif(btrim(p_allergies), '');
  clean_notes text := nullif(btrim(p_notes), '');
  payload jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not public.can_operate_org(p_organization_id)
    and not (
      (
        p_guest_id is null
        and public.has_any_location_capability(
          p_organization_id,
          array['guest.manage']::text[],
          null
        )
      )
      or (
        p_guest_id is not null
        and exists (
          select 1
          from public.guest_locations guest_location
          where guest_location.organization_id = p_organization_id
            and guest_location.guest_id = p_guest_id
            and public.has_capability(
              p_organization_id,
              guest_location.location_id,
              'guest.manage',
              null
            )
        )
      )
    ) then
    raise exception 'Not authorized to manage guests in this organization'
      using errcode = '42501';
  end if;
  if clean_display_name is null
    or length(clean_display_name) not between 1 and 240
    or length(coalesce(clean_first_name, '')) > 120
    or length(coalesce(clean_last_name, '')) > 120
    or length(coalesce(clean_email, '')) > 320
    or (clean_email is not null and clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+$')
    or length(coalesce(clean_phone, '')) > 80
    or length(coalesce(clean_preferences, '')) > 10000
    or length(coalesce(clean_allergies, '')) > 10000
    or length(coalesce(clean_notes, '')) > 10000
    or p_birthday > current_date
    or p_birthday < current_date - interval '130 years'
    or p_vip is null then
    raise exception 'Invalid guest profile payload' using errcode = '22023';
  end if;
  payload := jsonb_build_object(
    'guest_id', p_guest_id,
    'first_name', clean_first_name,
    'last_name', clean_last_name,
    'display_name', clean_display_name,
    'email', clean_email,
    'phone', clean_phone,
    'birthday', p_birthday,
    'vip', p_vip,
    'preferences', clean_preferences,
    'allergies', clean_allergies,
    'notes', clean_notes
  );
  if not private.claim_operation_request(
    p_request_id,
    operation_kind,
    p_organization_id,
    null,
    result_id,
    payload
  ) then
    select * into guest_row
    from public.guests guest
    where guest.organization_id = p_organization_id and guest.id = result_id;
    if guest_row.id is not null then return guest_row; end if;
    raise exception 'Guest request has no result row' using errcode = '40001';
  end if;

  if p_guest_id is null then
    insert into public.guests (
      id, organization_id, first_name, last_name, display_name,
      email, phone, birthday, vip, preferences, allergies, notes,
      source, external_references
    ) values (
      p_request_id, p_organization_id, clean_first_name, clean_last_name,
      clean_display_name, clean_email, clean_phone, p_birthday, p_vip,
      clean_preferences, clean_allergies, clean_notes, 'manual', '{}'::jsonb
    ) returning * into guest_row;
  else
    select * into guest_row
    from public.guests guest
    where guest.organization_id = p_organization_id and guest.id = p_guest_id
    for update;
    if guest_row.id is null then
      raise exception 'Guest not found' using errcode = 'P0002';
    end if;
    if guest_row.merged_into_id is not null then
      raise exception 'Merged guest profiles are immutable' using errcode = '42501';
    end if;
    update public.guests guest_update
    set first_name = clean_first_name,
        last_name = clean_last_name,
        display_name = clean_display_name,
        email = clean_email,
        phone = clean_phone,
        birthday = p_birthday,
        vip = p_vip,
        preferences = clean_preferences,
        allergies = clean_allergies,
        notes = clean_notes
    where guest_update.id = guest_row.id
    returning * into guest_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return guest_row;
end
$$;

create or replace function public.add_guest_note(
  p_request_id uuid,
  p_guest_id uuid,
  p_location_id uuid,
  p_note text,
  p_is_sensitive boolean default false
)
returns public.guest_notes
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  guest_row public.guests%rowtype;
  note_row public.guest_notes%rowtype;
  clean_note text := btrim(p_note);
  capability_authorized boolean := false;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if clean_note is null
    or length(clean_note) not between 1 and 10000
    or p_is_sensitive is null then
    raise exception 'Invalid guest note payload' using errcode = '22023';
  end if;
  select * into guest_row
  from public.guests guest
  where guest.id = p_guest_id;
  if guest_row.id is null or guest_row.merged_into_id is not null then
    raise exception 'Active guest not found' using errcode = 'P0002';
  end if;

  select p_location_id is not null and exists (
    select 1
    from public.locations location
    join public.guest_locations guest_location
      on guest_location.organization_id = location.organization_id
     and guest_location.location_id = location.id
     and guest_location.guest_id = guest_row.id
    where location.organization_id = guest_row.organization_id
      and location.id = p_location_id
      and location.is_active
      and public.has_capability(
        guest_row.organization_id,
        location.id,
        'guest.manage',
        null
      )
      and public.has_capability(
        guest_row.organization_id,
        location.id,
        'guest.sensitive_notes.view',
        null
      )
  ) into capability_authorized;

  if not public.can_operate_org(guest_row.organization_id)
    and not capability_authorized then
    raise exception 'Not authorized to add guest notes' using errcode = '42501';
  end if;
  if p_location_id is not null and not exists (
    select 1 from public.locations location
    where location.organization_id = guest_row.organization_id
      and location.id = p_location_id
      and (
        public.can_manage_location(location.organization_id, location.id)
        or capability_authorized
      )
  ) then
    raise exception 'Guest note location is unavailable' using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'guest.note',
    guest_row.organization_id,
    p_location_id,
    guest_row.id,
    jsonb_build_object('note', clean_note, 'is_sensitive', p_is_sensitive)
  ) then
    select * into note_row from public.guest_notes note where note.id = p_request_id;
    if note_row.id is not null then return note_row; end if;
    raise exception 'Guest note request has no result row' using errcode = '40001';
  end if;
  insert into public.guest_notes (
    id, organization_id, guest_id, location_id,
    note, is_sensitive, author_id, created_at, updated_at
  ) values (
    p_request_id, guest_row.organization_id, guest_row.id, p_location_id,
    clean_note, p_is_sensitive, actor_id, clock_timestamp(), clock_timestamp()
  ) returning * into note_row;
  perform private.complete_operation_request(p_request_id);
  return note_row;
end
$$;

create or replace function public.record_guest_consent(
  p_request_id uuid,
  p_guest_id uuid,
  p_channel text,
  p_status public.consent_status,
  p_evidence_note text default null
)
returns public.guest_consents
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  guest_row public.guests%rowtype;
  consent_row public.guest_consents%rowtype;
  clean_evidence_note text := nullif(btrim(p_evidence_note), '');
  captured_at timestamptz := clock_timestamp();
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_channel is null
    or p_status is null
    or p_channel not in ('email', 'sms', 'phone', 'profiling', 'other')
    or p_status not in ('granted', 'revoked')
    or length(coalesce(clean_evidence_note, '')) > 2000 then
    raise exception 'Invalid consent event payload' using errcode = '22023';
  end if;
  select * into guest_row
  from public.guests guest
  where guest.id = p_guest_id;
  if guest_row.id is null or guest_row.merged_into_id is not null then
    raise exception 'Active guest not found' using errcode = 'P0002';
  end if;
  if not public.can_operate_org(guest_row.organization_id)
    and not exists (
      select 1
      from public.guest_locations guest_location
      where guest_location.organization_id = guest_row.organization_id
        and guest_location.guest_id = guest_row.id
        and public.has_capability(
          guest_row.organization_id,
          guest_location.location_id,
          'guest.manage',
          null
        )
    ) then
    raise exception 'Not authorized to record guest consent' using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'guest.consent',
    guest_row.organization_id,
    null,
    guest_row.id,
    jsonb_build_object(
      'channel', p_channel,
      'status', p_status,
      'evidence_note', clean_evidence_note
    )
  ) then
    select * into consent_row
    from public.guest_consents consent
    where consent.id = p_request_id;
    if consent_row.id is not null then return consent_row; end if;
    raise exception 'Consent request has no result row' using errcode = '40001';
  end if;
  insert into public.guest_consents (
    id, organization_id, guest_id, channel, status,
    captured_at, revoked_at, source, evidence, recorded_by, created_at
  ) values (
    p_request_id, guest_row.organization_id, guest_row.id, p_channel, p_status,
    captured_at, case when p_status = 'revoked' then captured_at else null end,
    'manual_staff_record',
    jsonb_strip_nulls(jsonb_build_object(
      'recorded_in', 'le_yard_os',
      'note', clean_evidence_note
    )),
    actor_id, captured_at
  ) returning * into consent_row;
  perform private.complete_operation_request(p_request_id);
  return consent_row;
end
$$;

create or replace function public.merge_guests(
  p_request_id uuid,
  p_source_guest_id uuid,
  p_target_guest_id uuid,
  p_match_score numeric default null,
  p_reasons jsonb default '[]'::jsonb
)
returns public.guest_merge_events
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  source_snapshot public.guests%rowtype;
  target_snapshot public.guests%rowtype;
  source_guest public.guests%rowtype;
  target_guest public.guests%rowtype;
  merge_event public.guest_merge_events%rowtype;
  result_email text;
  result_phone text;
  affected_location_ids uuid[] := '{}'::uuid[];
  identity_lock_key text;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_source_guest_id = p_target_guest_id
    or p_reasons is null
    or (p_match_score is not null and (p_match_score < 0 or p_match_score > 1))
    or jsonb_typeof(p_reasons) <> 'array'
    or jsonb_array_length(p_reasons) > 100
    or octet_length(p_reasons::text) > 20000 then
    raise exception 'Invalid guest merge request' using errcode = '22023';
  end if;
  select * into source_snapshot from public.guests guest
  where guest.id = p_source_guest_id;
  select * into target_snapshot from public.guests guest
  where guest.id = p_target_guest_id;
  if source_snapshot.id is null or target_snapshot.id is null
    or source_snapshot.organization_id <> target_snapshot.organization_id then
    raise exception 'Guest merge scope is invalid' using errcode = '23514';
  end if;
  if not public.can_operate_org(source_snapshot.organization_id)
    and not (
      exists (
        select 1
        from public.guest_locations guest_location
        where guest_location.organization_id = source_snapshot.organization_id
          and guest_location.guest_id in (source_snapshot.id, target_snapshot.id)
      )
      and not exists (
        select 1
        from public.guest_locations guest_location
        where guest_location.organization_id = source_snapshot.organization_id
          and guest_location.guest_id in (source_snapshot.id, target_snapshot.id)
          and not public.has_capability(
            source_snapshot.organization_id,
            guest_location.location_id,
            'guest.manage',
            null
          )
      )
    ) then
    raise exception 'Not authorized to merge guests' using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'guest.merge',
    source_snapshot.organization_id,
    null,
    source_snapshot.id,
    jsonb_build_object(
      'target_guest_id', target_snapshot.id,
      'match_score', p_match_score,
      'reasons', p_reasons
    )
  ) then
    select * into merge_event
    from public.guest_merge_events event
    where event.id = p_request_id;
    if merge_event.id is not null then return merge_event; end if;
    raise exception 'Guest merge request has no result row' using errcode = '40001';
  end if;

  result_email := lower(nullif(
    btrim(coalesce(target_snapshot.email, source_snapshot.email)),
    ''
  ));
  result_phone := nullif(regexp_replace(
    coalesce(target_snapshot.phone, source_snapshot.phone, ''),
    '[^0-9]',
    '',
    'g'
  ), '');

  -- Use the same globally sorted contact-lock protocol as service_save_guest
  -- and the reservation identity resolver. Lock both old identities and the
  -- resultant target identity before either guest row can be waited on.
  for identity_lock_key in
    select distinct identity_lock.key
    from unnest(array[
      case when nullif(lower(btrim(source_snapshot.email)), '') is not null then
        'guest-email:' || source_snapshot.organization_id::text || ':'
          || lower(btrim(source_snapshot.email))
      end,
      case when nullif(
        regexp_replace(coalesce(source_snapshot.phone, ''), '[^0-9]', '', 'g'),
        ''
      ) is not null then
        'guest-phone:' || source_snapshot.organization_id::text || ':'
          || regexp_replace(source_snapshot.phone, '[^0-9]', '', 'g')
      end,
      case when nullif(lower(btrim(target_snapshot.email)), '') is not null then
        'guest-email:' || source_snapshot.organization_id::text || ':'
          || lower(btrim(target_snapshot.email))
      end,
      case when nullif(
        regexp_replace(coalesce(target_snapshot.phone, ''), '[^0-9]', '', 'g'),
        ''
      ) is not null then
        'guest-phone:' || source_snapshot.organization_id::text || ':'
          || regexp_replace(target_snapshot.phone, '[^0-9]', '', 'g')
      end,
      case when result_email is not null then
        'guest-email:' || source_snapshot.organization_id::text || ':' || result_email
      end,
      case when result_phone is not null then
        'guest-phone:' || source_snapshot.organization_id::text || ':' || result_phone
      end
    ]::text[]) identity_lock(key)
    where identity_lock.key is not null
    order by identity_lock.key
  loop
    perform pg_advisory_xact_lock(hashtextextended(identity_lock_key, 0));
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(
    'guest-merge:' || source_snapshot.organization_id::text || ':'
      || least(source_snapshot.id::text, target_snapshot.id::text) || ':'
      || greatest(source_snapshot.id::text, target_snapshot.id::text),
    0
  ));
  perform 1
  from public.guests guest
  where guest.id in (p_source_guest_id, p_target_guest_id)
  order by guest.id
  for update;
  select * into source_guest from public.guests guest where guest.id = p_source_guest_id;
  select * into target_guest from public.guests guest where guest.id = p_target_guest_id;
  if source_guest.id is null or target_guest.id is null
    or to_jsonb(source_guest) is distinct from to_jsonb(source_snapshot)
    or to_jsonb(target_guest) is distinct from to_jsonb(target_snapshot) then
    raise exception 'Guest identity changed concurrently; retry the request'
      using errcode = '40001';
  end if;
  if source_guest.merged_into_id is not null or target_guest.merged_into_id is not null then
    raise exception 'Only active guest profiles may be merged' using errcode = '42501';
  end if;

  result_email := lower(nullif(
    btrim(coalesce(target_guest.email, source_guest.email)),
    ''
  ));
  result_phone := nullif(regexp_replace(
    coalesce(target_guest.phone, source_guest.phone, ''),
    '[^0-9]',
    '',
    'g'
  ), '');

  perform 1
  from public.guest_locations guest_location
  where guest_location.organization_id = source_guest.organization_id
    and guest_location.guest_id in (source_guest.id, target_guest.id)
  order by guest_location.location_id, guest_location.guest_id
  for update;

  select coalesce(
    array_agg(distinct guest_location.location_id order by guest_location.location_id),
    '{}'::uuid[]
  ) into affected_location_ids
  from public.guest_locations guest_location
  where guest_location.organization_id = source_guest.organization_id
    and guest_location.guest_id in (source_guest.id, target_guest.id);

  -- The wrapper and the early kernel guard are an authorization fast path,
  -- not the commit boundary. A concurrent merge/link operation may have added
  -- another affected location while this request waited for the guest locks.
  -- Re-read every linked location after both rows are stable and before any
  -- merge evidence or CRM child is mutated.
  if not public.can_operate_org(source_guest.organization_id)
    and not (
      cardinality(affected_location_ids) > 0
      and not exists (
        select 1
        from unnest(affected_location_ids) affected_location(location_id)
        where not public.has_capability(
            source_guest.organization_id,
            affected_location.location_id,
            'guest.manage',
            null
          )
      )
    ) then
    raise exception 'Not authorized to merge guests' using errcode = '42501';
  end if;

  -- Moving the source links makes the resultant target identity visible in
  -- the full union of locations. Reject a third active profile that already
  -- owns either resultant contact in any of those locations before recording
  -- merge evidence or mutating a CRM child.
  if (result_email is not null or result_phone is not null) and exists (
    select 1
    from public.guests third_guest
    where third_guest.organization_id = source_guest.organization_id
      and third_guest.id not in (source_guest.id, target_guest.id)
      and third_guest.merged_into_id is null
      and (
        (
          result_email is not null
          and lower(nullif(btrim(third_guest.email), '')) = result_email
        )
        or (
          result_phone is not null
          and nullif(regexp_replace(
            coalesce(third_guest.phone, ''),
            '[^0-9]',
            '',
            'g'
          ), '') = result_phone
        )
      )
      and exists (
        select 1
        from public.guest_locations third_location
        where third_location.organization_id = third_guest.organization_id
          and third_location.guest_id = third_guest.id
          and third_location.location_id = any(affected_location_ids)
      )
  ) then
    raise exception 'Resulting guest contact matches another affected profile'
      using errcode = '23505';
  end if;

  insert into private.guest_merge_requests (
    request_id, organization_id, source_guest_id, target_guest_id, actor_id
  ) values (
    p_request_id, source_guest.organization_id,
    source_guest.id, target_guest.id, actor_id
  );
  insert into public.guest_merge_events (
    id, organization_id, source_guest_id, target_guest_id,
    match_score, reasons, merged_by, merged_at
  ) values (
    p_request_id, source_guest.organization_id, source_guest.id,
    target_guest.id, p_match_score, p_reasons, actor_id, clock_timestamp()
  ) returning * into merge_event;

  insert into public.guest_locations (
    id, organization_id, guest_id, location_id, is_home_location,
    first_visit_at, last_visit_at, visit_count, spend_cents,
    created_at, updated_at
  )
  select gen_random_uuid(), source_location.organization_id,
    target_guest.id, source_location.location_id, source_location.is_home_location,
    source_location.first_visit_at, source_location.last_visit_at,
    source_location.visit_count, source_location.spend_cents,
    source_location.created_at, clock_timestamp()
  from public.guest_locations source_location
  where source_location.guest_id = source_guest.id
  on conflict (guest_id, location_id) do update
  set is_home_location = public.guest_locations.is_home_location or excluded.is_home_location,
      first_visit_at = least(public.guest_locations.first_visit_at, excluded.first_visit_at),
      last_visit_at = greatest(public.guest_locations.last_visit_at, excluded.last_visit_at),
      visit_count = public.guest_locations.visit_count + excluded.visit_count,
      spend_cents = public.guest_locations.spend_cents + excluded.spend_cents,
      updated_at = clock_timestamp();
  delete from public.guest_locations location_row
  where location_row.guest_id = source_guest.id;

  delete from public.guest_contacts source_contact
  using public.guest_contacts target_contact
  where source_contact.guest_id = source_guest.id
    and target_contact.guest_id = target_guest.id
    and source_contact.contact_type = target_contact.contact_type
    and lower(coalesce(source_contact.normalized_value, source_contact.value))
      = lower(coalesce(target_contact.normalized_value, target_contact.value));
  update public.guest_contacts source_contact
  set is_primary = false,
      updated_at = clock_timestamp()
  where source_contact.guest_id = source_guest.id
    and source_contact.is_primary
    and exists (
      select 1
      from public.guest_contacts target_contact
      where target_contact.guest_id = target_guest.id
        and target_contact.contact_type = source_contact.contact_type
        and target_contact.is_primary
    );
  update public.guest_contacts contact
  set guest_id = target_guest.id
  where contact.guest_id = source_guest.id;

  delete from public.guest_tag_assignments source_assignment
  using public.guest_tag_assignments target_assignment
  where source_assignment.guest_id = source_guest.id
    and target_assignment.guest_id = target_guest.id
    and source_assignment.tag_id = target_assignment.tag_id;
  update public.guest_tag_assignments assignment
  set guest_id = target_guest.id
  where assignment.guest_id = source_guest.id;

  update public.guest_notes note
  set guest_id = target_guest.id
  where note.guest_id = source_guest.id;
  update public.guest_consents consent
  set guest_id = target_guest.id
  where consent.guest_id = source_guest.id;
  update public.guest_visits visit
  set guest_id = target_guest.id
  where visit.guest_id = source_guest.id;
  update public.reservations reservation
  set guest_id = target_guest.id
  where reservation.guest_id = source_guest.id;
  update public.incidents incident
  set guest_id = target_guest.id
  where incident.guest_id = source_guest.id;

  update public.guests source_update
  set merged_into_id = target_guest.id
  where source_update.id = source_guest.id;
  update public.guests target_update
  set first_name = coalesce(target_guest.first_name, source_guest.first_name),
      last_name = coalesce(target_guest.last_name, source_guest.last_name),
      email = coalesce(target_guest.email, source_guest.email),
      phone = coalesce(target_guest.phone, source_guest.phone),
      birthday = coalesce(target_guest.birthday, source_guest.birthday),
      vip = target_guest.vip or source_guest.vip,
      preferences = coalesce(target_guest.preferences, source_guest.preferences),
      allergies = coalesce(target_guest.allergies, source_guest.allergies),
      notes = coalesce(target_guest.notes, source_guest.notes),
      first_visit_at = least(target_guest.first_visit_at, source_guest.first_visit_at),
      last_visit_at = greatest(target_guest.last_visit_at, source_guest.last_visit_at),
      visit_count = target_guest.visit_count + source_guest.visit_count,
      lifetime_spend_cents = target_guest.lifetime_spend_cents + source_guest.lifetime_spend_cents,
      external_references = source_guest.external_references || target_guest.external_references
  where target_update.id = target_guest.id;

  update private.guest_merge_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  perform private.complete_operation_request(p_request_id);
  return merge_event;
end
$$;

revoke all on function public.save_guest(
  uuid, uuid, uuid, text, text, text, text, text, date, boolean, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.add_guest_note(uuid, uuid, uuid, text, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.save_guest_contact(
  uuid, uuid, uuid, text, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.record_guest_consent(
  uuid, uuid, text, public.consent_status, text
) from public, anon, authenticated, service_role;
revoke all on function public.assign_guest_tag(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.merge_guests(uuid, uuid, uuid, numeric, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_guest(
  uuid, uuid, uuid, text, text, text, text, text, date, boolean, text, text, text
) to service_role;
grant execute on function public.add_guest_note(uuid, uuid, uuid, text, boolean)
to service_role;
grant execute on function public.save_guest_contact(
  uuid, uuid, uuid, text, text, text, boolean
) to service_role;
grant execute on function public.record_guest_consent(
  uuid, uuid, text, public.consent_status, text
) to service_role;
grant execute on function public.assign_guest_tag(uuid, uuid, uuid)
to service_role;
grant execute on function public.merge_guests(uuid, uuid, uuid, numeric, jsonb)
to service_role;

create function public.service_save_guest(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_guest_id uuid,
  p_first_name text,
  p_last_name text,
  p_display_name text,
  p_email text,
  p_phone text,
  p_birthday date,
  p_vip boolean,
  p_preferences text,
  p_allergies text,
  p_notes text
)
returns table (id uuid, display_name text, updated_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  saved_guest public.guests%rowtype;
  snapshot_guest public.guests%rowtype;
  locked_guest public.guests%rowtype;
  tenant_wide boolean;
  existing_request boolean;
  active_location_sensitive boolean;
  can_change_sensitive boolean;
  clean_email text := lower(nullif(btrim(p_email), ''));
  clean_phone text := nullif(btrim(p_phone), '');
  normalized_phone text := nullif(
    regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'),
    ''
  );
  target_guest_id uuid := coalesce(p_guest_id, p_request_id);
  affected_location_ids uuid[] := '{}'::uuid[];
  identity_lock_key text;
  incoming_preferences text := nullif(btrim(p_preferences), '');
  incoming_allergies text := nullif(btrim(p_allergies), '');
  incoming_notes text := nullif(btrim(p_notes), '');
  safe_preferences text := p_preferences;
  safe_allergies text := p_allergies;
  safe_notes text := p_notes;
begin
  if p_request_id is null
    or p_organization_id is null
    or p_location_id is null
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'A valid guest location scope is required'
      using errcode = '22023';
  end if;

  tenant_wide := public.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  );

  if auth.uid() is null or not (
    tenant_wide
    or public.has_capability(
      p_organization_id,
      p_location_id,
      'guest.manage',
      null
    )
  ) then
    raise exception 'Guest management access is required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'guest-save:' || p_organization_id::text || ':' || p_request_id::text,
    0
  ));

  -- Read, but do not row-lock, the old identity. Every participant in the
  -- location identity protocol must acquire the same sorted advisory keys
  -- before waiting on a guest row; otherwise a resolver holding a contact
  -- key while waiting on this row can deadlock with an update doing the
  -- inverse. The post-lock comparison below rejects a stale pre-lock read.
  select * into snapshot_guest
  from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.id = target_guest_id;
  existing_request := snapshot_guest.id is not null;

  for identity_lock_key in
    select distinct identity_lock.key
    from unnest(array[
      case when existing_request
        and nullif(lower(btrim(snapshot_guest.email)), '') is not null then
        'guest-email:' || p_organization_id::text || ':'
          || lower(btrim(snapshot_guest.email))
      end,
      case when existing_request
        and nullif(
          regexp_replace(coalesce(snapshot_guest.phone, ''), '[^0-9]', '', 'g'),
          ''
        ) is not null then
        'guest-phone:' || p_organization_id::text || ':'
          || regexp_replace(snapshot_guest.phone, '[^0-9]', '', 'g')
      end,
      case when clean_email is not null then
        'guest-email:' || p_organization_id::text || ':' || clean_email
      end,
      case when normalized_phone is not null then
        'guest-phone:' || p_organization_id::text || ':' || normalized_phone
      end,
      case when p_guest_id is null then
        'guest-new:' || p_organization_id::text || ':' || p_request_id::text
      end
    ]::text[]) identity_lock(key)
    where identity_lock.key is not null
    order by identity_lock.key
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      identity_lock_key,
      0
    ));
  end loop;

  select * into locked_guest
  from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.id = target_guest_id
  for update;

  if existing_request then
    if locked_guest.id is null
      or to_jsonb(locked_guest) is distinct from to_jsonb(snapshot_guest) then
      raise exception 'Guest identity changed concurrently; retry the request'
        using errcode = '40001';
    end if;
  elsif locked_guest.id is not null then
    raise exception 'Guest identity changed concurrently; retry the request'
      using errcode = '40001';
  end if;

  if p_guest_id is not null and locked_guest.id is null then
    raise exception 'Guest not found' using errcode = 'P0002';
  end if;

  if locked_guest.id is not null then
    -- Stabilize the complete affected-location set after the guest row. New
    -- child links must wait on the parent row FK lock; existing link moves or
    -- deletes must wait on these row locks.
    perform 1
    from public.guest_locations guest_location
    where guest_location.organization_id = p_organization_id
      and guest_location.guest_id = locked_guest.id
    order by guest_location.location_id
    for update;

    select coalesce(
      array_agg(guest_location.location_id order by guest_location.location_id),
      '{}'::uuid[]
    ) into affected_location_ids
    from public.guest_locations guest_location
    where guest_location.organization_id = p_organization_id
      and guest_location.guest_id = locked_guest.id;

    if locked_guest.merged_into_id is not null then
      raise exception 'Merged guest profiles are immutable' using errcode = '42501';
    end if;

    if not tenant_wide and (
      not (p_location_id = any(affected_location_ids))
      or exists (
        select 1
        from unnest(affected_location_ids) affected_location(location_id)
        where not public.has_capability(
          p_organization_id,
          affected_location.location_id,
          'guest.manage',
          null
        )
      )
    ) then
      raise exception 'Guest management access is required' using errcode = '42501';
    end if;
  else
    affected_location_ids := array[p_location_id]::uuid[];
  end if;

  -- The locks above serialize both email and normalized-phone ownership with
  -- the reservation identity resolver. Re-run the affected-location duplicate
  -- predicate only after the target row and its location set are stable.
  if clean_email is not null or normalized_phone is not null then

    if exists (
      select 1
      from public.guests guest
      where guest.organization_id = p_organization_id
        and guest.merged_into_id is null
        and guest.id <> target_guest_id
        and (
          (
            clean_email is not null
            and lower(nullif(btrim(guest.email), '')) = clean_email
          )
          or (
            normalized_phone is not null
            and nullif(
              regexp_replace(coalesce(guest.phone, ''), '[^0-9]', '', 'g'),
              ''
            ) = normalized_phone
          )
        )
        and (
          tenant_wide
          or exists (
            select 1
            from public.guest_locations guest_location
            where guest_location.organization_id = guest.organization_id
              and guest_location.guest_id = guest.id
              and guest_location.location_id = any(affected_location_ids)
          )
        )
    ) then
      raise exception 'Another active guest already uses this contact'
        using errcode = '23505';
    end if;
  end if;

  active_location_sensitive := tenant_wide or public.has_capability(
    p_organization_id,
    p_location_id,
    'guest.sensitive_notes.view',
    null
  );
  can_change_sensitive := tenant_wide or not exists (
    select 1
    from unnest(affected_location_ids) affected_location(location_id)
    where not public.has_capability(
      p_organization_id,
      affected_location.location_id,
      'guest.sensitive_notes.view',
      null
    )
  );

  if not can_change_sensitive then
    if locked_guest.id is null then
      safe_preferences := null;
      safe_allergies := null;
      safe_notes := null;
    else
      -- A caller who can see the active location's sensitive values must not
      -- receive a false-success response when another linked location blocks
      -- the write. Manage-only callers cannot see those values and may still
      -- omit them while safely updating contact or operational fields.
      if active_location_sensitive and (
        incoming_preferences is distinct from locked_guest.preferences
        or incoming_allergies is distinct from locked_guest.allergies
        or incoming_notes is distinct from locked_guest.notes
      ) then
        raise exception 'Sensitive guest changes require access at every linked location'
          using errcode = '42501';
      end if;
      safe_preferences := locked_guest.preferences;
      safe_allergies := locked_guest.allergies;
      safe_notes := locked_guest.notes;
    end if;
  end if;

  saved_guest := public.save_guest(
    p_request_id,
    p_organization_id,
    p_guest_id,
    p_first_name,
    p_last_name,
    p_display_name,
    p_email,
    clean_phone,
    p_birthday,
    p_vip,
    safe_preferences,
    safe_allergies,
    safe_notes
  );

  if p_guest_id is null and not existing_request then
    insert into public.guest_locations (
      organization_id,
      guest_id,
      location_id,
      is_home_location
    ) values (
      p_organization_id,
      saved_guest.id,
      p_location_id,
      true
    )
    on conflict (guest_id, location_id) do nothing;
  end if;

  return query select saved_guest.id, saved_guest.display_name, saved_guest.updated_at;
end
$$;

create function public.service_add_guest_note(
  p_request_id uuid,
  p_guest_id uuid,
  p_location_id uuid,
  p_note text,
  p_is_sensitive boolean default false
)
returns table (id uuid, created_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  saved_note public.guest_notes%rowtype;
  guest_organization_id uuid;
  tenant_wide boolean;
begin
  if auth.uid() is null
    or p_request_id is null
    or p_guest_id is null
    or p_location_id is null then
    raise exception 'Guest note access is required' using errcode = '42501';
  end if;

  select guest.organization_id
  into guest_organization_id
  from public.guests guest
  where guest.id = p_guest_id
    and guest.merged_into_id is null;

  if guest_organization_id is null
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = guest_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'Guest note access is required' using errcode = '42501';
  end if;

  tenant_wide := public.has_org_role(
    guest_organization_id,
    array['owner', 'admin']::public.app_role[]
  );

  if not tenant_wide and (
    not exists (
      select 1
      from public.guest_locations guest_location
      where guest_location.organization_id = guest_organization_id
        and guest_location.guest_id = p_guest_id
        and guest_location.location_id = p_location_id
    )
    or not public.has_capability(
      guest_organization_id,
      p_location_id,
      'guest.manage',
      null
    )
    or not public.has_capability(
      guest_organization_id,
      p_location_id,
      'guest.sensitive_notes.view',
      null
    )
  ) then
    raise exception 'Guest note access is required' using errcode = '42501';
  end if;

  saved_note := public.add_guest_note(
    p_request_id,
    p_guest_id,
    p_location_id,
    p_note,
    p_is_sensitive
  );
  return query select saved_note.id, saved_note.created_at;
end
$$;

create function public.service_record_guest_consent(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_guest_id uuid,
  p_channel text,
  p_status public.consent_status,
  p_evidence_note text
)
returns table (id uuid, captured_at timestamptz)
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  saved_consent public.guest_consents%rowtype;
  tenant_wide boolean;
begin
  if auth.uid() is null
    or p_request_id is null
    or p_organization_id is null
    or p_location_id is null
    or p_guest_id is null
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    )
    or not exists (
      select 1
      from public.guests guest
      where guest.organization_id = p_organization_id
        and guest.id = p_guest_id
        and guest.merged_into_id is null
    ) then
    raise exception 'Guest consent access is required' using errcode = '42501';
  end if;

  tenant_wide := public.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  );

  if not tenant_wide and (
    not public.has_capability(
      p_organization_id,
      p_location_id,
      'guest.manage',
      null
    )
    or not exists (
      select 1
      from public.guest_locations guest_location
      where guest_location.organization_id = p_organization_id
        and guest_location.guest_id = p_guest_id
        and guest_location.location_id = p_location_id
    )
  ) then
    raise exception 'Guest consent access is required' using errcode = '42501';
  end if;

  saved_consent := public.record_guest_consent(
    p_request_id,
    p_guest_id,
    p_channel,
    p_status,
    p_evidence_note
  );
  return query select saved_consent.id, saved_consent.captured_at;
end
$$;

create function public.service_merge_guests(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_source_guest_id uuid,
  p_target_guest_id uuid,
  p_match_score numeric,
  p_reasons jsonb
)
returns table (
  id uuid,
  source_guest_id uuid,
  target_guest_id uuid,
  merged_at timestamptz
)
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  saved_merge public.guest_merge_events%rowtype;
  source_organization_id uuid;
  source_merged_into_id uuid;
  target_organization_id uuid;
  target_merged_into_id uuid;
  tenant_wide boolean;
  is_replay boolean;
begin
  if auth.uid() is null
    or p_request_id is null
    or p_organization_id is null
    or p_location_id is null
    or p_source_guest_id is null
    or p_target_guest_id is null then
    raise exception 'Guest merge access is required' using errcode = '42501';
  end if;

  select guest.organization_id, guest.merged_into_id
  into source_organization_id, source_merged_into_id
  from public.guests guest
  where guest.id = p_source_guest_id;

  select guest.organization_id, guest.merged_into_id
  into target_organization_id, target_merged_into_id
  from public.guests guest
  where guest.id = p_target_guest_id;

  select exists (
    select 1
    from public.guest_merge_events merge_event
    where merge_event.id = p_request_id
      and merge_event.organization_id = p_organization_id
      and merge_event.source_guest_id = p_source_guest_id
      and merge_event.target_guest_id = p_target_guest_id
  ) into is_replay;

  if source_organization_id is distinct from p_organization_id
    or target_organization_id is distinct from p_organization_id
    or target_merged_into_id is not null
    or (
      source_merged_into_id is not null
      and not (is_replay and source_merged_into_id = p_target_guest_id)
    )
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'Guest merge access is required' using errcode = '42501';
  end if;

  tenant_wide := public.has_org_role(
    p_organization_id,
    array['owner', 'admin']::public.app_role[]
  );

  if not tenant_wide and (
    not public.has_capability(
      p_organization_id,
      p_location_id,
      'guest.manage',
      null
    )
    or not exists (
      select 1
      from public.guest_locations guest_location
      where guest_location.organization_id = p_organization_id
        and guest_location.guest_id = p_target_guest_id
        and guest_location.location_id = p_location_id
    )
    or (
      not is_replay
      and not exists (
        select 1
        from public.guest_locations guest_location
        where guest_location.organization_id = p_organization_id
          and guest_location.guest_id = p_source_guest_id
          and guest_location.location_id = p_location_id
      )
    )
    or exists (
      select 1
      from public.guest_locations guest_location
      where guest_location.organization_id = p_organization_id
        and guest_location.guest_id in (p_source_guest_id, p_target_guest_id)
        and not public.has_capability(
          p_organization_id,
          guest_location.location_id,
          'guest.manage',
          null
        )
    )
  ) then
    raise exception 'Guest merge access is required' using errcode = '42501';
  end if;

  saved_merge := public.merge_guests(
    p_request_id,
    p_source_guest_id,
    p_target_guest_id,
    p_match_score,
    p_reasons
  );
  return query
  select
    saved_merge.id,
    saved_merge.source_guest_id,
    saved_merge.target_guest_id,
    saved_merge.merged_at;
end
$$;

revoke all on function public.service_save_guest(
  uuid, uuid, uuid, uuid, text, text, text, text, text, date, boolean, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.service_add_guest_note(uuid, uuid, uuid, text, boolean)
from public, anon, authenticated, service_role;
revoke all on function public.service_record_guest_consent(
  uuid, uuid, uuid, uuid, text, public.consent_status, text
) from public, anon, authenticated, service_role;
revoke all on function public.service_merge_guests(
  uuid, uuid, uuid, uuid, uuid, numeric, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.service_save_guest(
  uuid, uuid, uuid, uuid, text, text, text, text, text, date, boolean, text, text, text
) to authenticated;
grant execute on function public.service_add_guest_note(uuid, uuid, uuid, text, boolean)
to authenticated;
grant execute on function public.service_record_guest_consent(
  uuid, uuid, uuid, uuid, text, public.consent_status, text
) to authenticated;
grant execute on function public.service_merge_guests(
  uuid, uuid, uuid, uuid, uuid, numeric, jsonb
) to authenticated;

comment on function public.service_save_guest(
  uuid, uuid, uuid, uuid, text, text, text, text, text, date, boolean, text, text, text
) is 'Runs the existing idempotent guest command in one exact authorized location, links new profiles to that location, and returns only its fixed operational result DTO.';
comment on function public.service_add_guest_note(uuid, uuid, uuid, text, boolean) is
  'Requires exact linked guest.manage plus sensitive-note capability before appending a location-owned note, and never returns note text or sensitivity to the browser.';
comment on function public.service_record_guest_consent(
  uuid, uuid, uuid, uuid, text, public.consent_status, text
) is
  'Requires exact linked guest.manage before recording consent and returns only immutable event identity and capture time.';
comment on function public.service_merge_guests(
  uuid, uuid, uuid, uuid, uuid, numeric, jsonb
) is
  'Requires exact linked guest.manage and capability across every affected guest location before an atomic merge, returning only immutable merge identity.';
