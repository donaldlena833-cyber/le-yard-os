-- Le Yard OS: CRM profile ownership, append-only hospitality evidence, and
-- atomic guest merging.

create table private.guest_merge_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  source_guest_id uuid not null,
  target_guest_id uuid not null,
  actor_id uuid not null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.guest_merge_requests from public, anon, authenticated;

-- Closed incidents remain immutable except for the single foreign-key reparent
-- performed inside the atomic guest merge command.  Replacing the operation
-- guard here is intentional: the private merge authorization ledger does not
-- exist until this migration.
create or replace function public.guard_terminal_operation_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  parent_status public.task_status;
  incident_status text;
  merge_authorized boolean := false;
begin
  if tg_table_name = 'tasks' then
    if tg_op in ('UPDATE', 'DELETE') and old.status in ('completed', 'cancelled') then
      raise exception 'Terminal tasks are immutable' using errcode = '42501';
    end if;
  elsif tg_table_name = 'checklist_runs' then
    if tg_op in ('UPDATE', 'DELETE') and old.status in ('completed', 'cancelled') then
      raise exception 'Terminal checklist runs are immutable' using errcode = '42501';
    end if;
  elsif tg_table_name = 'checklist_responses' then
    select run.status into parent_status
    from public.checklist_runs run
    where run.id = case when tg_op = 'INSERT' then new.checklist_run_id else old.checklist_run_id end;
    if parent_status in ('completed', 'cancelled') then
      raise exception 'Terminal checklist responses are immutable'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'maintenance_requests' then
    if tg_op in ('UPDATE', 'DELETE') and old.status in ('completed', 'cancelled') then
      raise exception 'Terminal maintenance requests are immutable'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'incidents' then
    if tg_op = 'DELETE' then
      raise exception 'Closed incident evidence is immutable'
        using errcode = '42501';
    elsif tg_op = 'UPDATE' and old.status = 'closed' then
      select exists (
        select 1
        from private.guest_merge_requests request
        where request.organization_id = old.organization_id
          and request.source_guest_id = old.guest_id
          and request.target_guest_id = new.guest_id
          and request.actor_id = auth.uid()
          and request.completed_at is null
      ) into merge_authorized;
      if not merge_authorized
        or (to_jsonb(new) - array['guest_id', 'updated_at'])
          is distinct from (to_jsonb(old) - array['guest_id', 'updated_at']) then
        raise exception 'Closed incident evidence is immutable'
          using errcode = '42501';
      end if;
    end if;
  elsif tg_table_name = 'incident_attachments' then
    select incident.status into incident_status
    from public.incidents incident
    where incident.id = case when tg_op = 'INSERT' then new.incident_id else old.incident_id end;
    if incident_status in ('resolved', 'closed') then
      raise exception 'Resolved incident attachments are immutable'
        using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and auth.uid() is not null then
      new.uploaded_by := auth.uid();
      new.created_at := clock_timestamp();
      if not exists (
        select 1
        from public.incidents incident
        join storage.objects object
          on object.bucket_id = 'incidents'
         and object.name = new.storage_path
         and object.owner_id = auth.uid()::text
        where incident.id = new.incident_id
          and incident.organization_id = new.organization_id
          and public.storage_path_scope_is_valid(new.storage_path)
          and public.storage_organization_id(new.storage_path) = incident.organization_id
          and public.storage_location_id(new.storage_path) = incident.location_id
          and (
            incident.reported_by = auth.uid()
            or public.can_manage_location(incident.organization_id, incident.location_id)
          )
      ) then
        raise exception 'Incident attachment object is missing or out of scope'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create unique index guest_merge_events_one_per_source
on public.guest_merge_events (organization_id, source_guest_id);

create function public.guard_guest_profile_owned_fields()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  merge_authorized boolean := false;
begin
  if tg_op = 'DELETE' then
    raise exception 'Guest profiles cannot be deleted; merge duplicates instead'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null and (
      new.source <> 'manual'
      or new.external_references <> '{}'::jsonb
      or new.merged_into_id is not null
      or new.first_visit_at is not null
      or new.last_visit_at is not null
      or new.visit_count <> 0
      or new.lifetime_spend_cents <> 0
    ) then
      raise exception 'Guest source, merge state, and visit rollups are server-owned'
        using errcode = '42501';
    end if;
    return new;
  end if;

  select exists (
    select 1
    from private.guest_merge_requests request
    where request.organization_id = old.organization_id
      and request.actor_id = auth.uid()
      and request.completed_at is null
      and old.id in (request.source_guest_id, request.target_guest_id)
  ) into merge_authorized;
  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.created_at is distinct from new.created_at then
    raise exception 'Guest identity and creation evidence are immutable'
      using errcode = '42501';
  end if;
  if old.merged_into_id is not null and not merge_authorized then
    raise exception 'Merged guest profiles are immutable' using errcode = '42501';
  end if;
  if (
    old.source is distinct from new.source
    or old.external_references is distinct from new.external_references
    or old.merged_into_id is distinct from new.merged_into_id
    or old.first_visit_at is distinct from new.first_visit_at
    or old.last_visit_at is distinct from new.last_visit_at
    or old.visit_count is distinct from new.visit_count
    or old.lifetime_spend_cents is distinct from new.lifetime_spend_cents
  ) and not merge_authorized then
    raise exception 'Guest source, merge state, and visit rollups are server-owned'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger guest_profile_owned_field_guard
before insert or update or delete on public.guests
for each row execute function public.guard_guest_profile_owned_fields();

create function public.save_guest(
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
  if not public.can_operate_org(p_organization_id) then
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

create function public.add_guest_note(
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
  if not public.can_operate_org(guest_row.organization_id) then
    raise exception 'Not authorized to add guest notes' using errcode = '42501';
  end if;
  if p_location_id is not null and not exists (
    select 1 from public.locations location
    where location.organization_id = guest_row.organization_id
      and location.id = p_location_id
      and public.can_manage_location(location.organization_id, location.id)
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

create function public.save_guest_contact(
  p_request_id uuid,
  p_guest_id uuid,
  p_contact_id uuid,
  p_contact_type text,
  p_label text,
  p_value text,
  p_is_primary boolean default false
)
returns public.guest_contacts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  guest_row public.guests%rowtype;
  contact_row public.guest_contacts%rowtype;
  result_id uuid := coalesce(p_contact_id, p_request_id);
  operation_kind text := case
    when p_contact_id is null then 'guest.contact.create'
    else 'guest.contact.update'
  end;
  clean_label text := nullif(btrim(p_label), '');
  clean_value text := btrim(p_value);
  clean_normalized_value text;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_contact_type is null
    or p_contact_type not in ('email', 'phone', 'address', 'social', 'other')
    or clean_value is null
    or length(clean_value) not between 1 and 1000
    or length(coalesce(clean_label, '')) > 120
    or p_is_primary is null then
    raise exception 'Invalid guest contact payload' using errcode = '22023';
  end if;
  if p_contact_type = 'email' then
    clean_normalized_value := lower(clean_value);
    if clean_normalized_value !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
      raise exception 'Invalid guest contact email' using errcode = '22023';
    end if;
  elsif p_contact_type = 'phone' then
    clean_normalized_value := regexp_replace(clean_value, '[^0-9]', '', 'g');
    if length(clean_normalized_value) not between 7 and 20 then
      raise exception 'Invalid guest contact phone' using errcode = '22023';
    end if;
  else
    clean_normalized_value := lower(clean_value);
  end if;
  select * into guest_row
  from public.guests guest
  where guest.id = p_guest_id;
  if guest_row.id is null or guest_row.merged_into_id is not null then
    raise exception 'Active guest not found' using errcode = 'P0002';
  end if;
  if not public.can_operate_org(guest_row.organization_id) then
    raise exception 'Not authorized to manage guest contacts'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'guest-contact:' || guest_row.organization_id::text || ':'
      || guest_row.id::text || ':' || p_contact_type,
    0
  ));
  if not private.claim_operation_request(
    p_request_id,
    operation_kind,
    guest_row.organization_id,
    null,
    result_id,
    jsonb_build_object(
      'guest_id', guest_row.id,
      'contact_type', p_contact_type,
      'label', clean_label,
      'value', clean_value,
      'normalized_value', clean_normalized_value,
      'is_primary', p_is_primary
    )
  ) then
    select * into contact_row
    from public.guest_contacts contact
    where contact.organization_id = guest_row.organization_id
      and contact.id = result_id;
    if contact_row.id is not null then return contact_row; end if;
    raise exception 'Guest contact request has no result row' using errcode = '40001';
  end if;
  if p_is_primary then
    update public.guest_contacts other_contact
    set is_primary = false,
        updated_at = clock_timestamp()
    where other_contact.organization_id = guest_row.organization_id
      and other_contact.guest_id = guest_row.id
      and other_contact.contact_type = p_contact_type
      and other_contact.id <> result_id
      and other_contact.is_primary;
  end if;
  if p_contact_id is null then
    insert into public.guest_contacts (
      id, organization_id, guest_id, contact_type, label,
      value, normalized_value, is_primary, verified_at,
      created_at, updated_at
    ) values (
      p_request_id, guest_row.organization_id, guest_row.id,
      p_contact_type, clean_label, clean_value, clean_normalized_value,
      p_is_primary, null, clock_timestamp(), clock_timestamp()
    ) returning * into contact_row;
  else
    select * into contact_row
    from public.guest_contacts contact
    where contact.organization_id = guest_row.organization_id
      and contact.id = p_contact_id
      and contact.guest_id = guest_row.id
    for update;
    if contact_row.id is null then
      raise exception 'Guest contact not found' using errcode = 'P0002';
    end if;
    update public.guest_contacts contact_update
    set contact_type = p_contact_type,
        label = clean_label,
        value = clean_value,
        normalized_value = clean_normalized_value,
        is_primary = p_is_primary,
        verified_at = null,
        updated_at = clock_timestamp()
    where contact_update.id = contact_row.id
    returning * into contact_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return contact_row;
end
$$;

create unique index guest_contacts_one_primary_per_type
on public.guest_contacts (organization_id, guest_id, contact_type)
where is_primary;

create unique index guest_contacts_unique_normalized_per_guest
on public.guest_contacts (organization_id, guest_id, contact_type, normalized_value)
where normalized_value is not null;

create function public.record_guest_consent(
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
  if not public.can_operate_org(guest_row.organization_id) then
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

create function public.assign_guest_tag(
  p_request_id uuid,
  p_guest_id uuid,
  p_tag_id uuid
)
returns public.guest_tag_assignments
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  guest_row public.guests%rowtype;
  assignment_row public.guest_tag_assignments%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into guest_row from public.guests guest where guest.id = p_guest_id;
  if guest_row.id is null or guest_row.merged_into_id is not null then
    raise exception 'Active guest not found' using errcode = 'P0002';
  end if;
  if not public.can_operate_org(guest_row.organization_id) then
    raise exception 'Not authorized to tag guests' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.guest_tags tag
    where tag.organization_id = guest_row.organization_id and tag.id = p_tag_id
  ) then
    raise exception 'Guest tag not found' using errcode = 'P0002';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'guest.tag.assign',
    guest_row.organization_id,
    null,
    guest_row.id,
    jsonb_build_object('tag_id', p_tag_id)
  ) then
    select * into assignment_row
    from public.guest_tag_assignments assignment
    where assignment.guest_id = guest_row.id and assignment.tag_id = p_tag_id;
    if assignment_row.id is not null then return assignment_row; end if;
    raise exception 'Guest tag request has no result row' using errcode = '40001';
  end if;
  select * into assignment_row
  from public.guest_tag_assignments assignment
  where assignment.guest_id = guest_row.id and assignment.tag_id = p_tag_id;
  if assignment_row.id is null then
    insert into public.guest_tag_assignments (
      id, organization_id, guest_id, tag_id, assigned_by, created_at
    ) values (
      p_request_id, guest_row.organization_id, guest_row.id,
      p_tag_id, actor_id, clock_timestamp()
    ) returning * into assignment_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return assignment_row;
end
$$;

drop trigger guest_consents_append_only on public.guest_consents;
drop trigger set_updated_at on public.guest_notes;

create function public.guard_guest_append_only_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  merge_target_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception '% is append-only', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    select request.target_guest_id into merge_target_id
    from private.guest_merge_requests request
    where request.organization_id = old.organization_id
      and request.source_guest_id = old.guest_id
      and request.target_guest_id = new.guest_id
      and request.actor_id = auth.uid()
      and request.completed_at is null;
    if merge_target_id is null
      or (to_jsonb(new) - 'guest_id') is distinct from (to_jsonb(old) - 'guest_id') then
      raise exception '% is append-only outside an atomic guest merge', tg_table_name
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger guest_note_append_only_guard
before update or delete on public.guest_notes
for each row execute function public.guard_guest_append_only_evidence();
create trigger guest_consent_append_only_guard
before update or delete on public.guest_consents
for each row execute function public.guard_guest_append_only_evidence();
create trigger guest_merge_events_append_only
before update or delete on public.guest_merge_events
for each row execute function public.prevent_ledger_mutation();

create function public.merge_guests(
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
  source_guest public.guests%rowtype;
  target_guest public.guests%rowtype;
  merge_event public.guest_merge_events%rowtype;
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
  select * into source_guest from public.guests guest where guest.id = p_source_guest_id;
  select * into target_guest from public.guests guest where guest.id = p_target_guest_id;
  if source_guest.id is null or target_guest.id is null
    or source_guest.organization_id <> target_guest.organization_id then
    raise exception 'Guest merge scope is invalid' using errcode = '23514';
  end if;
  if not public.can_operate_org(source_guest.organization_id) then
    raise exception 'Not authorized to merge guests' using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'guest.merge',
    source_guest.organization_id,
    null,
    source_guest.id,
    jsonb_build_object(
      'target_guest_id', target_guest.id,
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

  perform pg_advisory_xact_lock(hashtextextended(
    'guest-merge:' || source_guest.organization_id::text || ':'
      || least(source_guest.id::text, target_guest.id::text) || ':'
      || greatest(source_guest.id::text, target_guest.id::text),
    0
  ));
  perform 1
  from public.guests guest
  where guest.id in (p_source_guest_id, p_target_guest_id)
  order by guest.id
  for update;
  select * into source_guest from public.guests guest where guest.id = p_source_guest_id;
  select * into target_guest from public.guests guest where guest.id = p_target_guest_id;
  if source_guest.merged_into_id is not null or target_guest.merged_into_id is not null then
    raise exception 'Only active guest profiles may be merged' using errcode = '42501';
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

-- Browser sessions may only edit human-entered profile fields. Creation and
-- every evidence ledger flow through server-owned commands.
revoke insert, update, delete on public.guests from authenticated;
revoke insert, update, delete on public.guest_contacts from authenticated;
revoke insert, update, delete on public.guest_notes from authenticated;
revoke insert, update, delete on public.guest_consents from authenticated;
revoke insert, update on public.guest_tag_assignments from authenticated;
revoke insert, update, delete on public.guest_merge_events from authenticated;
revoke insert, delete on public.guest_locations from authenticated;
revoke update on public.guest_locations from authenticated;
grant update (is_home_location) on public.guest_locations to authenticated;
-- Visit and reservation rows feed spend/activity rollups and originate from
-- trusted imports/adapters. Browser managers may read them through RLS but
-- cannot forge, rewrite, or remove that operational evidence directly.
revoke insert, update, delete on public.guest_visits from authenticated;
revoke insert, update, delete on public.reservations from authenticated;

revoke all on function public.save_guest(uuid, uuid, uuid, text, text, text, text, text, date, boolean, text, text, text) from public;
revoke all on function public.add_guest_note(uuid, uuid, uuid, text, boolean) from public;
revoke all on function public.save_guest_contact(uuid, uuid, uuid, text, text, text, boolean) from public;
revoke all on function public.record_guest_consent(uuid, uuid, text, public.consent_status, text) from public;
revoke all on function public.assign_guest_tag(uuid, uuid, uuid) from public;
revoke all on function public.merge_guests(uuid, uuid, uuid, numeric, jsonb) from public;
revoke all on function public.guard_guest_profile_owned_fields() from public, anon, authenticated;
revoke all on function public.guard_guest_append_only_evidence() from public, anon, authenticated;

grant execute on function public.save_guest(uuid, uuid, uuid, text, text, text, text, text, date, boolean, text, text, text) to authenticated;
grant execute on function public.add_guest_note(uuid, uuid, uuid, text, boolean) to authenticated;
grant execute on function public.save_guest_contact(uuid, uuid, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.record_guest_consent(uuid, uuid, text, public.consent_status, text) to authenticated;
grant execute on function public.assign_guest_tag(uuid, uuid, uuid) to authenticated;
grant execute on function public.merge_guests(uuid, uuid, uuid, numeric, jsonb) to authenticated;

comment on function public.save_guest(uuid, uuid, uuid, text, text, text, text, text, date, boolean, text, text, text)
is 'Idempotently creates or updates only human-entered guest profile fields; null guest id creates request-id guest.';
comment on function public.merge_guests(uuid, uuid, uuid, numeric, jsonb)
is 'Atomically reparents CRM children, resolves location/contact/tag collisions, records immutable merge evidence, and tombstones the source guest.';
