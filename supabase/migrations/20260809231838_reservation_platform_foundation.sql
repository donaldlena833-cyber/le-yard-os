-- Le Yard OS: first-party reservation platform foundation.
--
-- The existing reservations table remains the guest-history anchor. This
-- migration adds location-owned floor inventory, effective-dated service
-- policy, atomic allocation workflows, public-booking custody, waitlist
-- evidence, delivery outbox state, and private realtime broadcasts.

create extension if not exists btree_gist with schema extensions;

insert into public.capability_definitions (
  capability_key, domain, label, description
)
values
  ('reservations.view', 'service', 'View reservations', 'View the live reservation book, floor, and waitlist at assigned locations.'),
  ('reservations.operate', 'service', 'Operate reservations', 'Create and update reservations, walk-ins, seating, table assignments, and waitlist records.'),
  ('reservations.override', 'service', 'Override reservation constraints', 'Override suggested table placement and operational pacing with recorded human evidence.'),
  ('reservations.configure', 'service', 'Configure reservations', 'Configure approved reservation rules, service periods, dining areas, tables, and combinations.')
on conflict (capability_key) do update
set domain = excluded.domain,
    label = excluded.label,
    description = excluded.description,
    is_active = true,
    updated_at = clock_timestamp();

alter table public.reservations
  drop constraint if exists reservations_status_check,
  drop constraint if exists reservations_source_check;

alter table public.reservations
  add column if not exists duration_minutes integer,
  add column if not exists public_code text,
  add column if not exists booking_channel text not null default 'staff',
  add column if not exists version integer not null default 1,
  add column if not exists confirmed_at timestamptz,
  add column if not exists arrived_at timestamptz,
  add column if not exists seated_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.reservations
  add constraint reservations_status_check check (
    status in (
      'booked', 'confirmed', 'arrived', 'seated',
      'completed', 'cancelled', 'no_show'
    )
  ),
  add constraint reservations_source_check check (
    source in (
      'manual', 'resy', 'import', 'other', 'le_yard_web',
      'phone', 'walk_in'
    )
  ),
  add constraint reservations_duration_check check (
    duration_minutes is null or duration_minutes between 15 and 720
  ),
  add constraint reservations_public_code_check check (
    public_code is null or public_code ~ '^[A-Z0-9]{6,12}$'
  ),
  add constraint reservations_booking_channel_check check (
    booking_channel in ('staff', 'web', 'phone', 'walk_in', 'import', 'partner')
  ),
  add constraint reservations_version_check check (version > 0),
  add constraint reservations_cancellation_reason_check check (
    cancellation_reason is null or length(btrim(cancellation_reason)) between 1 and 1000
  );

create unique index if not exists reservations_public_code_unique
on public.reservations (organization_id, public_code)
where public_code is not null;

create table public.reservation_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  online_booking_enabled boolean not null default false,
  guest_messaging_enabled boolean not null default false,
  verification_channels text[] not null default '{}'::text[]
    check (
      verification_channels <@ array['email', 'sms']::text[]
      and cardinality(verification_channels) <= 2
    ),
  staff_push_enabled boolean not null default false,
  verification_hold_minutes integer not null default 10
    check (verification_hold_minutes between 5 and 30),
  booking_horizon_days integer check (booking_horizon_days between 1 and 365),
  minimum_lead_minutes integer check (minimum_lead_minutes between 0 and 10080),
  slot_interval_minutes integer check (slot_interval_minutes in (5, 10, 15, 20, 30, 60)),
  max_online_party_size integer check (max_online_party_size between 1 and 100),
  modification_cutoff_minutes integer check (modification_cutoff_minutes between 0 and 10080),
  cancellation_cutoff_minutes integer check (cancellation_cutoff_minutes between 0 and 10080),
  reminder_schedule_minutes integer[] not null default array[1440, 120]::integer[],
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, location_id),
  unique (organization_id, id),
  check (
    not online_booking_enabled or (
      approved_at is not null
      and guest_messaging_enabled
      and cardinality(verification_channels) > 0
      and booking_horizon_days is not null
      and minimum_lead_minutes is not null
      and slot_interval_minutes is not null
      and max_online_party_size is not null
      and modification_cutoff_minutes is not null
      and cancellation_cutoff_minutes is not null
    )
  ),
  check (
    cardinality(reminder_schedule_minutes) <= 8
    and 0 <= all(reminder_schedule_minutes)
  )
);

create table public.dining_areas (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, location_id, name),
  unique (organization_id, id)
);

create table public.reservation_tables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  dining_area_id uuid,
  label text not null check (length(btrim(label)) between 1 and 40),
  min_capacity integer not null default 1 check (min_capacity > 0),
  max_capacity integer not null check (max_capacity > 0),
  position_x numeric(7,4) not null check (position_x between 0 and 1),
  position_y numeric(7,4) not null check (position_y between 0 and 1),
  width numeric(7,4) not null check (width > 0 and width <= 1),
  height numeric(7,4) not null check (height > 0 and height <= 1),
  rotation_degrees numeric(6,2) not null default 0
    check (rotation_degrees >= -360 and rotation_degrees <= 360),
  shape text not null default 'rectangle'
    check (shape in ('rectangle', 'round', 'oval', 'bar', 'banquette')),
  is_bookable boolean not null default true,
  is_active boolean not null default true,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, dining_area_id)
    references public.dining_areas(organization_id, id) on delete set null,
  unique (organization_id, location_id, label),
  unique (organization_id, id),
  check (max_capacity >= min_capacity),
  check (not is_bookable or approved_at is not null)
);

create table public.reservation_table_combinations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  label text not null check (length(btrim(label)) between 1 and 80),
  min_capacity integer not null check (min_capacity > 0),
  max_capacity integer not null check (max_capacity >= min_capacity),
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, location_id, label),
  unique (organization_id, id)
);

create table public.reservation_table_combination_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  combination_id uuid not null,
  table_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, combination_id)
    references public.reservation_table_combinations(organization_id, id) on delete cascade,
  foreign key (organization_id, table_id)
    references public.reservation_tables(organization_id, id) on delete cascade,
  unique (combination_id, table_id),
  unique (organization_id, id)
);

create table public.reservation_service_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  days_of_week integer[] not null,
  starts_local time not null,
  ends_local time not null,
  default_duration_minutes integer not null
    check (default_duration_minutes between 15 and 720),
  pacing_interval_minutes integer not null
    check (pacing_interval_minutes in (5, 10, 15, 20, 30, 60)),
  pacing_cover_limit integer not null check (pacing_cover_limit > 0),
  min_party_size integer not null default 1 check (min_party_size > 0),
  max_party_size integer not null check (max_party_size >= min_party_size),
  effective_from date not null,
  effective_to date,
  online_enabled boolean not null default false,
  is_active boolean not null default true,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check (days_of_week <@ array[0,1,2,3,4,5,6]::integer[]),
  check (cardinality(days_of_week) between 1 and 7),
  check (effective_to is null or effective_to >= effective_from),
  check (not online_enabled or approved_at is not null)
);

create table public.reservation_turn_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  service_period_id uuid not null,
  min_party_size integer not null check (min_party_size > 0),
  max_party_size integer not null check (max_party_size >= min_party_size),
  duration_minutes integer not null check (duration_minutes between 15 and 720),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, service_period_id)
    references public.reservation_service_periods(organization_id, id) on delete cascade,
  unique (service_period_id, min_party_size, max_party_size),
  unique (organization_id, id)
);

create table private.reservation_inventory_days (
  location_id uuid not null,
  business_date date not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (location_id, business_date)
);

revoke all on table private.reservation_inventory_days
from public, anon, authenticated;

create table public.reservation_table_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  reservation_id uuid,
  booking_hold_id uuid,
  table_id uuid not null,
  allocation_kind text not null
    check (allocation_kind in ('hold', 'assignment', 'block')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  allocation_range tstzrange generated always as (
    tstzrange(starts_at, ends_at, '[)')
  ) stored,
  expires_at timestamptz,
  is_active boolean not null default true,
  released_at timestamptz,
  released_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id)
    references public.reservations(organization_id, id) on delete cascade,
  foreign key (organization_id, table_id)
    references public.reservation_tables(organization_id, id) on delete restrict,
  unique (organization_id, id),
  check (ends_at > starts_at),
  check (
    (is_active and released_at is null)
    or (not is_active and released_at is not null)
  ),
  check (
    (allocation_kind = 'hold' and expires_at is not null)
    or (allocation_kind <> 'hold' and expires_at is null)
  ),
  check (
    (allocation_kind = 'hold' and reservation_id is null and booking_hold_id is not null)
    or (allocation_kind = 'assignment' and reservation_id is not null and booking_hold_id is null)
    or (allocation_kind = 'block' and reservation_id is null and booking_hold_id is null)
  ),
  constraint reservation_table_allocations_no_active_overlap
    exclude using gist (
      table_id with =,
      allocation_range with &&
    ) where (is_active)
    deferrable initially immediate
);

create index reservation_allocations_overlap_idx
on public.reservation_table_allocations (
  location_id, table_id, starts_at, ends_at
)
where is_active;

create table public.reservation_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  location_id uuid not null,
  reservation_id uuid not null,
  event_type text not null check (length(btrim(event_type)) between 1 and 80),
  from_status text,
  to_status text,
  note text check (note is null or length(btrim(note)) between 1 and 2000),
  actor_id uuid references auth.users(id) on delete set null,
  actor_kind text not null default 'staff'
    check (actor_kind in ('staff', 'guest', 'integration', 'system')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id)
    references public.reservations(organization_id, id) on delete cascade
);

create index reservation_events_reservation_time_idx
on public.reservation_events (reservation_id, occurred_at desc);

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  guest_id uuid,
  resulting_reservation_id uuid,
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  party_size integer not null check (party_size > 0),
  desired_from timestamptz,
  desired_to timestamptz,
  quoted_wait_minutes integer check (quoted_wait_minutes between 0 and 1440),
  status text not null default 'waiting'
    check (status in ('waiting', 'notified', 'accepted', 'seated', 'expired', 'cancelled')),
  notes text check (notes is null or length(btrim(notes)) between 1 and 2000),
  notified_at timestamptz,
  offer_expires_at timestamptz,
  seated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, guest_id)
    references public.guests(organization_id, id) on delete set null,
  foreign key (organization_id, resulting_reservation_id)
    references public.reservations(organization_id, id) on delete set null,
  unique (organization_id, id),
  check (desired_to is null or desired_from is null or desired_to >= desired_from)
);

create index waitlist_location_status_time_idx
on public.waitlist_entries (location_id, status, created_at);

create table public.table_status_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  location_id uuid not null,
  table_id uuid not null,
  reservation_id uuid,
  status text not null
    check (status in ('available', 'reserved_upcoming', 'occupied', 'needs_reset', 'blocked')),
  note text check (note is null or length(btrim(note)) between 1 and 1000),
  actor_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, table_id)
    references public.reservation_tables(organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id)
    references public.reservations(organization_id, id) on delete set null
);

create index table_status_events_current_idx
on public.table_status_events (table_id, occurred_at desc);

create table public.reservation_message_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  reservation_id uuid,
  booking_hold_id uuid,
  waitlist_entry_id uuid,
  guest_id uuid,
  channel text not null check (channel in ('email', 'sms', 'push')),
  template_key text not null check (length(btrim(template_key)) between 1 and 100),
  template_data jsonb not null default '{}'::jsonb check (jsonb_typeof(template_data) = 'object'),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled')),
  dedupe_key text not null check (length(btrim(dedupe_key)) between 1 and 240),
  provider_message_id text,
  attempts integer not null default 0 check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default clock_timestamp(),
  claim_token uuid,
  claimed_by uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id)
    references public.reservations(organization_id, id) on delete cascade,
  foreign key (organization_id, waitlist_entry_id)
    references public.waitlist_entries(organization_id, id) on delete cascade,
  foreign key (organization_id, guest_id)
    references public.guests(organization_id, id) on delete set null,
  unique (organization_id, dedupe_key),
  unique (organization_id, id),
  check (
    reservation_id is not null or booking_hold_id is not null
    or waitlist_entry_id is not null
  ),
  check (
    (status = 'sending' and claim_token is not null and claimed_by is not null
      and claimed_at is not null and lease_expires_at is not null)
    or (status <> 'sending' and claim_token is null and claimed_by is null
      and claimed_at is null and lease_expires_at is null)
  )
);

create index reservation_outbox_due_idx
on public.reservation_message_outbox (status, next_attempt_at, lease_expires_at, created_at)
where status in ('queued', 'failed', 'sending');

create table public.booking_api_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  name text not null check (length(btrim(name)) between 1 and 120),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_hint text not null check (length(btrim(key_hint)) between 4 and 24),
  scopes text[] not null default array['availability:read']::text[],
  allowed_origins text[] not null default '{}'::text[],
  is_active boolean not null default true,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check (scopes <@ array['availability:read', 'reservations:write']::text[]),
  check (cardinality(scopes) between 1 and 2)
);

create table private.public_booking_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  reservation_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_kind text not null check (token_kind = 'manage'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id)
    references public.reservations(organization_id, id) on delete cascade
);

create table private.public_booking_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  reservation_id uuid,
  reserved_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 15 and 720),
  party_size integer not null check (party_size between 1 and 100),
  special_requests text check (
    special_requests is null or length(special_requests) <= 5000
  ),
  public_code text not null check (public_code ~ '^[A-Z0-9]{6,12}$'),
  first_name text check (
    first_name is null or length(btrim(first_name)) between 1 and 120
  ),
  last_name text check (
    last_name is null or length(btrim(last_name)) between 1 and 120
  ),
  email text check (email is null or length(email) between 3 and 320),
  phone text check (phone is null or length(phone) between 7 and 24),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  verified_at timestamptz,
  expired_at timestamptz,
  cancelled_at timestamptz,
  redacted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id)
    references public.reservations(organization_id, id) on delete cascade,
  unique (organization_id, id),
  unique (reservation_id),
  check (
    (
      status = 'pending' and redacted_at is null
      and first_name is not null and last_name is not null
      and email is not null and phone is not null
    )
    or (
      status <> 'pending' and redacted_at is not null
      and first_name is null and last_name is null
      and email is null and phone is null and special_requests is null
    )
  ),
  check (redacted_at is null or redacted_at >= created_at),
  unique (organization_id, public_code),
  check (
    (status = 'pending' and verified_at is null and expired_at is null and cancelled_at is null)
    or (status = 'verified' and verified_at is not null and expired_at is null and cancelled_at is null)
    or (status = 'expired' and verified_at is null and expired_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and expired_at is null)
  )
);

alter table public.reservation_table_allocations
  add foreign key (organization_id, booking_hold_id)
  references private.public_booking_holds(organization_id, id) on delete cascade;

alter table public.reservation_message_outbox
  add foreign key (organization_id, booking_hold_id)
  references private.public_booking_holds(organization_id, id) on delete cascade;

create index public_booking_holds_expiry_idx
on private.public_booking_holds (expires_at, id)
where status = 'pending';

create table private.public_booking_management_exchanges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  reservation_id uuid not null,
  exchange_fingerprint text not null unique
    check (exchange_fingerprint ~ '^[0-9a-f]{64}$'),
  manage_token_hash text not null check (manage_token_hash ~ '^[0-9a-f]{64}$'),
  browser_binding_hash text not null
    check (browser_binding_hash ~ '^[0-9a-f]{64}$'),
  manage_expires_at timestamptz not null,
  consumed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, reservation_id)
    references public.reservations(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create table private.public_booking_verifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  booking_hold_id uuid not null,
  confirmation_fingerprint text not null unique
    check (confirmation_fingerprint ~ '^[0-9a-f]{64}$'),
  verified_channel text not null check (verified_channel in ('email', 'sms')),
  consumed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, booking_hold_id)
    references private.public_booking_holds(organization_id, id) on delete cascade,
  unique (organization_id, id),
  unique (booking_hold_id)
);

create table private.public_booking_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  reservation_id uuid,
  booking_hold_id uuid,
  operation_kind text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, reservation_id)
    references public.reservations(organization_id, id) on delete cascade
    deferrable initially deferred,
  foreign key (organization_id, booking_hold_id)
    references private.public_booking_holds(organization_id, id) on delete cascade
    deferrable initially deferred,
  check ((reservation_id is null) <> (booking_hold_id is null))
);

revoke all on table private.public_booking_tokens
from public, anon, authenticated;
revoke all on table private.public_booking_holds
from public, anon, authenticated;
revoke all on table private.public_booking_management_exchanges
from public, anon, authenticated;
revoke all on table private.public_booking_verifications
from public, anon, authenticated;
revoke all on table private.public_booking_requests
from public, anon, authenticated;

-- Every new exposed table is explicitly tenant/location scoped. Direct writes
-- remain unavailable to browser sessions; commands below own mutations.
do $reservation_rls$
declare table_name text;
begin
  foreach table_name in array array[
    'reservation_settings', 'dining_areas', 'reservation_tables',
    'reservation_table_combinations', 'reservation_table_combination_members',
    'reservation_service_periods', 'reservation_turn_rules',
    'reservation_table_allocations', 'reservation_events', 'waitlist_entries',
    'table_status_events', 'reservation_message_outbox', 'booking_api_clients'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
  end loop;
end
$reservation_rls$;

create policy reservation_settings_read
on public.reservation_settings for select to authenticated
using (public.has_any_capability(organization_id, location_id,
  array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']));

create policy dining_areas_read
on public.dining_areas for select to authenticated
using (public.has_any_capability(organization_id, location_id,
  array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']));

create policy reservation_tables_read
on public.reservation_tables for select to authenticated
using (public.has_any_capability(organization_id, location_id,
  array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']));

create policy reservation_combinations_read
on public.reservation_table_combinations for select to authenticated
using (public.has_any_capability(organization_id, location_id,
  array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']));

create policy reservation_combination_members_read
on public.reservation_table_combination_members for select to authenticated
using (
  exists (
    select 1
    from public.reservation_table_combinations combination
    where combination.organization_id = reservation_table_combination_members.organization_id
      and combination.id = reservation_table_combination_members.combination_id
      and public.has_any_capability(
        combination.organization_id, combination.location_id,
        array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']
      )
  )
);

create policy reservation_service_periods_read
on public.reservation_service_periods for select to authenticated
using (public.has_any_capability(organization_id, location_id,
  array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']));

create policy reservation_turn_rules_read
on public.reservation_turn_rules for select to authenticated
using (
  exists (
    select 1
    from public.reservation_service_periods period
    where period.organization_id = reservation_turn_rules.organization_id
      and period.id = reservation_turn_rules.service_period_id
      and public.has_any_capability(
        period.organization_id, period.location_id,
        array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']
      )
  )
);

create policy reservation_allocations_read
on public.reservation_table_allocations for select to authenticated
using (public.has_any_capability(organization_id, location_id,
  array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']));

create policy reservation_events_read
on public.reservation_events for select to authenticated
using (public.has_any_capability(organization_id, location_id,
  array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']));

create policy waitlist_entries_read
on public.waitlist_entries for select to authenticated
using (public.has_any_capability(organization_id, location_id,
  array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']));

create policy table_status_events_read
on public.table_status_events for select to authenticated
using (public.has_any_capability(organization_id, location_id,
  array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']));

create policy reservation_message_outbox_read
on public.reservation_message_outbox for select to authenticated
using (public.has_capability(organization_id, location_id, 'reservations.configure'));

drop policy if exists manager_location_read on public.reservations;
drop policy if exists manager_location_insert on public.reservations;
drop policy if exists manager_location_update on public.reservations;
drop policy if exists manager_location_delete on public.reservations;
revoke insert, update, delete on public.reservations from authenticated;
grant select on public.reservations to authenticated;

create policy reservation_capability_read
on public.reservations for select to authenticated
using (public.has_any_capability(organization_id, location_id,
  array['reservations.view', 'reservations.operate', 'reservations.override', 'reservations.configure']));

-- Retire the legacy management-role shortcut across CRM reads. Guest data is
-- capability-owned; reservation operators receive only the typed summary RPC.
do $guest_capability_rls$
declare table_name text;
begin
  -- A legacy FOR ALL write policy also participates in SELECT policy OR
  -- evaluation. Remove it entirely: capability-owned command functions are
  -- the CRM mutation boundary and direct-table grants must never reopen it.
  foreach table_name in array array[
    'guests', 'guest_locations', 'guest_contacts', 'guest_tags',
    'guest_tag_assignments', 'guest_notes', 'guest_consents',
    'guest_merge_events'
  ] loop
    execute format('drop policy if exists crm_manager_read on public.%I', table_name);
    execute format('drop policy if exists crm_manager_write on public.%I', table_name);
  end loop;

  -- The raw guest row and notes are management-only. A sensitive-notes grant
  -- may read the guest context needed to interpret those notes; reservation
  -- capabilities alone never authorize either table.
  foreach table_name in array array['guests', 'guest_notes'] loop
    execute format(
      'create policy guest_capability_read on public.%I for select to authenticated using (public.has_any_location_capability(organization_id, array[''guest.manage'', ''guest.sensitive_notes.view'']::text[]))',
      table_name
    );
  end loop;

  -- Contact, consent, tagging, location, and merge evidence is part of guest
  -- management, not the Host reservation read set.
  foreach table_name in array array[
    'guest_locations', 'guest_contacts', 'guest_tags',
    'guest_tag_assignments', 'guest_consents', 'guest_merge_events'
  ] loop
    execute format(
      'create policy guest_capability_read on public.%I for select to authenticated using (public.has_any_location_capability(organization_id, array[''guest.manage'']::text[]))',
      table_name
    );
  end loop;
end
$guest_capability_rls$;

drop policy if exists manager_location_read on public.guest_visits;
drop policy if exists manager_location_insert on public.guest_visits;
drop policy if exists manager_location_update on public.guest_visits;
drop policy if exists manager_location_delete on public.guest_visits;
create policy guest_visits_capability_read
on public.guest_visits for select to authenticated
using (public.has_any_capability(
  organization_id, location_id,
  array['guest.manage', 'guest.sensitive_notes.view']::text[]
));

-- Host-safe guest context is deliberately not implemented as another guests
-- table policy: a row policy cannot hide CRM contact, notes, or spend columns.
create function private.reservation_guest_summaries(
  p_organization_id uuid,
  p_location_id uuid,
  p_guest_ids uuid[]
)
returns table (
  id uuid,
  display_name text,
  vip boolean,
  visit_count integer
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  effective_on date;
begin
  select (statement_timestamp() at time zone location.timezone)::date
  into effective_on
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id
    and location.is_active;

  if actor_id is null
    or p_organization_id is null
    or p_location_id is null
    or p_guest_ids is null
    or cardinality(p_guest_ids) not between 1 and 100
    or not (
      private.user_has_capability(actor_id, p_organization_id, p_location_id, 'reservations.view', effective_on)
      or private.user_has_capability(actor_id, p_organization_id, p_location_id, 'reservations.operate', effective_on)
      or private.user_has_capability(actor_id, p_organization_id, p_location_id, 'reservations.override', effective_on)
      or private.user_has_capability(actor_id, p_organization_id, p_location_id, 'reservations.configure', effective_on)
    ) then
    raise exception 'Reservation guest-summary access is required'
      using errcode = '42501';
  end if;

  return query
  select guest.id, guest.display_name, guest.vip, guest.visit_count
  from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.id = any(p_guest_ids)
    and guest.merged_into_id is null
    and exists (
      select 1
      from public.reservations reservation
      where reservation.organization_id = p_organization_id
        and reservation.location_id = p_location_id
        and reservation.guest_id = guest.id
    );
end
$$;

create function public.service_reservation_guest_summaries(
  p_organization_id uuid,
  p_location_id uuid,
  p_guest_ids uuid[]
)
returns table (
  id uuid,
  display_name text,
  vip boolean,
  visit_count integer
)
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select *
  from private.reservation_guest_summaries(
    p_organization_id, p_location_id, p_guest_ids
  )
$$;

revoke all on function private.reservation_guest_summaries(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;
revoke all on function public.service_reservation_guest_summaries(uuid, uuid, uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.service_reservation_guest_summaries(uuid, uuid, uuid[])
to authenticated;

grant select on public.reservation_settings, public.dining_areas,
  public.reservation_tables, public.reservation_table_combinations,
  public.reservation_table_combination_members, public.reservation_service_periods,
  public.reservation_turn_rules, public.reservation_table_allocations,
  public.reservation_events, public.waitlist_entries, public.table_status_events,
  public.reservation_message_outbox
to authenticated;

grant select, insert, update, delete on public.reservation_settings,
  public.dining_areas, public.reservation_tables,
  public.reservation_table_combinations,
  public.reservation_table_combination_members,
  public.reservation_service_periods, public.reservation_turn_rules,
  public.reservation_table_allocations, public.reservation_events,
  public.waitlist_entries, public.table_status_events,
  public.reservation_message_outbox, public.booking_api_clients
to service_role;

grant usage, select on sequence public.reservation_events_id_seq,
  public.table_status_events_id_seq
to service_role;

-- Configuration changes are command-only and exact-replay protected.
create function public.configure_reservation_location(
  p_request_id uuid,
  p_location_id uuid,
  p_command text,
  p_payload jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  organization_uuid uuid;
  clean_command text := lower(btrim(p_command));
  result_id uuid := coalesce(nullif(p_payload ->> 'id', '')::uuid, p_request_id);
  replayed boolean := false;
  settings_row public.reservation_settings%rowtype;
  area_row public.dining_areas%rowtype;
  table_row public.reservation_tables%rowtype;
  period_row public.reservation_service_periods%rowtype;
begin
  if actor_id is null or p_request_id is null or p_location_id is null
    or clean_command is null or p_payload is null
    or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A valid reservation configuration request is required'
      using errcode = '22023';
  end if;

  select location.organization_id into organization_uuid
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if organization_uuid is null then
    raise exception 'Location not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    organization_uuid, p_location_id, 'reservations.configure'
  ) then
    raise exception 'Reservation configuration access is required'
      using errcode = '42501';
  end if;

  if not private.claim_operation_request(
    p_request_id,
    'reservation.configure.' || clean_command,
    organization_uuid,
    p_location_id,
    result_id,
    p_payload
  ) then
    replayed := true;
  else
    if clean_command = 'settings.save' then
      insert into public.reservation_settings (
        id, organization_id, location_id, online_booking_enabled,
        guest_messaging_enabled, verification_channels, staff_push_enabled,
        verification_hold_minutes, booking_horizon_days,
        minimum_lead_minutes, slot_interval_minutes,
        max_online_party_size, modification_cutoff_minutes,
        cancellation_cutoff_minutes, reminder_schedule_minutes,
        approved_at, approved_by
      ) values (
        result_id, organization_uuid, p_location_id,
        coalesce((p_payload ->> 'onlineBookingEnabled')::boolean, false),
        coalesce((p_payload ->> 'guestMessagingEnabled')::boolean, false),
        coalesce(
          array(
            select value
            from jsonb_array_elements_text(
              coalesce(p_payload -> 'verificationChannels', '[]'::jsonb)
            ) value
          ),
          '{}'::text[]
        ),
        coalesce((p_payload ->> 'staffPushEnabled')::boolean, false),
        coalesce((p_payload ->> 'verificationHoldMinutes')::integer, 10),
        nullif(p_payload ->> 'bookingHorizonDays', '')::integer,
        nullif(p_payload ->> 'minimumLeadMinutes', '')::integer,
        nullif(p_payload ->> 'slotIntervalMinutes', '')::integer,
        nullif(p_payload ->> 'maxOnlinePartySize', '')::integer,
        nullif(p_payload ->> 'modificationCutoffMinutes', '')::integer,
        nullif(p_payload ->> 'cancellationCutoffMinutes', '')::integer,
        coalesce(
          array(
            select value::integer
            from jsonb_array_elements_text(
              coalesce(p_payload -> 'reminderScheduleMinutes', '[1440,120]'::jsonb)
            ) value
          ),
          array[1440,120]::integer[]
        ),
        case when coalesce((p_payload ->> 'approved')::boolean, false)
          then clock_timestamp() else null end,
        case when coalesce((p_payload ->> 'approved')::boolean, false)
          then actor_id else null end
      )
      on conflict (organization_id, location_id) do update
      set online_booking_enabled = excluded.online_booking_enabled,
          guest_messaging_enabled = excluded.guest_messaging_enabled,
          verification_channels = excluded.verification_channels,
          staff_push_enabled = excluded.staff_push_enabled,
          verification_hold_minutes = excluded.verification_hold_minutes,
          booking_horizon_days = excluded.booking_horizon_days,
          minimum_lead_minutes = excluded.minimum_lead_minutes,
          slot_interval_minutes = excluded.slot_interval_minutes,
          max_online_party_size = excluded.max_online_party_size,
          modification_cutoff_minutes = excluded.modification_cutoff_minutes,
          cancellation_cutoff_minutes = excluded.cancellation_cutoff_minutes,
          reminder_schedule_minutes = excluded.reminder_schedule_minutes,
          approved_at = excluded.approved_at,
          approved_by = excluded.approved_by,
          updated_at = clock_timestamp()
      returning * into settings_row;
      result_id := settings_row.id;
    elsif clean_command = 'area.save' then
      insert into public.dining_areas (
        id, organization_id, location_id, name, sort_order, is_active
      ) values (
        result_id, organization_uuid, p_location_id,
        btrim(p_payload ->> 'name'),
        coalesce((p_payload ->> 'sortOrder')::integer, 0),
        coalesce((p_payload ->> 'isActive')::boolean, true)
      )
      on conflict (organization_id, id) do update
      set name = excluded.name,
          sort_order = excluded.sort_order,
          is_active = excluded.is_active,
          updated_at = clock_timestamp()
      returning * into area_row;
    elsif clean_command = 'table.save' then
      insert into public.reservation_tables (
        id, organization_id, location_id, dining_area_id, label,
        min_capacity, max_capacity, position_x, position_y,
        width, height, rotation_degrees, shape, is_bookable,
        is_active, approved_at, approved_by
      ) values (
        result_id, organization_uuid, p_location_id,
        nullif(p_payload ->> 'diningAreaId', '')::uuid,
        btrim(p_payload ->> 'label'),
        coalesce((p_payload ->> 'minCapacity')::integer, 1),
        (p_payload ->> 'maxCapacity')::integer,
        (p_payload ->> 'positionX')::numeric,
        (p_payload ->> 'positionY')::numeric,
        (p_payload ->> 'width')::numeric,
        (p_payload ->> 'height')::numeric,
        coalesce((p_payload ->> 'rotationDegrees')::numeric, 0),
        coalesce(nullif(p_payload ->> 'shape', ''), 'rectangle'),
        coalesce((p_payload ->> 'isBookable')::boolean, false),
        coalesce((p_payload ->> 'isActive')::boolean, true),
        case when coalesce((p_payload ->> 'approved')::boolean, false)
          then clock_timestamp() else null end,
        case when coalesce((p_payload ->> 'approved')::boolean, false)
          then actor_id else null end
      )
      on conflict (organization_id, id) do update
      set dining_area_id = excluded.dining_area_id,
          label = excluded.label,
          min_capacity = excluded.min_capacity,
          max_capacity = excluded.max_capacity,
          position_x = excluded.position_x,
          position_y = excluded.position_y,
          width = excluded.width,
          height = excluded.height,
          rotation_degrees = excluded.rotation_degrees,
          shape = excluded.shape,
          is_bookable = excluded.is_bookable,
          is_active = excluded.is_active,
          approved_at = excluded.approved_at,
          approved_by = excluded.approved_by,
          updated_at = clock_timestamp()
      returning * into table_row;
    elsif clean_command = 'service_period.save' then
      insert into public.reservation_service_periods (
        id, organization_id, location_id, name, days_of_week,
        starts_local, ends_local, default_duration_minutes,
        pacing_interval_minutes, pacing_cover_limit,
        min_party_size, max_party_size, effective_from, effective_to,
        online_enabled, is_active, approved_at, approved_by
      ) values (
        result_id, organization_uuid, p_location_id,
        btrim(p_payload ->> 'name'),
        array(
          select value::integer
          from jsonb_array_elements_text(p_payload -> 'daysOfWeek') value
        ),
        (p_payload ->> 'startsLocal')::time,
        (p_payload ->> 'endsLocal')::time,
        (p_payload ->> 'defaultDurationMinutes')::integer,
        (p_payload ->> 'pacingIntervalMinutes')::integer,
        (p_payload ->> 'pacingCoverLimit')::integer,
        coalesce((p_payload ->> 'minPartySize')::integer, 1),
        (p_payload ->> 'maxPartySize')::integer,
        (p_payload ->> 'effectiveFrom')::date,
        nullif(p_payload ->> 'effectiveTo', '')::date,
        coalesce((p_payload ->> 'onlineEnabled')::boolean, false),
        coalesce((p_payload ->> 'isActive')::boolean, true),
        case when coalesce((p_payload ->> 'approved')::boolean, false)
          then clock_timestamp() else null end,
        case when coalesce((p_payload ->> 'approved')::boolean, false)
          then actor_id else null end
      )
      on conflict (organization_id, id) do update
      set name = excluded.name,
          days_of_week = excluded.days_of_week,
          starts_local = excluded.starts_local,
          ends_local = excluded.ends_local,
          default_duration_minutes = excluded.default_duration_minutes,
          pacing_interval_minutes = excluded.pacing_interval_minutes,
          pacing_cover_limit = excluded.pacing_cover_limit,
          min_party_size = excluded.min_party_size,
          max_party_size = excluded.max_party_size,
          effective_from = excluded.effective_from,
          effective_to = excluded.effective_to,
          online_enabled = excluded.online_enabled,
          is_active = excluded.is_active,
          approved_at = excluded.approved_at,
          approved_by = excluded.approved_by,
          updated_at = clock_timestamp()
      returning * into period_row;
    else
      raise exception 'Unsupported reservation configuration command'
        using errcode = '22023';
    end if;
    perform private.complete_operation_request(p_request_id);
  end if;

  return jsonb_build_object(
    'id', result_id,
    'command', clean_command,
    'replayed', replayed
  );
end
$$;

create function private.lock_reservation_inventory_many(
  p_location_id uuid,
  p_starts_at timestamptz[]
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  business_date date;
  location_timezone text;
begin
  if p_location_id is null or p_starts_at is null
    or cardinality(p_starts_at) not between 1 and 32
    or exists (select 1 from unnest(p_starts_at) starts_at where starts_at is null) then
    raise exception 'Valid reservation inventory lock keys are required'
      using errcode = '22023';
  end if;
  select location.timezone into location_timezone
  from public.locations location
  where location.id = p_location_id;
  if location_timezone is null then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;

  -- Every command locks the same location/business-date keys in ascending
  -- order, including moves that cross local dates, to prevent deadlocks.
  for business_date in
    select distinct (starts_at at time zone location_timezone)::date
    from unnest(p_starts_at) starts_at
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'reservation-inventory:' || p_location_id::text || ':' || business_date::text,
      0
    ));
    insert into private.reservation_inventory_days (location_id, business_date)
    values (p_location_id, business_date)
    on conflict do nothing;
  end loop;
end
$$;

create function private.lock_reservation_inventory(
  p_location_id uuid,
  p_starts_at timestamptz
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  perform private.lock_reservation_inventory_many(
    p_location_id, array[p_starts_at]::timestamptz[]
  );
end
$$;

create function private.assert_reservation_tables_available(
  p_organization_id uuid,
  p_location_id uuid,
  p_reservation_id uuid,
  p_table_ids uuid[],
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_party_size integer
)
returns void
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  table_count integer;
  total_capacity integer;
  combination_matches boolean;
begin
  if p_table_ids is null or cardinality(p_table_ids) < 1
    or cardinality(p_table_ids) > 8
    or cardinality(p_table_ids) <> cardinality(array(select distinct unnest(p_table_ids))) then
    raise exception 'Choose one valid table set' using errcode = '22023';
  end if;

  select count(*), sum(table_row.max_capacity)
  into table_count, total_capacity
  from public.reservation_tables table_row
  where table_row.organization_id = p_organization_id
    and table_row.location_id = p_location_id
    and table_row.id = any(p_table_ids)
    and table_row.is_active
    and table_row.is_bookable
    and table_row.approved_at is not null
    and coalesce((
      select status_event.status
      from public.table_status_events status_event
      where status_event.organization_id = table_row.organization_id
        and status_event.table_id = table_row.id
      order by status_event.occurred_at desc, status_event.id desc
      limit 1
    ), 'available') <> 'blocked';
  if table_count <> cardinality(p_table_ids) or total_capacity < p_party_size then
    raise exception 'The selected table set cannot seat this party'
      using errcode = '23514';
  end if;

  if cardinality(p_table_ids) > 1 then
    select exists (
      select 1
      from public.reservation_table_combinations combination
      where combination.organization_id = p_organization_id
        and combination.location_id = p_location_id
        and combination.is_active
        and combination.max_capacity >= p_party_size
        and (
          select array_agg(member.table_id order by member.table_id)
          from public.reservation_table_combination_members member
          where member.organization_id = combination.organization_id
            and member.combination_id = combination.id
        ) = (
          select array_agg(value order by value)
          from unnest(p_table_ids) value
        )
    ) into combination_matches;
    if not combination_matches then
      raise exception 'The selected tables are not an approved combination'
        using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1
    from public.reservation_table_allocations allocation
    where allocation.organization_id = p_organization_id
      and allocation.location_id = p_location_id
      and allocation.table_id = any(p_table_ids)
      and allocation.is_active
      and (allocation.expires_at is null or allocation.expires_at > clock_timestamp())
      and allocation.reservation_id is distinct from p_reservation_id
      and allocation.starts_at < p_ends_at
      and allocation.ends_at > p_starts_at
  ) then
    raise exception 'The selected table is no longer available'
      using errcode = '23P01';
  end if;
end
$$;

create function public.save_reservation(
  p_request_id uuid,
  p_location_id uuid,
  p_reservation_id uuid,
  p_guest_id uuid,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_special_requests text,
  p_source text,
  p_table_ids uuid[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  organization_uuid uuid;
  result_id uuid := coalesce(p_reservation_id, p_request_id);
  prior public.reservations%rowtype;
  reservation_row public.reservations%rowtype;
  resolved_reserved_at timestamptz;
  end_at timestamptz;
  replayed boolean := false;
  table_id uuid;
begin
  if actor_id is null or p_request_id is null or p_location_id is null
    or result_id is null or p_reserved_at is null
    or p_duration_minutes not between 15 and 720
    or p_party_size not between 1 and 100
    or p_source not in ('manual', 'phone', 'walk_in')
    or p_table_ids is null or cardinality(p_table_ids) > 8
    or length(coalesce(p_special_requests, '')) > 5000 then
    raise exception 'A valid reservation is required' using errcode = '22023';
  end if;
  select location.organization_id into organization_uuid
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if organization_uuid is null then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    organization_uuid, p_location_id, 'reservations.operate'
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  if p_guest_id is not null and not exists (
    select 1 from public.guests guest
    where guest.organization_id = organization_uuid
      and guest.id = p_guest_id
      and guest.merged_into_id is null
  ) then
    raise exception 'Active guest not found' using errcode = 'P0002';
  end if;

  end_at := p_reserved_at + make_interval(mins => p_duration_minutes);
  select * into prior from public.reservations reservation
  where reservation.organization_id = organization_uuid
    and reservation.id = result_id;
  resolved_reserved_at := prior.reserved_at;
  perform private.lock_reservation_inventory_many(
    p_location_id,
    case when resolved_reserved_at is null
      then array[p_reserved_at]::timestamptz[]
      else array[resolved_reserved_at, p_reserved_at]::timestamptz[]
    end
  );
  perform private.expire_public_booking_holds(
    organization_uuid, p_location_id, clock_timestamp(), 1000, p_reserved_at
  );
  if resolved_reserved_at is not null then
    perform private.expire_public_booking_holds(
      organization_uuid, p_location_id, clock_timestamp(), 1000,
      resolved_reserved_at
    );
  end if;
  if cardinality(p_table_ids) > 0 then
    perform private.assert_reservation_tables_available(
      organization_uuid, p_location_id, result_id, p_table_ids,
      p_reserved_at, end_at, p_party_size
    );
  end if;

  if not private.claim_operation_request(
    p_request_id, 'reservation.save', organization_uuid, p_location_id,
    result_id,
    jsonb_build_object(
      'guestId', p_guest_id, 'reservedAt', p_reserved_at,
      'durationMinutes', p_duration_minutes, 'partySize', p_party_size,
      'specialRequests', nullif(btrim(p_special_requests), ''),
      'source', p_source, 'tableIds', p_table_ids
    )
  ) then
    replayed := true;
  else
    select * into prior from public.reservations reservation
    where reservation.organization_id = organization_uuid
      and reservation.id = result_id
    for update;
    if (resolved_reserved_at is null and prior.id is not null)
      or (resolved_reserved_at is not null and (
        prior.id is null or prior.reserved_at <> resolved_reserved_at
      )) then
      raise exception 'Reservation changed concurrently; retry the request'
        using errcode = '40001';
    end if;
    if prior.id is null then
      insert into public.reservations (
        id, organization_id, location_id, guest_id, reserved_at,
        duration_minutes, party_size, status, special_requests,
        source, booking_channel, public_code, created_by
      ) values (
        result_id, organization_uuid, p_location_id, p_guest_id,
        p_reserved_at, p_duration_minutes, p_party_size, 'booked',
        nullif(btrim(p_special_requests), ''), p_source,
        case p_source when 'walk_in' then 'walk_in' when 'phone' then 'phone' else 'staff' end,
        upper(substr(encode(extensions.digest(result_id::text, 'sha256'), 'hex'), 1, 10)), actor_id
      ) returning * into reservation_row;
      insert into public.reservation_events (
        organization_id, location_id, reservation_id, event_type,
        to_status, actor_id, actor_kind
      ) values (
        organization_uuid, p_location_id, result_id, 'created',
        'booked', actor_id, 'staff'
      );
    else
      if prior.location_id <> p_location_id
        or prior.status in ('completed', 'cancelled', 'no_show') then
        raise exception 'This reservation cannot be changed'
          using errcode = '23514';
      end if;
      update public.reservations reservation
      set guest_id = p_guest_id,
          reserved_at = p_reserved_at,
          duration_minutes = p_duration_minutes,
          party_size = p_party_size,
          special_requests = nullif(btrim(p_special_requests), ''),
          version = reservation.version + 1,
          updated_at = clock_timestamp()
      where reservation.id = result_id
      returning * into reservation_row;
      insert into public.reservation_events (
        organization_id, location_id, reservation_id, event_type,
        from_status, to_status, actor_id, actor_kind
      ) values (
        organization_uuid, p_location_id, result_id, 'updated',
        prior.status, prior.status, actor_id, 'staff'
      );
    end if;

    update public.reservation_table_allocations allocation
    set is_active = false,
        released_at = clock_timestamp(),
        released_by = actor_id,
        updated_at = clock_timestamp()
    where allocation.organization_id = organization_uuid
      and allocation.reservation_id = result_id
      and allocation.is_active;
    foreach table_id in array p_table_ids loop
      insert into public.reservation_table_allocations (
        organization_id, location_id, reservation_id, table_id,
        allocation_kind, starts_at, ends_at, created_by
      ) values (
        organization_uuid, p_location_id, result_id, table_id,
        'assignment', p_reserved_at, end_at, actor_id
      );
    end loop;
    perform private.complete_operation_request(p_request_id);
  end if;

  if replayed then
    select * into reservation_row from public.reservations reservation
    where reservation.organization_id = organization_uuid
      and reservation.id = result_id;
  end if;
  if reservation_row.id is null then
    raise exception 'Reservation request has no result row' using errcode = '40001';
  end if;
  return jsonb_build_object(
    'id', reservation_row.id,
    'status', reservation_row.status,
    'version', reservation_row.version,
    'replayed', replayed
  );
end
$$;

create function public.transition_reservation(
  p_request_id uuid,
  p_reservation_id uuid,
  p_target_status text,
  p_note text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  reservation_row public.reservations%rowtype;
  resolved_reserved_at timestamptz;
  prior_status text;
  allowed boolean := false;
begin
  if actor_id is null or p_request_id is null or p_reservation_id is null
    or p_target_status is null or length(coalesce(p_note, '')) > 2000 then
    raise exception 'A valid reservation transition is required'
      using errcode = '22023';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.id = p_reservation_id;
  if reservation_row.id is null then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    reservation_row.organization_id,
    reservation_row.location_id,
    'reservations.operate'
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  resolved_reserved_at := reservation_row.reserved_at;
  perform private.lock_reservation_inventory(
    reservation_row.location_id, resolved_reserved_at
  );
  perform private.expire_public_booking_holds(
    reservation_row.organization_id, reservation_row.location_id,
    clock_timestamp(), 1000, resolved_reserved_at
  );
  select * into reservation_row from public.reservations reservation
  where reservation.id = p_reservation_id for update;
  if reservation_row.id is null
    or reservation_row.reserved_at <> resolved_reserved_at then
    raise exception 'Reservation changed concurrently; retry the request'
      using errcode = '40001';
  end if;
  prior_status := reservation_row.status;
  allowed := case prior_status
    when 'booked' then p_target_status in ('confirmed', 'arrived', 'seated', 'cancelled', 'no_show')
    when 'confirmed' then p_target_status in ('arrived', 'seated', 'cancelled', 'no_show')
    when 'arrived' then p_target_status in ('seated', 'cancelled', 'no_show')
    when 'seated' then p_target_status in ('completed')
    else false
  end;
  if not allowed then
    if prior_status = p_target_status then
      return jsonb_build_object(
        'id', reservation_row.id,
        'status', reservation_row.status,
        'version', reservation_row.version,
        'replayed', true
      );
    end if;
    raise exception 'Reservation status transition is not allowed'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id, 'reservation.transition', reservation_row.organization_id,
    reservation_row.location_id, reservation_row.id,
    jsonb_build_object('targetStatus', p_target_status, 'note', nullif(btrim(p_note), ''))
  ) then
    return jsonb_build_object(
      'id', reservation_row.id,
      'status', reservation_row.status,
      'version', reservation_row.version,
      'replayed', true
    );
  end if;

  update public.reservations reservation
  set status = p_target_status,
      version = reservation.version + 1,
      confirmed_at = case when p_target_status = 'confirmed' then clock_timestamp() else reservation.confirmed_at end,
      arrived_at = case when p_target_status = 'arrived' then clock_timestamp() else reservation.arrived_at end,
      seated_at = case when p_target_status = 'seated' then clock_timestamp() else reservation.seated_at end,
      completed_at = case when p_target_status = 'completed' then clock_timestamp() else reservation.completed_at end,
      cancelled_at = case when p_target_status in ('cancelled', 'no_show') then clock_timestamp() else reservation.cancelled_at end,
      cancellation_reason = case when p_target_status = 'cancelled' then nullif(btrim(p_note), '') else reservation.cancellation_reason end,
      updated_at = clock_timestamp()
  where reservation.id = p_reservation_id
  returning * into reservation_row;

  if p_target_status in ('seated', 'completed', 'cancelled', 'no_show') then
    insert into public.table_status_events (
      organization_id, location_id, table_id, reservation_id,
      status, note, actor_id
    )
    select
      reservation_row.organization_id,
      reservation_row.location_id,
      allocation.table_id,
      reservation_row.id,
      case
        when p_target_status = 'seated' then 'occupied'
        when p_target_status = 'completed' then 'needs_reset'
        else 'available'
      end,
      'Reservation moved to ' || p_target_status,
      actor_id
    from public.reservation_table_allocations allocation
    where allocation.reservation_id = reservation_row.id
      and allocation.is_active;
  end if;

  if p_target_status in ('completed', 'cancelled', 'no_show') then
    update public.reservation_table_allocations allocation
    set is_active = false,
        released_at = clock_timestamp(),
        released_by = actor_id,
        updated_at = clock_timestamp()
    where allocation.reservation_id = p_reservation_id
      and allocation.is_active;
  end if;
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, note, actor_id, actor_kind
  ) values (
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, 'status_changed', prior_status, p_target_status,
    nullif(btrim(p_note), ''), actor_id, 'staff'
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'id', reservation_row.id,
    'status', reservation_row.status,
    'version', reservation_row.version,
    'replayed', false
  );
end
$$;

create function public.assign_reservation_tables(
  p_request_id uuid,
  p_reservation_id uuid,
  p_table_ids uuid[],
  p_override_note text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  reservation_row public.reservations%rowtype;
  resolved_reserved_at timestamptz;
  end_at timestamptz;
  table_id uuid;
begin
  if actor_id is null or p_request_id is null or p_reservation_id is null
    or length(coalesce(p_override_note, '')) > 2000 then
    raise exception 'A valid table assignment is required' using errcode = '22023';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.id = p_reservation_id;
  if reservation_row.id is null then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;
  if reservation_row.status in ('completed', 'cancelled', 'no_show') then
    raise exception 'Terminal reservations cannot be reassigned' using errcode = '23514';
  end if;
  if not public.has_capability(
    reservation_row.organization_id,
    reservation_row.location_id,
    'reservations.operate'
  ) then
    raise exception 'Reservation operating access is required' using errcode = '42501';
  end if;
  if p_override_note is not null and not public.has_capability(
    reservation_row.organization_id,
    reservation_row.location_id,
    'reservations.override'
  ) then
    raise exception 'Reservation override access is required' using errcode = '42501';
  end if;
  resolved_reserved_at := reservation_row.reserved_at;
  end_at := reservation_row.reserved_at
    + make_interval(mins => reservation_row.duration_minutes);
  perform private.lock_reservation_inventory(
    reservation_row.location_id, resolved_reserved_at
  );
  perform private.expire_public_booking_holds(
    reservation_row.organization_id, reservation_row.location_id,
    clock_timestamp(), 1000, resolved_reserved_at
  );
  select * into reservation_row from public.reservations reservation
  where reservation.id = p_reservation_id for update;
  if reservation_row.id is null
    or reservation_row.reserved_at <> resolved_reserved_at then
    raise exception 'Reservation changed concurrently; retry the request'
      using errcode = '40001';
  end if;
  end_at := reservation_row.reserved_at
    + make_interval(mins => reservation_row.duration_minutes);
  perform private.assert_reservation_tables_available(
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, p_table_ids, reservation_row.reserved_at,
    end_at, reservation_row.party_size
  );
  if not private.claim_operation_request(
    p_request_id, 'reservation.assign_tables', reservation_row.organization_id,
    reservation_row.location_id, reservation_row.id,
    jsonb_build_object('tableIds', p_table_ids, 'overrideNote', nullif(btrim(p_override_note), ''))
  ) then
    return jsonb_build_object(
      'id', reservation_row.id,
      'version', reservation_row.version,
      'replayed', true
    );
  end if;
  update public.reservation_table_allocations allocation
  set is_active = false,
      released_at = clock_timestamp(),
      released_by = actor_id,
      updated_at = clock_timestamp()
  where allocation.reservation_id = reservation_row.id
    and allocation.is_active;
  foreach table_id in array p_table_ids loop
    insert into public.reservation_table_allocations (
      organization_id, location_id, reservation_id, table_id,
      allocation_kind, starts_at, ends_at, created_by
    ) values (
      reservation_row.organization_id, reservation_row.location_id,
      reservation_row.id, table_id, 'assignment',
      reservation_row.reserved_at, end_at, actor_id
    );
  end loop;
  update public.reservations reservation
  set version = reservation.version + 1,
      updated_at = clock_timestamp()
  where reservation.id = reservation_row.id
  returning * into reservation_row;
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, note, actor_id, actor_kind, metadata
  ) values (
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, 'tables_assigned', reservation_row.status,
    reservation_row.status, nullif(btrim(p_override_note), ''), actor_id,
    'staff', jsonb_build_object('tableIds', p_table_ids)
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'id', reservation_row.id,
    'version', reservation_row.version,
    'replayed', false
  );
end
$$;

create function public.save_waitlist_entry(
  p_request_id uuid,
  p_location_id uuid,
  p_guest_id uuid,
  p_display_name text,
  p_party_size integer,
  p_desired_from timestamptz,
  p_desired_to timestamptz,
  p_quoted_wait_minutes integer,
  p_notes text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  organization_uuid uuid;
  waitlist_row public.waitlist_entries%rowtype;
  replayed boolean := false;
begin
  if actor_id is null or p_request_id is null or p_location_id is null
    or length(btrim(coalesce(p_display_name, ''))) not between 1 and 160
    or p_party_size not between 1 and 100
    or p_quoted_wait_minutes not between 0 and 1440
    or length(coalesce(p_notes, '')) > 2000
    or (p_desired_to is not null and p_desired_from is not null and p_desired_to < p_desired_from) then
    raise exception 'A valid waitlist entry is required' using errcode = '22023';
  end if;
  select location.organization_id into organization_uuid
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if organization_uuid is null then
    raise exception 'Waitlist location not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    organization_uuid, p_location_id, 'reservations.operate'
  ) then
    raise exception 'Reservation operating access is required' using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id, 'waitlist.save', organization_uuid, p_location_id,
    p_request_id,
    jsonb_build_object(
      'guestId', p_guest_id, 'displayName', btrim(p_display_name),
      'partySize', p_party_size, 'desiredFrom', p_desired_from,
      'desiredTo', p_desired_to, 'quotedWaitMinutes', p_quoted_wait_minutes,
      'notes', nullif(btrim(p_notes), '')
    )
  ) then
    replayed := true;
  else
    insert into public.waitlist_entries (
      id, organization_id, location_id, guest_id, display_name,
      party_size, desired_from, desired_to, quoted_wait_minutes,
      notes, created_by
    ) values (
      p_request_id, organization_uuid, p_location_id, p_guest_id,
      btrim(p_display_name), p_party_size, p_desired_from, p_desired_to,
      p_quoted_wait_minutes, nullif(btrim(p_notes), ''), actor_id
    ) returning * into waitlist_row;
    perform private.complete_operation_request(p_request_id);
  end if;
  if replayed then
    select * into waitlist_row from public.waitlist_entries entry
    where entry.organization_id = organization_uuid and entry.id = p_request_id;
  end if;
  return jsonb_build_object(
    'id', waitlist_row.id,
    'status', waitlist_row.status,
    'replayed', replayed
  );
end
$$;

-- Service-only public booking commands. The Next.js API authenticates a
-- location-scoped hashed API client before invoking them with the secret key.
create function public.service_create_public_reservation(
  p_request_id uuid,
  p_location_id uuid,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_special_requests text,
  p_table_ids uuid[],
  p_confirmation_token_hash text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  organization_uuid uuid;
  settings_row public.reservation_settings%rowtype;
  guest_row public.guests%rowtype;
  reservation_row public.reservations%rowtype;
  prior_request private.public_booking_requests%rowtype;
  payload_hash text;
  end_at timestamptz;
  hold_expires_at timestamptz;
  clean_first_name text := nullif(btrim(p_first_name), '');
  clean_last_name text := nullif(btrim(p_last_name), '');
  clean_email text := lower(nullif(btrim(p_email), ''));
  clean_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  table_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_location_id is null or p_reserved_at is null
    or p_duration_minutes not between 15 and 720
    or p_party_size not between 1 and 100
    or clean_first_name is null or clean_last_name is null
    or clean_email is null or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or clean_phone is null or length(clean_phone) not between 7 and 24
    or length(coalesce(p_special_requests, '')) > 5000
    or p_confirmation_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid public reservation is required' using errcode = '22023';
  end if;
  select location.organization_id into organization_uuid
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if organization_uuid is null then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;
  select * into settings_row
  from public.reservation_settings setting
  where setting.organization_id = organization_uuid
    and setting.location_id = p_location_id
  for update;
  if settings_row.id is null or not settings_row.online_booking_enabled
    or settings_row.approved_at is null then
    raise exception 'Online booking is unavailable' using errcode = '42501';
  end if;
  if p_party_size > settings_row.max_online_party_size
    or p_reserved_at < clock_timestamp()
      + make_interval(mins => settings_row.minimum_lead_minutes)
    or p_reserved_at > clock_timestamp()
      + make_interval(days => settings_row.booking_horizon_days) then
    raise exception 'The requested time is outside online booking rules'
      using errcode = '23514';
  end if;

  payload_hash := encode(extensions.digest(jsonb_build_object(
    'locationId', p_location_id, 'reservedAt', p_reserved_at,
    'durationMinutes', p_duration_minutes, 'partySize', p_party_size,
    'firstName', clean_first_name, 'lastName', clean_last_name,
    'email', clean_email, 'phone', clean_phone,
    'specialRequests', nullif(btrim(p_special_requests), ''),
    'tableIds', p_table_ids
  )::text, 'sha256'), 'hex');
  select * into prior_request
  from private.public_booking_requests request
  where request.request_id = p_request_id
  for update;
  if prior_request.request_id is not null then
    if prior_request.organization_id = organization_uuid
      and prior_request.location_id = p_location_id
      and prior_request.operation_kind = 'public.reservation.create'
      and prior_request.payload_hash = payload_hash
      and prior_request.completed_at is not null then
      select * into reservation_row from public.reservations reservation
      where reservation.id = prior_request.reservation_id;
      return jsonb_build_object(
        'reservationId', reservation_row.id,
        'publicCode', reservation_row.public_code,
        'status', reservation_row.status,
        'holdExpiresAt', (
          select max(allocation.expires_at)
          from public.reservation_table_allocations allocation
          where allocation.reservation_id = reservation_row.id
            and allocation.is_active
        ),
        'replayed', true
      );
    end if;
    raise exception 'Idempotency key was reused' using errcode = '23505';
  end if;

  reservation_row.id := gen_random_uuid();
  insert into private.public_booking_requests (
    request_id, organization_id, location_id, reservation_id,
    operation_kind, payload_hash
  ) values (
    p_request_id, organization_uuid, p_location_id, reservation_row.id,
    'public.reservation.create', payload_hash
  );
  end_at := p_reserved_at + make_interval(mins => p_duration_minutes);
  hold_expires_at := clock_timestamp()
    + make_interval(mins => settings_row.verification_hold_minutes);
  perform private.lock_reservation_inventory(p_location_id, p_reserved_at);
  perform private.assert_reservation_tables_available(
    organization_uuid, p_location_id, reservation_row.id, p_table_ids,
    p_reserved_at, end_at, p_party_size
  );

  select * into guest_row from public.guests guest
  where guest.organization_id = organization_uuid
    and lower(guest.email) = clean_email
    and guest.merged_into_id is null
  limit 1;
  if guest_row.id is null then
    insert into public.guests (
      organization_id, first_name, last_name, display_name,
      email, phone, source, external_references
    ) values (
      organization_uuid, clean_first_name, clean_last_name,
      clean_first_name || ' ' || clean_last_name,
      clean_email, clean_phone, 'other',
      jsonb_build_object('le_yard_web', true)
    ) returning * into guest_row;
  end if;

  insert into public.reservations (
    id, organization_id, location_id, guest_id, reserved_at,
    duration_minutes, party_size, status, special_requests,
    source, booking_channel, public_code
  ) values (
    reservation_row.id, organization_uuid, p_location_id, guest_row.id,
    p_reserved_at, p_duration_minutes, p_party_size,
    'pending_verification', nullif(btrim(p_special_requests), ''),
    'le_yard_web', 'web',
    upper(substr(replace(reservation_row.id::text, '-', ''), 1, 8))
  ) returning * into reservation_row;
  foreach table_id in array p_table_ids loop
    insert into public.reservation_table_allocations (
      organization_id, location_id, reservation_id, table_id,
      allocation_kind, starts_at, ends_at, expires_at
    ) values (
      organization_uuid, p_location_id, reservation_row.id, table_id,
      'hold', p_reserved_at, end_at, hold_expires_at
    );
  end loop;
  insert into private.public_booking_tokens (
    organization_id, location_id, reservation_id, token_hash,
    token_kind, expires_at
  ) values (
    organization_uuid, p_location_id, reservation_row.id,
    p_confirmation_token_hash, 'confirmation', hold_expires_at
  );
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    to_status, actor_kind
  ) values (
    organization_uuid, p_location_id, reservation_row.id,
    'public_hold_created', 'pending_verification', 'guest'
  );
  if settings_row.guest_messaging_enabled then
    insert into public.reservation_message_outbox (
      organization_id, location_id, reservation_id, guest_id,
      channel, template_key, template_data, dedupe_key
    ) values
      (
        organization_uuid, p_location_id, reservation_row.id, guest_row.id,
        'email', 'reservation_verify',
        jsonb_build_object('publicCode', reservation_row.public_code),
        'reservation:' || reservation_row.id::text || ':verify:email'
      ),
      (
        organization_uuid, p_location_id, reservation_row.id, guest_row.id,
        'sms', 'reservation_verify',
        jsonb_build_object('publicCode', reservation_row.public_code),
        'reservation:' || reservation_row.id::text || ':verify:sms'
      );
  end if;
  update private.public_booking_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return jsonb_build_object(
    'reservationId', reservation_row.id,
    'publicCode', reservation_row.public_code,
    'status', reservation_row.status,
    'holdExpiresAt', hold_expires_at,
    'replayed', false
  );
end
$$;

create function public.service_confirm_public_reservation(
  p_confirmation_token_hash text,
  p_manage_token_hash text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  token_row private.public_booking_tokens%rowtype;
  reservation_row public.reservations%rowtype;
  manage_expires_at timestamptz;
  settings_row public.reservation_settings%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_confirmation_token_hash !~ '^[0-9a-f]{64}$'
    or p_manage_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid booking token is required' using errcode = '22023';
  end if;
  select * into token_row from private.public_booking_tokens token
  where token.token_hash = p_confirmation_token_hash
    and token.token_kind = 'confirmation'
  for update;
  if token_row.id is null then
    raise exception 'The confirmation link has expired' using errcode = '23514';
  end if;
  if token_row.consumed_at is not null then
    if exists (
      select 1 from private.public_booking_tokens manage_token
      where manage_token.reservation_id = token_row.reservation_id
        and manage_token.token_kind = 'manage'
        and manage_token.token_hash = p_manage_token_hash
        and manage_token.revoked_at is null
        and manage_token.expires_at > clock_timestamp()
    ) then
      select * into reservation_row from public.reservations reservation
      where reservation.id = token_row.reservation_id;
      return jsonb_build_object(
        'reservationId', reservation_row.id,
        'publicCode', reservation_row.public_code,
        'status', reservation_row.status,
        'replayed', true
      );
    end if;
    raise exception 'The confirmation link has expired' using errcode = '23514';
  end if;
  if token_row.revoked_at is not null
    or token_row.expires_at <= clock_timestamp() then
    raise exception 'The confirmation link has expired' using errcode = '23514';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.id = token_row.reservation_id
  for update;
  if reservation_row.status <> 'pending_verification'
    or not exists (
      select 1 from public.reservation_table_allocations allocation
      where allocation.reservation_id = reservation_row.id
        and allocation.is_active
        and allocation.allocation_kind = 'hold'
        and allocation.expires_at > clock_timestamp()
    ) then
    raise exception 'The reservation hold has expired' using errcode = '23514';
  end if;
  select * into settings_row from public.reservation_settings setting
  where setting.organization_id = reservation_row.organization_id
    and setting.location_id = reservation_row.location_id;
  update public.reservations reservation
  set status = 'booked',
      confirmed_at = clock_timestamp(),
      version = reservation.version + 1,
      updated_at = clock_timestamp()
  where reservation.id = reservation_row.id
  returning * into reservation_row;
  update public.reservation_table_allocations allocation
  set allocation_kind = 'assignment',
      expires_at = null,
      updated_at = clock_timestamp()
  where allocation.reservation_id = reservation_row.id
    and allocation.is_active;
  update private.public_booking_tokens token
  set consumed_at = clock_timestamp()
  where token.id = token_row.id;
  manage_expires_at := reservation_row.reserved_at
    + make_interval(mins => reservation_row.duration_minutes)
    + interval '24 hours';
  insert into private.public_booking_tokens (
    organization_id, location_id, reservation_id, token_hash,
    token_kind, expires_at
  ) values (
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, p_manage_token_hash, 'manage', manage_expires_at
  );
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, actor_kind
  ) values (
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, 'guest_verified', 'pending_verification',
    'booked', 'guest'
  );
  if settings_row.guest_messaging_enabled then
    insert into public.reservation_message_outbox (
      organization_id, location_id, reservation_id, guest_id,
      channel, template_key, template_data, dedupe_key
    ) values
      (
        reservation_row.organization_id, reservation_row.location_id,
        reservation_row.id, reservation_row.guest_id,
        'email', 'reservation_confirmed',
        jsonb_build_object('publicCode', reservation_row.public_code),
        'reservation:' || reservation_row.id::text || ':confirmed:email'
      ),
      (
        reservation_row.organization_id, reservation_row.location_id,
        reservation_row.id, reservation_row.guest_id,
        'sms', 'reservation_confirmed',
        jsonb_build_object('publicCode', reservation_row.public_code),
        'reservation:' || reservation_row.id::text || ':confirmed:sms'
      )
    on conflict (organization_id, dedupe_key) do nothing;
  end if;
  return jsonb_build_object(
    'reservationId', reservation_row.id,
    'publicCode', reservation_row.public_code,
    'status', reservation_row.status,
    'manageExpiresAt', manage_expires_at,
    'replayed', false
  );
end
$$;

create function public.service_get_managed_reservation(
  p_manage_token_hash text
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  token_row private.public_booking_tokens%rowtype;
  reservation_row public.reservations%rowtype;
  guest_row public.guests%rowtype;
  location_name text;
  location_timezone text;
  table_labels text[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  select * into token_row from private.public_booking_tokens token
  where token.token_hash = p_manage_token_hash
    and token.token_kind = 'manage'
    and token.revoked_at is null
    and token.expires_at > clock_timestamp();
  if token_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.id = token_row.reservation_id;
  select * into guest_row from public.guests guest
  where guest.id = reservation_row.guest_id;
  select location.name, location.timezone into location_name, location_timezone
  from public.locations location where location.id = reservation_row.location_id;
  select array_agg(table_row.label order by table_row.label) into table_labels
  from public.reservation_table_allocations allocation
  join public.reservation_tables table_row on table_row.id = allocation.table_id
  where allocation.reservation_id = reservation_row.id and allocation.is_active;
  return jsonb_build_object(
    'reservationId', reservation_row.id,
    'publicCode', reservation_row.public_code,
    'status', reservation_row.status,
    'reservedAt', reservation_row.reserved_at,
    'durationMinutes', reservation_row.duration_minutes,
    'partySize', reservation_row.party_size,
    'specialRequests', reservation_row.special_requests,
    'guestName', guest_row.display_name,
    'locationName', location_name,
    'timeZone', location_timezone,
    'tableLabels', coalesce(table_labels, '{}'::text[])
  );
end
$$;

create function public.service_cancel_public_reservation(
  p_request_id uuid,
  p_manage_token_hash text,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  token_row private.public_booking_tokens%rowtype;
  reservation_row public.reservations%rowtype;
  settings_row public.reservation_settings%rowtype;
  prior_request private.public_booking_requests%rowtype;
  payload_hash text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_manage_token_hash !~ '^[0-9a-f]{64}$'
    or length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then
    raise exception 'A valid cancellation request is required' using errcode = '22023';
  end if;
  select * into token_row from private.public_booking_tokens token
  where token.token_hash = p_manage_token_hash
    and token.token_kind = 'manage'
  for update;
  if token_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.id = token_row.reservation_id for update;
  payload_hash := encode(extensions.digest(jsonb_build_object(
    'reservationId', reservation_row.id,
    'reason', btrim(p_reason)
  )::text, 'sha256'), 'hex');
  select * into prior_request from private.public_booking_requests request
  where request.request_id = p_request_id for update;
  if prior_request.request_id is not null then
    if prior_request.reservation_id = reservation_row.id
      and prior_request.operation_kind = 'public.reservation.cancel'
      and prior_request.payload_hash = payload_hash
      and prior_request.completed_at is not null then
      return jsonb_build_object(
        'reservationId', reservation_row.id,
        'status', reservation_row.status,
        'replayed', true
      );
    end if;
    raise exception 'Idempotency key was reused' using errcode = '23505';
  end if;
  if token_row.revoked_at is not null or token_row.expires_at <= clock_timestamp() then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  if reservation_row.status in ('completed', 'cancelled', 'no_show') then
    raise exception 'This reservation can no longer be cancelled'
      using errcode = '23514';
  end if;
  select * into settings_row from public.reservation_settings setting
  where setting.organization_id = reservation_row.organization_id
    and setting.location_id = reservation_row.location_id;
  if settings_row.cancellation_cutoff_minutes is null
    or reservation_row.reserved_at
      - make_interval(mins => settings_row.cancellation_cutoff_minutes)
      <= clock_timestamp() then
    raise exception 'Online cancellation is closed for this reservation'
      using errcode = '23514';
  end if;
  insert into private.public_booking_requests (
    request_id, organization_id, location_id, reservation_id,
    operation_kind, payload_hash
  ) values (
    p_request_id, reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, 'public.reservation.cancel', payload_hash
  );
  perform private.lock_reservation_inventory(
    reservation_row.location_id, reservation_row.reserved_at
  );
  update public.reservations reservation
  set status = 'cancelled',
      cancellation_reason = btrim(p_reason),
      cancelled_at = clock_timestamp(),
      version = reservation.version + 1,
      updated_at = clock_timestamp()
  where reservation.id = reservation_row.id
  returning * into reservation_row;
  update public.reservation_table_allocations allocation
  set is_active = false,
      released_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where allocation.reservation_id = reservation_row.id
    and allocation.is_active;
  update private.public_booking_tokens token
  set revoked_at = clock_timestamp()
  where token.reservation_id = reservation_row.id
    and token.token_kind = 'manage'
    and token.revoked_at is null;
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, note, actor_kind, metadata
  ) values (
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, 'guest_cancelled', 'booked', 'cancelled',
    btrim(p_reason), 'guest', jsonb_build_object('requestId', p_request_id)
  );
  if settings_row.guest_messaging_enabled then
    insert into public.reservation_message_outbox (
      organization_id, location_id, reservation_id, guest_id,
      channel, template_key, template_data, dedupe_key
    ) values
      (
        reservation_row.organization_id, reservation_row.location_id,
        reservation_row.id, reservation_row.guest_id,
        'email', 'reservation_cancelled',
        jsonb_build_object('publicCode', reservation_row.public_code),
        'reservation:' || reservation_row.id::text || ':cancelled:email'
      ),
      (
        reservation_row.organization_id, reservation_row.location_id,
        reservation_row.id, reservation_row.guest_id,
        'sms', 'reservation_cancelled',
        jsonb_build_object('publicCode', reservation_row.public_code),
        'reservation:' || reservation_row.id::text || ':cancelled:sms'
      )
    on conflict (organization_id, dedupe_key) do nothing;
  end if;
  update private.public_booking_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return jsonb_build_object(
    'reservationId', reservation_row.id,
    'status', reservation_row.status,
    'replayed', false
  );
end
$$;

-- Immutable evidence tables and PII-bearing outbox state cannot be rewritten
-- by browser roles. Service delivery updates use the service role.
create function public.guard_reservation_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end
$$;

create trigger reservation_events_append_only
before update or delete on public.reservation_events
for each row execute function public.guard_reservation_append_only();

create trigger table_status_events_append_only
before update or delete on public.table_status_events
for each row execute function public.guard_reservation_append_only();

-- Standard timestamps and tenant audit capture for tables created after the
-- foundation-wide trigger loops ran.
do $reservation_triggers$
declare table_name text;
begin
  foreach table_name in array array[
    'reservation_settings', 'dining_areas', 'reservation_tables',
    'reservation_table_combinations', 'reservation_service_periods',
    'reservation_turn_rules', 'reservation_table_allocations',
    'waitlist_entries', 'reservation_message_outbox', 'booking_api_clients'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.touch_updated_at()',
      table_name
    );
  end loop;
  foreach table_name in array array[
    'reservation_settings', 'dining_areas', 'reservation_tables',
    'reservation_table_combinations', 'reservation_table_combination_members',
    'reservation_service_periods', 'reservation_turn_rules',
    'reservation_table_allocations', 'reservation_events', 'waitlist_entries',
    'table_status_events', 'reservation_message_outbox', 'booking_api_clients'
  ] loop
    execute format(
      'create trigger capture_audit after insert or update or delete on public.%I for each row execute function public.capture_audit_event()',
      table_name
    );
  end loop;
end
$reservation_triggers$;

-- Do not copy provider payloads or API-key hashes into the audit ledger.
create or replace function public.redact_audit_record(p_table text, p_record jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case
    when p_record is null then null
    when p_table = 'user_invitations' then p_record - 'token_hash'
    when p_table = 'push_subscriptions' then p_record - 'encrypted_subscription'
    when p_table = 'booking_api_clients' then p_record - 'key_hash'
    when p_table = 'reservations' then p_record - 'raw_payload'
    else p_record
  end
$$;

-- Default reservation access for recognizable FOH roles. Owners and Admins
-- continue to receive every active capability through the existing evaluator.
create function private.default_reservation_role_capabilities(
  p_code text,
  p_name text,
  p_department text
)
returns table (capability_key text)
language sql immutable
set search_path = ''
as $$
  with normalized as (
    select upper(btrim(coalesce(p_code, ''))) code,
      lower(btrim(coalesce(p_name, ''))) name,
      lower(btrim(coalesce(p_department, ''))) department
  )
  select unnest(case
    when code in ('FOH_MANAGER', 'FOHMGR')
      or name ~ '(^| )(foh|front of house) manager($| )'
      or (name ~ '(^| )manager($| )' and department like '%front%house%')
      then array['reservations.view', 'reservations.operate', 'reservations.override']::text[]
    when code in ('HOST', 'HOSTESS', 'MAITRE_D', 'MAITRED')
      or name ~ '(^| )(host|hostess|maitre d)($| )'
      then array['reservations.view', 'reservations.operate']::text[]
    else '{}'::text[]
  end)
  from normalized
$$;

create function private.apply_default_reservation_role_capabilities()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
begin
  if not new.is_active then return new; end if;
  if actor_id is null then
    select membership.user_id into actor_id
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
    order by case membership.role when 'owner' then 0 else 1 end,
      membership.joined_at nulls last, membership.user_id
    limit 1;
  end if;
  if actor_id is null then return new; end if;
  insert into public.job_role_capabilities (
    organization_id, job_role_id, capability_key, location_id,
    effective_from, is_active, created_by, updated_by
  )
  select new.organization_id, new.id, template.capability_key, location.id,
    (statement_timestamp() at time zone location.timezone)::date,
    true, actor_id, actor_id
  from private.default_reservation_role_capabilities(
    new.code, new.name, new.department
  ) template
  cross join public.locations location
  where location.organization_id = new.organization_id
    and location.is_active
  on conflict do nothing;
  return new;
end
$$;

revoke all on function private.apply_default_reservation_role_capabilities()
from public, anon, authenticated, service_role;

create trigger job_role_apply_default_reservation_capabilities
after insert on public.job_roles
for each row execute function private.apply_default_reservation_role_capabilities();

create function private.apply_default_reservation_location_capabilities()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid;
begin
  if not new.is_active then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.is_active then
    return new;
  end if;
  select membership.user_id into actor_id
  from public.organization_memberships membership
  where membership.organization_id = new.organization_id
    and membership.status = 'active'
    and membership.role in ('owner', 'admin')
  order by case membership.role when 'owner' then 0 else 1 end,
    membership.joined_at nulls last, membership.user_id
  limit 1;
  if actor_id is null then return new; end if;

  insert into public.job_role_capabilities (
    organization_id, job_role_id, capability_key, location_id,
    effective_from, is_active, created_by, updated_by
  )
  select role.organization_id, role.id, template.capability_key, new.id,
    (statement_timestamp() at time zone new.timezone)::date,
    true, actor_id, actor_id
  from public.job_roles role
  cross join lateral private.default_reservation_role_capabilities(
    role.code, role.name, role.department
  ) template
  where role.organization_id = new.organization_id
    and role.is_active
  on conflict do nothing;
  return new;
end
$$;

revoke all on function private.apply_default_reservation_location_capabilities()
from public, anon, authenticated, service_role;

create trigger location_apply_default_reservation_capabilities
after insert or update of is_active on public.locations
for each row execute function private.apply_default_reservation_location_capabilities();

do $backfill_reservation_capabilities$
declare
  role_row public.job_roles%rowtype;
  actor_id uuid;
begin
  for role_row in select role.* from public.job_roles role where role.is_active loop
    select membership.user_id into actor_id
    from public.organization_memberships membership
    where membership.organization_id = role_row.organization_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
    order by case membership.role when 'owner' then 0 else 1 end,
      membership.joined_at nulls last, membership.user_id
    limit 1;
    if actor_id is not null then
      insert into public.job_role_capabilities (
        organization_id, job_role_id, capability_key, location_id,
        effective_from, is_active, created_by, updated_by
      )
      select role_row.organization_id, role_row.id, template.capability_key,
        location.id,
        (statement_timestamp() at time zone location.timezone)::date,
        true, actor_id, actor_id
      from private.default_reservation_role_capabilities(
        role_row.code, role_row.name, role_row.department
      ) template
      cross join public.locations location
      where location.organization_id = role_row.organization_id
        and location.is_active
      on conflict do nothing;
    end if;
  end loop;
end
$backfill_reservation_capabilities$;

-- Broadcast high-churn reservation changes to a private location topic when
-- the managed Realtime schema is present. PGlite/local vanilla PostgreSQL skip
-- this path without inventing the managed schema.
create function public.broadcast_reservation_change()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  organization_uuid uuid;
  location_uuid uuid;
  new_record jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else null end;
  old_record jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else null end;
begin
  organization_uuid := nullif(coalesce(new_record, old_record) ->> 'organization_id', '')::uuid;
  location_uuid := nullif(coalesce(new_record, old_record) ->> 'location_id', '')::uuid;
  if to_regnamespace('realtime') is not null
    and organization_uuid is not null and location_uuid is not null then
    execute 'select realtime.broadcast_changes($1,$2,$3,$4,$5,$6,$7)'
    using
      'reservations:' || organization_uuid::text || ':' || location_uuid::text,
      tg_op, tg_op, tg_table_name, tg_table_schema, new_record, old_record;
  end if;
  return null;
end
$$;

create trigger reservations_broadcast
after insert or update or delete on public.reservations
for each row execute function public.broadcast_reservation_change();
create trigger reservation_allocations_broadcast
after insert or update or delete on public.reservation_table_allocations
for each row execute function public.broadcast_reservation_change();
create trigger waitlist_entries_broadcast
after insert or update or delete on public.waitlist_entries
for each row execute function public.broadcast_reservation_change();
create trigger table_status_events_broadcast
after insert or update or delete on public.table_status_events
for each row execute function public.broadcast_reservation_change();

do $reservation_realtime_policy$
begin
  if to_regclass('realtime.messages') is not null
    and not exists (
      select 1 from pg_policies
      where schemaname = 'realtime'
        and tablename = 'messages'
        and policyname = 'le_yard_reservation_broadcast_read'
    ) then
    execute $policy$
      create policy le_yard_reservation_broadcast_read
      on realtime.messages for select to authenticated
      using (
        case
          when realtime.topic() ~ '^reservations:[0-9a-f-]{36}:[0-9a-f-]{36}$'
          then public.can_access_location(
            split_part(realtime.topic(), ':', 2)::uuid,
            split_part(realtime.topic(), ':', 3)::uuid
          )
          else false
        end
      )
    $policy$;
  end if;
end
$reservation_realtime_policy$;

-- Browser and service execution allowlists.
revoke all on function public.configure_reservation_location(uuid, uuid, text, jsonb)
from public, anon, authenticated;
revoke all on function public.save_reservation(uuid, uuid, uuid, uuid, timestamptz, integer, integer, text, text, uuid[])
from public, anon, authenticated;
revoke all on function public.transition_reservation(uuid, uuid, text, text)
from public, anon, authenticated;
revoke all on function public.assign_reservation_tables(uuid, uuid, uuid[], text)
from public, anon, authenticated;
revoke all on function public.save_waitlist_entry(uuid, uuid, uuid, text, integer, timestamptz, timestamptz, integer, text)
from public, anon, authenticated;
grant execute on function public.configure_reservation_location(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.save_reservation(uuid, uuid, uuid, uuid, timestamptz, integer, integer, text, text, uuid[]) to authenticated;
grant execute on function public.transition_reservation(uuid, uuid, text, text) to authenticated;
grant execute on function public.assign_reservation_tables(uuid, uuid, uuid[], text) to authenticated;
grant execute on function public.save_waitlist_entry(uuid, uuid, uuid, text, integer, timestamptz, timestamptz, integer, text) to authenticated;

revoke all on function public.service_create_public_reservation(uuid, uuid, timestamptz, integer, integer, text, text, text, text, text, uuid[], text)
from public, anon, authenticated;
revoke all on function public.service_confirm_public_reservation(text, text)
from public, anon, authenticated;
revoke all on function public.service_get_managed_reservation(text)
from public, anon, authenticated;
revoke all on function public.service_cancel_public_reservation(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.service_create_public_reservation(uuid, uuid, timestamptz, integer, integer, text, text, text, text, text, uuid[], text) to service_role;
grant execute on function public.service_confirm_public_reservation(text, text) to service_role;
grant execute on function public.service_get_managed_reservation(text) to service_role;
grant execute on function public.service_cancel_public_reservation(uuid, text, text) to service_role;

revoke all on function private.lock_reservation_inventory(uuid, timestamptz)
from public, anon, authenticated;
revoke all on function private.assert_reservation_tables_available(uuid, uuid, uuid, uuid[], timestamptz, timestamptz, integer)
from public, anon, authenticated;
revoke all on function private.default_reservation_role_capabilities(text, text, text)
from public, anon, authenticated;
revoke all on function private.apply_default_reservation_role_capabilities()
from public, anon, authenticated;
revoke all on function public.guard_reservation_append_only()
from public, anon, authenticated;
revoke all on function public.broadcast_reservation_change()
from public, anon, authenticated;

comment on table public.reservation_settings is
  'Location reservation policy. Online booking stays fail-closed until an Owner-approved complete policy is active.';
comment on table public.reservation_table_allocations is
  'Serialized, command-owned table inventory for temporary public holds, confirmed assignments, and operational blocks.';
comment on function public.save_reservation(uuid, uuid, uuid, uuid, timestamptz, integer, integer, text, text, uuid[]) is
  'Idempotently creates or updates a staff reservation and atomically reallocates approved table inventory.';
comment on function public.service_create_public_reservation(uuid, uuid, timestamptz, integer, integer, text, text, text, text, text, uuid[], text) is
  'Service-only public booking command that creates a verified ten-minute inventory hold without exposing secret credentials to a browser.';

-- Gate 0 final public-booking boundary. These drafts are not shipped, so the
-- unsafe token/global-contact overloads above are removed in the same migration.
drop function public.service_create_public_reservation(uuid, uuid, timestamptz, integer, integer, text, text, text, text, text, uuid[], text);
drop function public.service_confirm_public_reservation(text, text);
drop function public.service_get_managed_reservation(text);
drop function public.service_cancel_public_reservation(uuid, text, text);

create function private.expire_public_booking_holds(
  p_organization_id uuid,
  p_location_id uuid,
  p_now timestamptz,
  p_limit integer,
  p_inventory_starts_at timestamptz default null
)
returns integer
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  hold_row private.public_booking_holds%rowtype;
  expired_count integer := 0;
  inventory_business_date date;
  location_timezone text;
begin
  if p_organization_id is null or p_location_id is null or p_now is null
    or p_limit not between 1 and 10000 then
    raise exception 'Valid booking-hold expiry scope is required'
      using errcode = '22023';
  end if;
  if p_inventory_starts_at is not null then
    select location.timezone into location_timezone
    from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id;
    if location_timezone is null then
      raise exception 'Reservation location not found' using errcode = 'P0002';
    end if;
    inventory_business_date :=
      (p_inventory_starts_at at time zone location_timezone)::date;
  end if;

  for hold_row in
    select hold.*
    from private.public_booking_holds hold
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.status = 'pending'
      and hold.expires_at <= p_now
      and (
        inventory_business_date is null
        or (hold.reserved_at at time zone location_timezone)::date
          = inventory_business_date
      )
    order by hold.expires_at, hold.id
    limit p_limit
    for update skip locked
  loop
    update private.public_booking_holds hold
    set status = 'expired', expired_at = p_now, redacted_at = p_now,
        first_name = null, last_name = null, email = null, phone = null,
        special_requests = null, updated_at = p_now
    where hold.id = hold_row.id and hold.status = 'pending';
    if not found then
      continue;
    end if;

    update public.reservation_table_allocations allocation
    set is_active = false, released_at = p_now, updated_at = p_now
    where allocation.organization_id = hold_row.organization_id
      and allocation.location_id = hold_row.location_id
      and allocation.booking_hold_id = hold_row.id
      and allocation.is_active;

    update public.reservation_message_outbox message
    set status = 'cancelled', claim_token = null, claimed_by = null,
        claimed_at = null, lease_expires_at = null, updated_at = p_now
    where message.organization_id = hold_row.organization_id
      and message.location_id = hold_row.location_id
      and message.booking_hold_id = hold_row.id
      and message.template_key = 'reservation_verify'
      and message.status in ('queued', 'failed', 'sending');

    insert into public.audit_events (
      organization_id, location_id, action, table_name, record_id,
      old_record, new_record, metadata, occurred_at
    ) values (
      hold_row.organization_id, hold_row.location_id,
      'public_booking_hold_expired', 'public_booking_holds', hold_row.id::text,
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'expired'),
      jsonb_build_object('actorKind', 'system'), p_now
    );
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end
$$;

revoke all on function private.expire_public_booking_holds(uuid, uuid, timestamptz, integer, timestamptz)
from public, anon, authenticated, service_role;

create function private.assert_reservation_pacing(
  p_organization_id uuid,
  p_location_id uuid,
  p_starts_at timestamptz,
  p_party_size integer,
  p_exclude_reservation_id uuid default null,
  p_exclude_booking_hold_id uuid default null
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  location_timezone text;
  local_start timestamp;
  service_row public.reservation_service_periods%rowtype;
  existing_covers integer;
begin
  select location.timezone into location_timezone
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id and location.is_active;
  if location_timezone is null or p_starts_at is null
    or p_party_size not between 1 and 100 then
    raise exception 'A valid pacing request is required' using errcode = '22023';
  end if;
  local_start := p_starts_at at time zone location_timezone;
  select * into service_row
  from public.reservation_service_periods period
  where period.organization_id = p_organization_id
    and period.location_id = p_location_id
    and period.is_active and period.online_enabled
    and period.approved_at is not null
    and extract(dow from local_start)::integer = any(period.days_of_week)
    and local_start::date >= period.effective_from
    and (period.effective_to is null or local_start::date <= period.effective_to)
    and local_start::time >= period.starts_local
    and local_start::time < period.ends_local
  order by period.starts_local, period.id
  limit 1
  for update of period;
  if service_row.id is null then
    raise exception 'No online service is configured for the requested time'
      using errcode = '23514';
  end if;
  select coalesce(sum(covers.party_size), 0)::integer into existing_covers
  from (
    select reservation.party_size
    from public.reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.location_id = p_location_id
      and reservation.id is distinct from p_exclude_reservation_id
      and reservation.status not in ('cancelled', 'no_show', 'completed')
      and reservation.reserved_at >= p_starts_at
        - make_interval(mins => service_row.pacing_interval_minutes)
      and reservation.reserved_at < p_starts_at
        + make_interval(mins => service_row.pacing_interval_minutes)
    union all
    select hold.party_size
    from private.public_booking_holds hold
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.id is distinct from p_exclude_booking_hold_id
      and hold.status = 'pending' and hold.expires_at > clock_timestamp()
      and hold.reserved_at >= p_starts_at
        - make_interval(mins => service_row.pacing_interval_minutes)
      and hold.reserved_at < p_starts_at
        + make_interval(mins => service_row.pacing_interval_minutes)
  ) covers;
  if existing_covers + p_party_size > service_row.pacing_cover_limit then
    raise exception 'The requested time has reached its pacing limit'
      using errcode = '23P01';
  end if;
end
$$;

revoke all on function private.assert_reservation_pacing(uuid, uuid, timestamptz, integer, uuid, uuid)
from public, anon, authenticated, service_role;

create function public.service_create_public_reservation(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_special_requests text,
  p_table_ids uuid[],
  p_available_channels text[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  settings_row public.reservation_settings%rowtype;
  reservation_row public.reservations%rowtype;
  hold_row private.public_booking_holds%rowtype;
  prior_request private.public_booking_requests%rowtype;
  payload_hash text;
  end_at timestamptz;
  hold_expires_at timestamptz;
  clean_first_name text := nullif(btrim(p_first_name), '');
  clean_last_name text := nullif(btrim(p_last_name), '');
  clean_email text := lower(nullif(btrim(p_email), ''));
  clean_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  table_id uuid;
  channel text;
  effective_channels text[];
  delivery_state jsonb := '{}'::jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null or p_location_id is null
    or p_reserved_at is null or p_duration_minutes not between 15 and 720
    or p_party_size not between 1 and 100
    or clean_first_name is null or clean_last_name is null
    or clean_email is null or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or clean_phone is null or length(clean_phone) not between 7 and 24
    or length(coalesce(p_special_requests, '')) > 5000
    or p_table_ids is null or cardinality(p_table_ids) not between 1 and 8
    or p_available_channels is null
    or cardinality(p_available_channels) not between 1 and 2
    or not (p_available_channels <@ array['email', 'sms']::text[]) then
    raise exception 'A valid public reservation is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id and location.is_active
  ) then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;

  -- Canonical inventory mutation order: resolve scope without row locks,
  -- acquire the location/business-date inventory lock, expire only that
  -- inventory day's stale holds, then lock settings and command records.
  perform private.lock_reservation_inventory(p_location_id, p_reserved_at);
  perform private.expire_public_booking_holds(
    p_organization_id, p_location_id, clock_timestamp(), 1000, p_reserved_at
  );

  select * into settings_row
  from public.reservation_settings setting
  where setting.organization_id = p_organization_id
    and setting.location_id = p_location_id
  for update;
  if settings_row.id is null or not settings_row.online_booking_enabled
    or settings_row.approved_at is null then
    raise exception 'Online booking is unavailable' using errcode = '42501';
  end if;
  if not settings_row.guest_messaging_enabled
    or cardinality(settings_row.verification_channels) < 1 then
    raise exception 'Verified guest delivery is unavailable' using errcode = '55000';
  end if;
  select array_agg(value order by value) into effective_channels
  from (
    select distinct value from unnest(p_available_channels) value
    intersect
    select distinct value from unnest(settings_row.verification_channels) value
  ) channels;
  if coalesce(cardinality(effective_channels), 0) < 1 then
    raise exception 'No approved verification delivery adapter is available'
      using errcode = '55000';
  end if;
  if p_party_size > settings_row.max_online_party_size
    or p_reserved_at < clock_timestamp() + make_interval(mins => settings_row.minimum_lead_minutes)
    or p_reserved_at > clock_timestamp() + make_interval(days => settings_row.booking_horizon_days) then
    raise exception 'The requested time is outside online booking rules'
      using errcode = '23514';
  end if;

  payload_hash := encode(extensions.digest(jsonb_build_object(
    'organizationId', p_organization_id, 'locationId', p_location_id,
    'reservedAt', p_reserved_at, 'durationMinutes', p_duration_minutes,
    'partySize', p_party_size, 'firstName', clean_first_name,
    'lastName', clean_last_name, 'email', clean_email, 'phone', clean_phone,
    'specialRequests', nullif(btrim(p_special_requests), ''),
    'tableIds', p_table_ids, 'availableChannels', effective_channels
  )::text, 'sha256'), 'hex');
  select * into prior_request
  from private.public_booking_requests request
  where request.request_id = p_request_id
  for update;
  if prior_request.request_id is not null then
    if prior_request.organization_id = p_organization_id
      and prior_request.location_id = p_location_id
      and prior_request.operation_kind = 'public.reservation.create'
      and prior_request.payload_hash = payload_hash
      and prior_request.completed_at is not null then
      select * into hold_row from private.public_booking_holds hold
      where hold.organization_id = p_organization_id
        and hold.location_id = p_location_id
        and hold.id = prior_request.booking_hold_id;
      select coalesce(jsonb_object_agg(message.channel, 'queued'), '{}'::jsonb)
      into delivery_state
      from public.reservation_message_outbox message
      where message.organization_id = p_organization_id
        and message.location_id = p_location_id
        and message.booking_hold_id = hold_row.id
        and message.template_key = 'reservation_verify';
      return jsonb_build_object(
        'holdId', hold_row.id, 'holdExpiresAt', hold_row.expires_at,
        'deliveryState', delivery_state, 'replayed', true
      );
    end if;
    raise exception 'Idempotency key was reused' using errcode = '23505';
  end if;

  hold_row.id := gen_random_uuid();
  insert into private.public_booking_requests (
    request_id, organization_id, location_id, booking_hold_id,
    operation_kind, payload_hash
  ) values (
    p_request_id, p_organization_id, p_location_id, hold_row.id,
    'public.reservation.create', payload_hash
  );
  end_at := p_reserved_at + make_interval(mins => p_duration_minutes);
  hold_expires_at := clock_timestamp()
    + make_interval(mins => settings_row.verification_hold_minutes);
  perform private.assert_reservation_pacing(
    p_organization_id, p_location_id, p_reserved_at, p_party_size, null, null
  );
  perform private.assert_reservation_tables_available(
    p_organization_id, p_location_id, null, p_table_ids,
    p_reserved_at, end_at, p_party_size
  );

  insert into private.public_booking_holds (
    id, organization_id, location_id, reserved_at, duration_minutes,
    party_size, special_requests, public_code, first_name, last_name,
    email, phone, expires_at
  ) values (
    hold_row.id, p_organization_id, p_location_id, p_reserved_at,
    p_duration_minutes, p_party_size, nullif(btrim(p_special_requests), ''),
    upper(substr(replace(hold_row.id::text, '-', ''), 1, 8)),
    clean_first_name, clean_last_name, clean_email, clean_phone, hold_expires_at
  ) returning * into hold_row;

  foreach table_id in array p_table_ids loop
    insert into public.reservation_table_allocations (
      organization_id, location_id, booking_hold_id, table_id,
      allocation_kind, starts_at, ends_at, expires_at
    ) values (
      p_organization_id, p_location_id, hold_row.id, table_id,
      'hold', p_reserved_at, end_at, hold_expires_at
    );
  end loop;
  insert into public.audit_events (
    organization_id, location_id, action, table_name, record_id,
    new_record, request_id, metadata
  ) values (
    p_organization_id, p_location_id, 'public_booking_hold_created',
    'public_booking_holds', hold_row.id::text,
    jsonb_build_object('status', 'pending', 'expiresAt', hold_expires_at),
    p_request_id::text, jsonb_build_object('actorKind', 'guest')
  );
  foreach channel in array effective_channels loop
    insert into public.reservation_message_outbox (
      organization_id, location_id, booking_hold_id, channel,
      template_key, template_data, dedupe_key
    ) values (
      p_organization_id, p_location_id, hold_row.id, channel,
      'reservation_verify', jsonb_build_object(
        'purpose', 'reservation_verify',
        'channel', channel,
        'holdId', hold_row.id,
        'expiresAt', hold_expires_at,
        'publicCode', hold_row.public_code
      ),
      'booking-hold:' || hold_row.id::text || ':verify:' || channel
    );
    delivery_state := delivery_state || jsonb_build_object(channel, 'queued');
  end loop;
  update private.public_booking_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return jsonb_build_object(
    'holdId', hold_row.id,
    'holdExpiresAt', hold_expires_at,
    'deliveryState', delivery_state,
    'replayed', false
  );
end
$$;

create function public.service_confirm_public_reservation(
  p_organization_id uuid,
  p_location_id uuid,
  p_booking_hold_id uuid,
  p_confirmation_fingerprint text,
  p_verified_channel text,
  p_available_channels text[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  hold_row private.public_booking_holds%rowtype;
  reservation_row public.reservations%rowtype;
  guest_row public.guests%rowtype;
  settings_row public.reservation_settings%rowtype;
  verification_row private.public_booking_verifications%rowtype;
  channel text;
  effective_channels text[];
  guest_identity_value text;
  delivery_state jsonb := '{}'::jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_location_id is null or p_booking_hold_id is null
    or p_confirmation_fingerprint !~ '^[0-9a-f]{64}$'
    or p_verified_channel not in ('email', 'sms')
    or p_available_channels is null
    or cardinality(p_available_channels) not between 1 and 2
    or not (p_available_channels <@ array['email', 'sms']::text[]) then
    raise exception 'A valid scoped confirmation is required' using errcode = '22023';
  end if;
  select * into verification_row
  from private.public_booking_verifications verification
  where verification.confirmation_fingerprint = p_confirmation_fingerprint;
  if verification_row.id is not null then
    if verification_row.organization_id = p_organization_id
      and verification_row.location_id = p_location_id
      and verification_row.booking_hold_id = p_booking_hold_id
      and verification_row.verified_channel = p_verified_channel then
      select * into hold_row from private.public_booking_holds hold
      where hold.organization_id = p_organization_id
        and hold.location_id = p_location_id and hold.id = p_booking_hold_id;
      select * into reservation_row from public.reservations reservation
      where reservation.organization_id = p_organization_id
        and reservation.location_id = p_location_id
        and reservation.id = hold_row.reservation_id;
      return jsonb_build_object(
        'reservationId', reservation_row.id, 'status', reservation_row.status,
        'manageDeliveryState', '{}'::jsonb, 'replayed', true
      );
    end if;
    raise exception 'Confirmation fingerprint was reused' using errcode = '23505';
  end if;

  select * into hold_row from private.public_booking_holds hold
  where hold.organization_id = p_organization_id
    and hold.location_id = p_location_id
    and hold.id = p_booking_hold_id;
  if hold_row.id is null or hold_row.status <> 'pending'
    or hold_row.expires_at <= clock_timestamp() then
    raise exception 'The reservation hold has expired' using errcode = '23514';
  end if;
  perform private.lock_reservation_inventory(p_location_id, hold_row.reserved_at);
  perform private.expire_public_booking_holds(
    p_organization_id, p_location_id, clock_timestamp(), 1000,
    hold_row.reserved_at
  );

  -- A concurrent exact confirmation may have committed while this call was
  -- waiting for the inventory lock. Recheck before locking settings/hold rows.
  select * into verification_row
  from private.public_booking_verifications verification
  where verification.confirmation_fingerprint = p_confirmation_fingerprint;
  if verification_row.id is not null then
    if verification_row.organization_id = p_organization_id
      and verification_row.location_id = p_location_id
      and verification_row.booking_hold_id = p_booking_hold_id
      and verification_row.verified_channel = p_verified_channel then
      select * into hold_row from private.public_booking_holds hold
      where hold.organization_id = p_organization_id
        and hold.location_id = p_location_id and hold.id = p_booking_hold_id;
      select * into reservation_row from public.reservations reservation
      where reservation.organization_id = p_organization_id
        and reservation.location_id = p_location_id
        and reservation.id = hold_row.reservation_id;
      return jsonb_build_object(
        'reservationId', reservation_row.id, 'status', reservation_row.status,
        'manageDeliveryState', '{}'::jsonb, 'replayed', true
      );
    end if;
    raise exception 'Confirmation fingerprint was reused' using errcode = '23505';
  end if;

  select * into settings_row from public.reservation_settings setting
  where setting.organization_id = p_organization_id
    and setting.location_id = p_location_id
  for update;
  select array_agg(value order by value) into effective_channels
  from (
    select p_verified_channel value
    where p_verified_channel = any(p_available_channels)
      and p_verified_channel = any(settings_row.verification_channels)
  ) channels;
  if settings_row.id is null or not settings_row.online_booking_enabled
    or settings_row.approved_at is null
    or not settings_row.guest_messaging_enabled
    or coalesce(cardinality(effective_channels), 0) < 1 then
    raise exception 'Confirmed-reservation delivery is unavailable'
      using errcode = '55000';
  end if;

  select * into hold_row from private.public_booking_holds hold
  where hold.organization_id = p_organization_id
    and hold.location_id = p_location_id
    and hold.id = p_booking_hold_id
  for update;
  if hold_row.id is null or hold_row.status <> 'pending'
    or hold_row.expires_at <= clock_timestamp() then
    raise exception 'The reservation hold has expired' using errcode = '23514';
  end if;
  if not exists (
      select 1 from public.reservation_table_allocations allocation
      where allocation.organization_id = p_organization_id
        and allocation.location_id = p_location_id
        and allocation.booking_hold_id = p_booking_hold_id
        and allocation.is_active and allocation.allocation_kind = 'hold'
        and allocation.expires_at > clock_timestamp()
    ) then
    raise exception 'The reservation hold has expired' using errcode = '23514';
  end if;
  insert into private.public_booking_verifications (
    organization_id, location_id, booking_hold_id, confirmation_fingerprint,
    verified_channel
  ) values (
    p_organization_id, p_location_id, p_booking_hold_id,
    p_confirmation_fingerprint, p_verified_channel
  );

  guest_identity_value := case p_verified_channel
    when 'email' then hold_row.email
    else regexp_replace(hold_row.phone, '[^0-9]', '', 'g')
  end;
  perform pg_advisory_xact_lock(hashtextextended(
    'guest-identity:' || p_organization_id::text || ':'
      || p_verified_channel || ':' || guest_identity_value,
    0
  ));
  select * into guest_row from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.merged_into_id is null
    and (
      (p_verified_channel = 'email' and lower(guest.email) = guest_identity_value)
      or (
        p_verified_channel = 'sms'
        and regexp_replace(coalesce(guest.phone, ''), '[^0-9]', '', 'g')
          = guest_identity_value
      )
    )
  limit 1;
  if guest_row.id is null then
    insert into public.guests (
      organization_id, first_name, last_name, display_name,
      email, phone, source, external_references
    ) values (
      p_organization_id, hold_row.first_name, hold_row.last_name,
      hold_row.first_name || ' ' || hold_row.last_name,
      case when p_verified_channel = 'email' then hold_row.email end,
      case when p_verified_channel = 'sms' then hold_row.phone end,
      'other', jsonb_build_object(
        'le_yard_web', true, 'verified_channel', p_verified_channel
      )
    ) on conflict do nothing
    returning * into guest_row;
    if guest_row.id is null then
      select * into guest_row from public.guests guest
      where guest.organization_id = p_organization_id
        and guest.merged_into_id is null
        and (
          (p_verified_channel = 'email' and lower(guest.email) = guest_identity_value)
          or (
            p_verified_channel = 'sms'
            and regexp_replace(coalesce(guest.phone, ''), '[^0-9]', '', 'g')
              = guest_identity_value
          )
        )
      limit 1;
    end if;
  end if;
  if guest_row.id is null then
    raise exception 'Verified guest identity could not be attached'
      using errcode = '23514';
  end if;

  -- A verified hold stops contributing provisional covers before the
  -- reservation INSERT trigger counts the confirmed commitment. The change
  -- is transaction-local and rolls back if any later step fails.
  update private.public_booking_holds hold
  set status = 'verified', verified_at = clock_timestamp(),
      redacted_at = clock_timestamp(), first_name = null, last_name = null,
      email = null, phone = null, special_requests = null,
      updated_at = clock_timestamp()
  where hold.id = hold_row.id;
  update public.reservation_message_outbox message
  set status = 'cancelled', claim_token = null, claimed_by = null,
      claimed_at = null, lease_expires_at = null,
      updated_at = clock_timestamp()
  where message.organization_id = p_organization_id
    and message.location_id = p_location_id
    and message.booking_hold_id = p_booking_hold_id
    and message.template_key = 'reservation_verify'
    and message.status in ('queued', 'failed', 'sending');

  reservation_row.id := gen_random_uuid();
  insert into public.reservations (
    id, organization_id, location_id, guest_id, reserved_at,
    duration_minutes, party_size, status, special_requests,
    source, booking_channel, public_code, confirmed_at
  ) values (
    reservation_row.id, p_organization_id, p_location_id, guest_row.id,
    hold_row.reserved_at, hold_row.duration_minutes, hold_row.party_size,
    'booked', hold_row.special_requests, 'le_yard_web', 'web',
    hold_row.public_code, clock_timestamp()
  ) returning * into reservation_row;
  update private.public_booking_holds hold
  set reservation_id = reservation_row.id, updated_at = clock_timestamp()
  where hold.id = hold_row.id;
  update public.reservation_table_allocations allocation
  set reservation_id = reservation_row.id, booking_hold_id = null,
      allocation_kind = 'assignment', expires_at = null,
      updated_at = clock_timestamp()
  where allocation.organization_id = p_organization_id
    and allocation.location_id = p_location_id
    and allocation.booking_hold_id = p_booking_hold_id
    and allocation.is_active;
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, actor_kind, metadata
  ) values (
    p_organization_id, p_location_id, reservation_row.id,
    'guest_verified', 'pending_verification', 'booked', 'guest',
    jsonb_build_object('holdId', hold_row.id)
  );
  foreach channel in array effective_channels loop
    insert into public.reservation_message_outbox (
      organization_id, location_id, reservation_id, guest_id, channel,
      template_key, template_data, dedupe_key
    ) values (
      p_organization_id, p_location_id, reservation_row.id, guest_row.id, channel,
      'reservation_confirmed', jsonb_build_object(
        'purpose', 'reservation_manage_exchange',
        'channel', channel,
        'publicCode', reservation_row.public_code
      ),
      'reservation:' || reservation_row.id::text || ':confirmed:' || channel
    ) on conflict (organization_id, dedupe_key) do nothing;
    delivery_state := delivery_state || jsonb_build_object(channel, 'queued');
  end loop;
  return jsonb_build_object(
    'reservationId', reservation_row.id, 'status', reservation_row.status,
    'manageDeliveryState', delivery_state, 'replayed', false
  );
end
$$;

create function public.service_exchange_reservation_management(
  p_organization_id uuid,
  p_location_id uuid,
  p_reservation_id uuid,
  p_exchange_fingerprint text,
  p_manage_token_hash text,
  p_browser_binding_hash text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  reservation_row public.reservations%rowtype;
  exchange_row private.public_booking_management_exchanges%rowtype;
  manage_expires_at timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_location_id is null or p_reservation_id is null
    or p_exchange_fingerprint !~ '^[0-9a-f]{64}$'
    or p_manage_token_hash !~ '^[0-9a-f]{64}$'
    or p_browser_binding_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid management exchange is required' using errcode = '22023';
  end if;
  select * into exchange_row
  from private.public_booking_management_exchanges exchange
  where exchange.exchange_fingerprint = p_exchange_fingerprint;
  if exchange_row.id is not null then
    if exchange_row.organization_id = p_organization_id
      and exchange_row.location_id = p_location_id
      and exchange_row.reservation_id = p_reservation_id
      and exchange_row.manage_token_hash = p_manage_token_hash
      and exchange_row.browser_binding_hash = p_browser_binding_hash
      and exchange_row.manage_expires_at > clock_timestamp()
      and exists (
        select 1 from private.public_booking_tokens token
        where token.organization_id = p_organization_id
          and token.location_id = p_location_id
          and token.reservation_id = p_reservation_id
          and token.token_hash = p_manage_token_hash
          and token.token_kind = 'manage'
          and token.revoked_at is null
          and token.expires_at = exchange_row.manage_expires_at
          and token.expires_at > clock_timestamp()
      ) then
      return jsonb_build_object(
        'reservationId', p_reservation_id,
        'manageExpiresAt', exchange_row.manage_expires_at,
        'replayed', true
      );
    end if;
    raise exception 'Management exchange was reused' using errcode = '23505';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.id = p_reservation_id
  for update;
  if reservation_row.id is null or reservation_row.status not in ('booked', 'confirmed') then
    raise exception 'The management exchange is unavailable' using errcode = 'P0002';
  end if;
  manage_expires_at := reservation_row.reserved_at
    + make_interval(mins => reservation_row.duration_minutes) + interval '24 hours';
  if manage_expires_at <= clock_timestamp() then
    raise exception 'The management exchange is unavailable'
      using errcode = 'P0002';
  end if;
  update private.public_booking_tokens token
  set revoked_at = clock_timestamp()
  where token.organization_id = p_organization_id
    and token.location_id = p_location_id
    and token.reservation_id = p_reservation_id
    and token.token_kind = 'manage' and token.revoked_at is null;
  insert into private.public_booking_tokens (
    organization_id, location_id, reservation_id, token_hash,
    token_kind, expires_at
  ) values (
    p_organization_id, p_location_id, p_reservation_id,
    p_manage_token_hash, 'manage', manage_expires_at
  );
  insert into private.public_booking_management_exchanges (
    organization_id, location_id, reservation_id, exchange_fingerprint,
    manage_token_hash, browser_binding_hash, manage_expires_at
  ) values (
    p_organization_id, p_location_id, p_reservation_id,
    p_exchange_fingerprint, p_manage_token_hash, p_browser_binding_hash,
    manage_expires_at
  );
  return jsonb_build_object(
    'reservationId', p_reservation_id,
    'manageExpiresAt', manage_expires_at,
    'replayed', false
  );
end
$$;

create function public.service_get_managed_reservation(
  p_organization_id uuid,
  p_location_id uuid,
  p_manage_token_hash text
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  token_row private.public_booking_tokens%rowtype;
  reservation_row public.reservations%rowtype;
  guest_row public.guests%rowtype;
  location_name text;
  location_timezone text;
  table_labels text[];
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_location_id is null
    or p_manage_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid scoped manage token is required' using errcode = '22023';
  end if;
  select * into token_row from private.public_booking_tokens token
  where token.organization_id = p_organization_id
    and token.location_id = p_location_id
    and token.token_hash = p_manage_token_hash
    and token.token_kind = 'manage' and token.revoked_at is null
    and token.expires_at > clock_timestamp();
  if token_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.id = token_row.reservation_id;
  if reservation_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  select * into guest_row from public.guests guest
  where guest.organization_id = p_organization_id and guest.id = reservation_row.guest_id;
  select location.name, location.timezone into location_name, location_timezone
  from public.locations location
  where location.organization_id = p_organization_id and location.id = p_location_id;
  select array_agg(table_row.label order by table_row.label) into table_labels
  from public.reservation_table_allocations allocation
  join public.reservation_tables table_row
    on table_row.organization_id = allocation.organization_id
   and table_row.id = allocation.table_id
  where allocation.organization_id = p_organization_id
    and allocation.location_id = p_location_id
    and allocation.reservation_id = reservation_row.id and allocation.is_active;
  return jsonb_build_object(
    'reservationId', reservation_row.id, 'publicCode', reservation_row.public_code,
    'status', reservation_row.status, 'reservedAt', reservation_row.reserved_at,
    'durationMinutes', reservation_row.duration_minutes,
    'partySize', reservation_row.party_size,
    'specialRequests', reservation_row.special_requests,
    'guestName', guest_row.display_name, 'locationName', location_name,
    'timeZone', location_timezone,
    'tableLabels', coalesce(table_labels, '{}'::text[])
  );
end
$$;

create function public.service_cancel_public_reservation(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_manage_token_hash text,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  token_row private.public_booking_tokens%rowtype;
  reservation_row public.reservations%rowtype;
  settings_row public.reservation_settings%rowtype;
  prior_request private.public_booking_requests%rowtype;
  payload_hash text;
  old_status text;
  message_channel text;
  message_channels text[] := '{}'::text[];
  verified_message_channel text;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null or p_location_id is null
    or p_manage_token_hash !~ '^[0-9a-f]{64}$'
    or length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then
    raise exception 'A valid cancellation request is required' using errcode = '22023';
  end if;
  select * into token_row from private.public_booking_tokens token
  where token.organization_id = p_organization_id
    and token.location_id = p_location_id
    and token.token_hash = p_manage_token_hash
    and token.token_kind = 'manage';
  if token_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.id = token_row.reservation_id;
  if reservation_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  perform private.lock_reservation_inventory(p_location_id, reservation_row.reserved_at);
  perform private.expire_public_booking_holds(
    p_organization_id, p_location_id, clock_timestamp(), 1000,
    reservation_row.reserved_at
  );
  select * into settings_row from public.reservation_settings setting
  where setting.organization_id = p_organization_id
    and setting.location_id = p_location_id
  for update;
  select * into token_row from private.public_booking_tokens token
  where token.organization_id = p_organization_id
    and token.location_id = p_location_id
    and token.token_hash = p_manage_token_hash
    and token.token_kind = 'manage'
  for update;
  select * into reservation_row from public.reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.id = token_row.reservation_id
  for update;
  if reservation_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  payload_hash := encode(extensions.digest(jsonb_build_object(
    'organizationId', p_organization_id, 'locationId', p_location_id,
    'reservationId', reservation_row.id, 'reason', btrim(p_reason)
  )::text, 'sha256'), 'hex');
  select * into prior_request from private.public_booking_requests request
  where request.request_id = p_request_id for update;
  if prior_request.request_id is not null then
    if prior_request.organization_id = p_organization_id
      and prior_request.location_id = p_location_id
      and prior_request.reservation_id = reservation_row.id
      and prior_request.operation_kind = 'public.reservation.cancel'
      and prior_request.payload_hash = payload_hash
      and prior_request.completed_at is not null then
      return jsonb_build_object(
        'reservationId', reservation_row.id,
        'status', reservation_row.status, 'replayed', true
      );
    end if;
    raise exception 'Idempotency key was reused' using errcode = '23505';
  end if;
  if token_row.revoked_at is not null or token_row.expires_at <= clock_timestamp() then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  if reservation_row.status in ('completed', 'cancelled', 'no_show', 'expired') then
    raise exception 'This reservation can no longer be cancelled' using errcode = '23514';
  end if;
  if settings_row.cancellation_cutoff_minutes is null
    or reservation_row.reserved_at
      - make_interval(mins => settings_row.cancellation_cutoff_minutes)
      <= clock_timestamp() then
    raise exception 'Online cancellation is closed for this reservation' using errcode = '23514';
  end if;
  if reservation_row.booking_channel = 'web' then
    select verification.verified_channel into verified_message_channel
    from private.public_booking_holds hold
    join private.public_booking_verifications verification
      on verification.organization_id = hold.organization_id
     and verification.location_id = hold.location_id
     and verification.booking_hold_id = hold.id
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.reservation_id = reservation_row.id;
    if verified_message_channel is null then
      raise exception 'Verified public reservation evidence is unavailable'
        using errcode = 'P0002';
    end if;
  end if;
  if settings_row.guest_messaging_enabled then
    message_channels := case
      when reservation_row.booking_channel = 'web'
        and verified_message_channel = any(settings_row.verification_channels)
        then array[verified_message_channel]::text[]
      when reservation_row.booking_channel <> 'web'
        then settings_row.verification_channels
      else '{}'::text[]
    end;
  end if;
  insert into private.public_booking_requests (
    request_id, organization_id, location_id, reservation_id,
    operation_kind, payload_hash
  ) values (
    p_request_id, p_organization_id, p_location_id,
    reservation_row.id, 'public.reservation.cancel', payload_hash
  );
  old_status := reservation_row.status;
  update public.reservations reservation
  set status = 'cancelled', cancellation_reason = btrim(p_reason),
      cancelled_at = clock_timestamp(), version = reservation.version + 1,
      updated_at = clock_timestamp()
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.id = reservation_row.id
  returning * into reservation_row;
  update public.reservation_table_allocations allocation
  set is_active = false, released_at = clock_timestamp(), updated_at = clock_timestamp()
  where allocation.organization_id = p_organization_id
    and allocation.location_id = p_location_id
    and allocation.reservation_id = reservation_row.id and allocation.is_active;
  update private.public_booking_tokens token
  set revoked_at = clock_timestamp()
  where token.organization_id = p_organization_id
    and token.location_id = p_location_id
    and token.reservation_id = reservation_row.id
    and token.token_kind = 'manage' and token.revoked_at is null;
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, note, actor_kind, metadata
  ) values (
    p_organization_id, p_location_id, reservation_row.id,
    'guest_cancelled', old_status, 'cancelled', btrim(p_reason),
    'guest', jsonb_build_object('requestId', p_request_id)
  );
  if cardinality(message_channels) > 0 then
    foreach message_channel in array message_channels loop
      insert into public.reservation_message_outbox (
        organization_id, location_id, reservation_id, guest_id, channel,
        template_key, template_data, dedupe_key
      ) values (
        p_organization_id, p_location_id, reservation_row.id,
        reservation_row.guest_id, message_channel, 'reservation_cancelled',
        jsonb_build_object(
          'publicCode', reservation_row.public_code,
          'channel', case when reservation_row.booking_channel = 'web'
            then verified_message_channel end
        ),
        'reservation:' || reservation_row.id::text || ':cancelled:' || message_channel
      ) on conflict (organization_id, dedupe_key) do nothing;
    end loop;
  end if;
  update private.public_booking_requests request
  set completed_at = clock_timestamp() where request.request_id = p_request_id;
  return jsonb_build_object(
    'reservationId', reservation_row.id,
    'status', reservation_row.status, 'replayed', false
  );
end
$$;

revoke all on function public.service_create_public_reservation(uuid, uuid, uuid, timestamptz, integer, integer, text, text, text, text, text, uuid[], text[])
from public, anon, authenticated;
revoke all on function public.service_confirm_public_reservation(uuid, uuid, uuid, text, text, text[])
from public, anon, authenticated;
revoke all on function public.service_exchange_reservation_management(uuid, uuid, uuid, text, text, text)
from public, anon, authenticated;
revoke all on function public.service_get_managed_reservation(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.service_cancel_public_reservation(uuid, uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.service_create_public_reservation(uuid, uuid, uuid, timestamptz, integer, integer, text, text, text, text, text, uuid[], text[]) to service_role;
grant execute on function public.service_confirm_public_reservation(uuid, uuid, uuid, text, text, text[]) to service_role;
grant execute on function public.service_exchange_reservation_management(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.service_get_managed_reservation(uuid, uuid, text) to service_role;
grant execute on function public.service_cancel_public_reservation(uuid, uuid, uuid, text, text) to service_role;

revoke all on function private.lock_reservation_inventory_many(uuid, timestamptz[])
from public, anon, authenticated, service_role;

comment on function public.service_create_public_reservation(uuid, uuid, uuid, timestamptz, integer, integer, text, text, text, text, text, uuid[], text[]) is
  'Service-only fail-closed booking hold; contact stays provisional until signed-link verification.';
