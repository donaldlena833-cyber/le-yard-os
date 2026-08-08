-- Le Yard OS Version 0.2 service control: internal availability, manager
-- handoffs, and structured pre-shift evidence. All writes use actor-derived,
-- idempotent commands; direct browser DML remains unavailable.

create table public.service_availability_events (
  id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  subject_type text not null check (subject_type in ('menu_item', 'component')),
  subject_label text not null check (length(btrim(subject_label)) between 1 and 160),
  status text not null check (status in ('available', 'running_low', 'eighty_sixed', 'restored')),
  estimated_portions numeric(12,3) check (estimated_portions is null or estimated_portions >= 0),
  reason text check (reason is null or length(reason) <= 500),
  effective_at timestamptz not null,
  expected_restoration_at timestamptz,
  actor_id uuid not null references auth.users(id) on delete restrict,
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check (expected_restoration_at is null or expected_restoration_at > effective_at)
);

create index service_availability_current_idx
on public.service_availability_events (
  organization_id, location_id, subject_type, lower(subject_label), effective_at desc, created_at desc
);

create table public.manager_log_entries (
  id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  business_date date not null,
  service_period text not null check (service_period in ('lunch', 'dinner', 'all_day', 'other')),
  category text not null check (category in ('foh', 'boh', 'guest', 'employee', 'equipment', 'inventory', 'vendor', 'cash', 'safety', 'maintenance', 'reservation', 'other')),
  severity text not null check (severity in ('informational', 'awareness', 'action_required', 'critical')),
  title text not null check (length(btrim(title)) between 1 and 180),
  narrative text not null check (length(btrim(narrative)) between 1 and 10000),
  author_id uuid not null references auth.users(id) on delete restrict,
  related_employee_id uuid,
  related_guest_id uuid,
  related_reservation_id uuid,
  related_inventory_item_id uuid,
  follow_up_owner_id uuid references auth.users(id) on delete set null,
  due_date date,
  status text not null check (status in ('informational', 'needs_follow_up', 'in_progress', 'resolved')),
  resolution text check (resolution is null or length(resolution) <= 10000),
  attachment_path text check (attachment_path is null or length(attachment_path) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, related_employee_id) references public.employees(organization_id, id) on delete set null,
  foreign key (organization_id, related_guest_id) references public.guests(organization_id, id) on delete set null,
  foreign key (organization_id, related_reservation_id) references public.reservations(organization_id, id) on delete set null,
  foreign key (organization_id, related_inventory_item_id) references public.inventory_items(organization_id, id) on delete set null,
  unique (organization_id, id)
);

create index manager_log_handoff_idx
on public.manager_log_entries (organization_id, location_id, status, business_date desc, created_at desc);

create table public.manager_log_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  manager_log_entry_id uuid not null,
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  changed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id, manager_log_entry_id)
    references public.manager_log_entries(organization_id, id) on delete restrict,
  unique (manager_log_entry_id, version_number),
  unique (organization_id, id)
);

create table public.preshifts (
  id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  business_date date not null,
  service_period text not null check (service_period in ('lunch', 'dinner', 'all_day', 'other')),
  version_number integer not null default 1 check (version_number > 0),
  status text not null check (status in ('draft', 'published', 'archived')),
  booked_covers integer check (booked_covers is null or booked_covers >= 0),
  projected_covers integer check (projected_covers is null or projected_covers >= 0),
  vip_notes text check (vip_notes is null or length(vip_notes) <= 5000),
  allergy_notes text check (allergy_notes is null or length(allergy_notes) <= 5000),
  large_party_notes text check (large_party_notes is null or length(large_party_notes) <= 5000),
  specials text check (specials is null or length(specials) <= 5000),
  staffing_notes text check (staffing_notes is null or length(staffing_notes) <= 5000),
  station_assignments jsonb not null default '[]'::jsonb check (jsonb_typeof(station_assignments) = 'array'),
  previous_handoff text check (previous_handoff is null or length(previous_handoff) <= 5000),
  service_goal text check (service_goal is null or length(service_goal) <= 2000),
  training_point text check (training_point is null or length(training_point) <= 2000),
  manager_notes text check (manager_notes is null or length(manager_notes) <= 5000),
  created_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, location_id, business_date, service_period, version_number),
  unique (organization_id, id),
  check ((status = 'published') = (published_at is not null and published_by is not null) or status = 'archived')
);

create index preshift_service_idx
on public.preshifts (organization_id, location_id, business_date desc, service_period, version_number desc);

create table public.preshift_acknowledgements (
  id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  preshift_id uuid not null,
  employee_id uuid not null,
  acknowledged_by uuid not null references auth.users(id) on delete restrict,
  acknowledged_at timestamptz not null default now(),
  comment text check (comment is null or length(comment) <= 2000),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, preshift_id) references public.preshifts(organization_id, id) on delete restrict,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete restrict,
  unique (preshift_id, employee_id),
  unique (organization_id, id)
);

alter table public.service_availability_events enable row level security;
alter table public.service_availability_events force row level security;
alter table public.manager_log_entries enable row level security;
alter table public.manager_log_entries force row level security;
alter table public.manager_log_versions enable row level security;
alter table public.manager_log_versions force row level security;
alter table public.preshifts enable row level security;
alter table public.preshifts force row level security;
alter table public.preshift_acknowledgements enable row level security;
alter table public.preshift_acknowledgements force row level security;

create policy service_availability_location_read
on public.service_availability_events for select to authenticated
using (public.can_access_location(organization_id, location_id));

create policy manager_log_authorized_read
on public.manager_log_entries for select to authenticated
using (
  public.can_read_management_location(organization_id, location_id)
  or public.has_capability(organization_id, location_id, 'manager_log.manage')
);

create policy manager_log_version_authorized_read
on public.manager_log_versions for select to authenticated
using (exists (
  select 1 from public.manager_log_entries entry
  where entry.organization_id = manager_log_versions.organization_id
    and entry.id = manager_log_versions.manager_log_entry_id
));

create policy preshift_location_read
on public.preshifts for select to authenticated
using (
  (status in ('published', 'archived') and public.can_access_location(organization_id, location_id))
  or public.has_capability(organization_id, location_id, 'preshift.manage')
);

create policy preshift_acknowledgement_read
on public.preshift_acknowledgements for select to authenticated
using (
  public.has_capability(organization_id, location_id, 'preshift.manage')
  or exists (
    select 1 from public.employees employee
    where employee.organization_id = preshift_acknowledgements.organization_id
      and employee.id = preshift_acknowledgements.employee_id
      and employee.user_id = auth.uid()
  )
);

revoke all on public.service_availability_events from public, anon, authenticated;
revoke all on public.manager_log_entries from public, anon, authenticated;
revoke all on public.manager_log_versions from public, anon, authenticated;
revoke all on public.preshifts from public, anon, authenticated;
revoke all on public.preshift_acknowledgements from public, anon, authenticated;
grant select on public.service_availability_events to authenticated;
grant select on public.manager_log_entries, public.manager_log_versions to authenticated;
grant select on public.preshifts, public.preshift_acknowledgements to authenticated;

create trigger manager_log_entries_updated_at before update on public.manager_log_entries
for each row execute function public.touch_updated_at();
create trigger preshifts_updated_at before update on public.preshifts
for each row execute function public.touch_updated_at();
create trigger service_availability_audit after insert on public.service_availability_events
for each row execute function public.capture_audit_event();
create trigger manager_log_entries_audit after insert or update on public.manager_log_entries
for each row execute function public.capture_audit_event();
create trigger preshifts_audit after insert or update on public.preshifts
for each row execute function public.capture_audit_event();
create trigger preshift_acknowledgements_audit after insert on public.preshift_acknowledgements
for each row execute function public.capture_audit_event();
create trigger service_availability_immutable before update or delete on public.service_availability_events
for each row execute function public.prevent_ledger_mutation();
create trigger manager_log_versions_immutable before update or delete on public.manager_log_versions
for each row execute function public.prevent_ledger_mutation();
create trigger preshift_acknowledgements_immutable before update or delete on public.preshift_acknowledgements
for each row execute function public.prevent_ledger_mutation();

create function public.record_service_availability_event(
  p_request_id uuid, p_organization_id uuid, p_location_id uuid,
  p_subject_type text, p_subject_label text, p_status text,
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
  claimed boolean;
  payload jsonb;
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_request_id is null or p_organization_id is null or p_location_id is null
    or lower(btrim(coalesce(p_subject_type, ''))) not in ('menu_item', 'component')
    or nullif(btrim(p_subject_label), '') is null
    or lower(btrim(coalesce(p_status, ''))) not in ('available', 'running_low', 'eighty_sixed', 'restored')
    or p_effective_at is null then
    raise exception 'Valid availability details are required' using errcode = '22023';
  end if;
  if not public.has_capability(p_organization_id, p_location_id, 'service.availability.manage') then
    raise exception 'Service availability capability is required' using errcode = '42501';
  end if;
  payload := jsonb_build_object(
    'subjectType', lower(btrim(p_subject_type)), 'subjectLabel', btrim(p_subject_label),
    'status', lower(btrim(p_status)), 'estimatedPortions', p_estimated_portions,
    'reason', nullif(btrim(p_reason), ''), 'effectiveAt', p_effective_at,
    'expectedRestorationAt', p_expected_restoration_at, 'notes', nullif(btrim(p_notes), '')
  );
  claimed := private.claim_operation_request(
    p_request_id, 'service.availability.record', p_organization_id,
    p_location_id, p_request_id, payload
  );
  if claimed then
    insert into public.service_availability_events (
      id, organization_id, location_id, subject_type, subject_label, status,
      estimated_portions, reason, effective_at, expected_restoration_at, actor_id, notes
    ) values (
      p_request_id, p_organization_id, p_location_id, lower(btrim(p_subject_type)),
      btrim(p_subject_label), lower(btrim(p_status)), p_estimated_portions,
      nullif(btrim(p_reason), ''), p_effective_at, p_expected_restoration_at,
      actor_id, nullif(btrim(p_notes), '')
    );
    perform private.complete_operation_request(p_request_id);
  end if;
  select * into result from public.service_availability_events event where event.id = p_request_id;
  return result;
end
$$;

create function public.save_manager_log_entry(
  p_request_id uuid, p_entry_id uuid, p_organization_id uuid, p_location_id uuid,
  p_business_date date, p_service_period text, p_category text, p_severity text,
  p_title text, p_narrative text, p_related_employee_id uuid,
  p_related_guest_id uuid, p_related_reservation_id uuid,
  p_related_inventory_item_id uuid, p_follow_up_owner_id uuid, p_due_date date,
  p_status text, p_resolution text, p_attachment_path text
)
returns public.manager_log_entries
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  target_id uuid := coalesce(p_entry_id, p_request_id);
  result public.manager_log_entries%rowtype;
  existing public.manager_log_entries%rowtype;
  claimed boolean;
  next_version integer;
  payload jsonb;
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_request_id is null or target_id is null or p_business_date is null
    or nullif(btrim(p_title), '') is null or nullif(btrim(p_narrative), '') is null then
    raise exception 'Valid manager-log details are required' using errcode = '22023';
  end if;
  if not public.has_capability(p_organization_id, p_location_id, 'manager_log.manage') then
    raise exception 'Manager-log capability is required' using errcode = '42501';
  end if;
  select * into existing from public.manager_log_entries entry
  where entry.id = target_id for update;
  if existing.id is not null and (
    existing.organization_id <> p_organization_id or existing.location_id <> p_location_id
  ) then
    raise exception 'Manager-log entry not found' using errcode = 'P0002';
  end if;
  payload := jsonb_build_object(
    'entryId', target_id, 'businessDate', p_business_date, 'servicePeriod', p_service_period,
    'category', p_category, 'severity', p_severity, 'title', btrim(p_title),
    'narrative', btrim(p_narrative), 'relatedEmployeeId', p_related_employee_id,
    'relatedGuestId', p_related_guest_id, 'relatedReservationId', p_related_reservation_id,
    'relatedInventoryItemId', p_related_inventory_item_id, 'followUpOwnerId', p_follow_up_owner_id,
    'dueDate', p_due_date, 'status', p_status, 'resolution', nullif(btrim(p_resolution), ''),
    'attachmentPath', nullif(btrim(p_attachment_path), '')
  );
  claimed := private.claim_operation_request(
    p_request_id, 'manager_log.save', p_organization_id, p_location_id, target_id, payload
  );
  if claimed then
    insert into public.manager_log_entries (
      id, organization_id, location_id, business_date, service_period, category,
      severity, title, narrative, author_id, related_employee_id, related_guest_id,
      related_reservation_id, related_inventory_item_id, follow_up_owner_id,
      due_date, status, resolution, attachment_path
    ) values (
      target_id, p_organization_id, p_location_id, p_business_date, p_service_period,
      p_category, p_severity, btrim(p_title), btrim(p_narrative), actor_id,
      p_related_employee_id, p_related_guest_id, p_related_reservation_id,
      p_related_inventory_item_id, p_follow_up_owner_id, p_due_date, p_status,
      nullif(btrim(p_resolution), ''), nullif(btrim(p_attachment_path), '')
    ) on conflict (id) do update set
      service_period = excluded.service_period, category = excluded.category,
      severity = excluded.severity, title = excluded.title, narrative = excluded.narrative,
      related_employee_id = excluded.related_employee_id, related_guest_id = excluded.related_guest_id,
      related_reservation_id = excluded.related_reservation_id,
      related_inventory_item_id = excluded.related_inventory_item_id,
      follow_up_owner_id = excluded.follow_up_owner_id, due_date = excluded.due_date,
      status = excluded.status, resolution = excluded.resolution,
      attachment_path = excluded.attachment_path;
    select coalesce(max(version.version_number), 0) + 1 into next_version
    from public.manager_log_versions version where version.manager_log_entry_id = target_id;
    insert into public.manager_log_versions (
      organization_id, manager_log_entry_id, version_number, snapshot, changed_by
    ) values (p_organization_id, target_id, next_version, payload, actor_id);
    perform private.complete_operation_request(p_request_id);
  end if;
  select * into result from public.manager_log_entries entry where entry.id = target_id;
  return result;
end
$$;

create function public.save_preshift(
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
  select * into existing from public.preshifts preshift where preshift.id = target_id for update;
  if existing.id is not null and existing.organization_id <> p_organization_id then
    raise exception 'Pre-shift not found' using errcode = 'P0002';
  end if;
  if existing.status = 'published' then
    raise exception 'Published pre-shifts are immutable; create a new version' using errcode = '23514';
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
    insert into public.preshifts (
      id, organization_id, location_id, business_date, service_period, status,
      booked_covers, projected_covers, vip_notes, allergy_notes, large_party_notes,
      specials, staffing_notes, station_assignments, previous_handoff, service_goal,
      training_point, manager_notes, created_by, published_by, published_at
    ) values (
      target_id, p_organization_id, p_location_id, p_business_date, p_service_period,
      p_status, p_booked_covers, p_projected_covers, nullif(btrim(p_vip_notes), ''),
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

create function public.acknowledge_preshift(
  p_request_id uuid, p_preshift_id uuid, p_comment text
)
returns public.preshift_acknowledgements
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  target public.preshifts%rowtype;
  employee_id uuid;
  result public.preshift_acknowledgements%rowtype;
  claimed boolean;
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into target from public.preshifts preshift
  where preshift.id = p_preshift_id and preshift.status = 'published';
  if target.id is null then raise exception 'Published pre-shift not found' using errcode = 'P0002'; end if;
  select employee.id into employee_id from public.employees employee
  where employee.organization_id = target.organization_id
    and employee.user_id = actor_id and employee.employment_status = 'active';
  if employee_id is null or not public.can_access_location(target.organization_id, target.location_id) then
    raise exception 'An active employee at this location is required' using errcode = '42501';
  end if;
  claimed := private.claim_operation_request(
    p_request_id, 'preshift.acknowledge', target.organization_id, target.location_id,
    p_preshift_id, jsonb_build_object('preshiftId', p_preshift_id, 'comment', nullif(btrim(p_comment), ''))
  );
  if claimed then
    insert into public.preshift_acknowledgements (
      id, organization_id, location_id, preshift_id, employee_id, acknowledged_by, comment
    ) values (
      p_request_id, target.organization_id, target.location_id, p_preshift_id,
      employee_id, actor_id, nullif(btrim(p_comment), '')
    );
    perform private.complete_operation_request(p_request_id);
  end if;
  select * into result from public.preshift_acknowledgements acknowledgement
  where acknowledgement.preshift_id = p_preshift_id and acknowledgement.employee_id = employee_id;
  return result;
end
$$;

revoke all on function public.record_service_availability_event(uuid, uuid, uuid, text, text, text, numeric, text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.save_manager_log_entry(uuid, uuid, uuid, uuid, date, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, date, text, text, text) from public, anon, authenticated;
revoke all on function public.save_preshift(uuid, uuid, uuid, uuid, date, text, text, integer, integer, text, text, text, text, text, jsonb, text, text, text, text) from public, anon, authenticated;
revoke all on function public.acknowledge_preshift(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_service_availability_event(uuid, uuid, uuid, text, text, text, numeric, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.save_manager_log_entry(uuid, uuid, uuid, uuid, date, text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, date, text, text, text) to authenticated;
grant execute on function public.save_preshift(uuid, uuid, uuid, uuid, date, text, text, integer, integer, text, text, text, text, text, jsonb, text, text, text, text) to authenticated;
grant execute on function public.acknowledge_preshift(uuid, uuid, text) to authenticated;
