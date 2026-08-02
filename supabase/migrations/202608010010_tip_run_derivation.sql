-- Le Yard OS: derive tip inputs from approved closeouts and labor evidence.

alter table public.tip_runs
add column prepared_at timestamptz,
add column prepared_by uuid references auth.users(id) on delete set null,
add column preparation_version text,
add column derivation_hash text;

alter table public.tip_runs
add constraint tip_runs_preparation_evidence_check
check (
  (
    prepared_at is null
    and prepared_by is null
    and preparation_version is null
    and derivation_hash is null
  )
  or (
    prepared_at is not null
    and prepared_by is not null
    and preparation_version = 'closeout-labor-v1'
    and derivation_hash ~ '^[0-9a-f]{64}$'
  )
);

create unique index tip_runs_one_per_closeout
on public.tip_runs (closeout_id)
where closeout_id is not null;

-- V1 deliberately supports one tip-bearing closeout per location/business
-- date. A future shift-window contract can relax this without ever allowing
-- the same daily labor evidence to be paid twice.
create unique index shift_closeouts_one_tip_bearing_per_business_date
on public.shift_closeouts (location_id, business_date)
where status <> 'rejected'
  and card_tips_cents + cash_tips_cents + service_charges_cents > 0;

alter table public.tip_run_participants
add column derivation jsonb not null default '{}'::jsonb
check (jsonb_typeof(derivation) = 'object');

create table private.tip_preparation_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  closeout_id uuid not null,
  policy_version_id uuid not null,
  actor_id uuid not null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.tip_preparation_requests from public, anon, authenticated;

alter table public.time_entries
add column review_note text;

create table private.time_entry_review_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  time_entry_id uuid not null,
  actor_id uuid not null,
  approve boolean not null,
  review_note text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.time_entry_review_requests from public, anon, authenticated;

-- Every mutation that can change payroll labor evidence shares the same
-- transaction-scoped key as preparation/calculation. The payroll commands do
-- not row-lock the labor scan, so a direct UPDATE that acquired a tuple lock
-- first cannot deadlock while it waits here.
create function private.lock_tip_labor_evidence(
  p_organization_id uuid,
  p_location_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  location_timezone text;
  first_date date;
  last_date date;
  business_date date;
begin
  if p_organization_id is null
    or p_location_id is null
    or p_started_at is null then
    return;
  end if;
  select location.timezone into location_timezone
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id;
  if location_timezone is null then return; end if;

  first_date := (p_started_at at time zone location_timezone)::date;
  last_date := (
    greatest(
      p_started_at,
      coalesce(p_ended_at, p_started_at) - interval '1 microsecond'
    ) at time zone location_timezone
  )::date;
  for business_date in
    select day_value::date
    from generate_series(first_date, last_date, interval '1 day') day_value
    order by day_value
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'tip-evidence:' || p_organization_id::text || ':'
        || p_location_id::text || ':' || business_date::text,
      0
    ));
  end loop;
end
$$;

revoke all on function private.lock_tip_labor_evidence(uuid, uuid, timestamptz, timestamptz)
from public, anon, authenticated;

create function public.serialize_tip_labor_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  entry_row public.time_entries%rowtype;
begin
  if tg_table_name = 'time_entries' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform private.lock_tip_labor_evidence(
        old.organization_id, old.location_id, old.clocked_in_at, old.clocked_out_at
      );
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform private.lock_tip_labor_evidence(
        new.organization_id, new.location_id, new.clocked_in_at, new.clocked_out_at
      );
    end if;
  else
    select * into entry_row
    from public.time_entries entry
    where entry.id = case when tg_op = 'INSERT' then new.time_entry_id else old.time_entry_id end;
    if entry_row.id is not null then
      perform private.lock_tip_labor_evidence(
        entry_row.organization_id,
        entry_row.location_id,
        entry_row.clocked_in_at,
        entry_row.clocked_out_at
      );
    end if;
    if tg_op = 'UPDATE' and new.time_entry_id is distinct from old.time_entry_id then
      select * into entry_row
      from public.time_entries entry
      where entry.id = new.time_entry_id;
      if entry_row.id is not null then
        perform private.lock_tip_labor_evidence(
          entry_row.organization_id,
          entry_row.location_id,
          entry_row.clocked_in_at,
          entry_row.clocked_out_at
        );
      end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger serialize_time_entry_tip_evidence
before insert or update or delete on public.time_entries
for each row execute function public.serialize_tip_labor_evidence();

create trigger serialize_time_break_tip_evidence
before insert or update or delete on public.time_breaks
for each row execute function public.serialize_tip_labor_evidence();

create function public.review_time_entry(
  p_request_id uuid,
  p_time_entry_id uuid,
  p_approve boolean,
  p_review_note text default null
)
returns public.time_entries
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  entry_row public.time_entries%rowtype;
  employee_user_id uuid;
  location_timezone text;
  prior private.time_entry_review_requests%rowtype;
  clean_note text := nullif(btrim(p_review_note), '');
  requested_status public.time_entry_status := case
    when p_approve then 'approved'::public.time_entry_status
    else 'rejected'::public.time_entry_status
  end;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_approve is null or (clean_note is not null and length(clean_note) > 2000) then
    raise exception 'A valid time-entry decision is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('time-entry-review:' || p_request_id::text, 0));

  select * into prior
  from private.time_entry_review_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null and (
    prior.actor_id is distinct from actor_id
    or prior.time_entry_id is distinct from p_time_entry_id
    or prior.approve is distinct from p_approve
    or prior.review_note is distinct from clean_note
  ) then
    raise exception 'Time-entry review request id was reused' using errcode = '23505';
  end if;

  select * into entry_row
  from public.time_entries entry
  where entry.id = p_time_entry_id;
  select employee.user_id into employee_user_id
  from public.employees employee
  where employee.organization_id = entry_row.organization_id
    and employee.id = entry_row.employee_id;
  if entry_row.id is null then
    raise exception 'Time entry not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(entry_row.organization_id, entry_row.location_id) then
    raise exception 'Not authorized to review this time entry' using errcode = '42501';
  end if;
  if employee_user_id = actor_id then
    raise exception 'Employees cannot review their own time entries' using errcode = '42501';
  end if;
  if entry_row.clocked_out_at is null then
    raise exception 'Open time entries cannot be reviewed' using errcode = '23514';
  end if;
  if entry_row.clocked_out_at <= entry_row.clocked_in_at
    or entry_row.clocked_out_at - entry_row.clocked_in_at > interval '48 hours'
    or entry_row.clocked_in_at < clock_timestamp() - interval '370 days'
    or entry_row.clocked_in_at > clock_timestamp() + interval '5 minutes'
    or entry_row.clocked_out_at < clock_timestamp() - interval '370 days'
    or entry_row.clocked_out_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'Submitted time entry is outside safe payroll bounds'
      using errcode = '22023';
  end if;

  select location.timezone into location_timezone
  from public.locations location
  where location.organization_id = entry_row.organization_id
    and location.id = entry_row.location_id
  for update;
  if location_timezone is null then
    raise exception 'Time entry location is unavailable' using errcode = '23514';
  end if;
  perform private.lock_tip_labor_evidence(
    entry_row.organization_id,
    entry_row.location_id,
    entry_row.clocked_in_at,
    entry_row.clocked_out_at
  );
  select * into entry_row
  from public.time_entries entry
  where entry.id = p_time_entry_id
  for update;

  if prior.request_id is not null then
    if entry_row.status = requested_status
      and entry_row.approved_by = actor_id
      and entry_row.review_note is not distinct from clean_note then
      return entry_row;
    end if;
    raise exception 'Time-entry review ledger has no matching result' using errcode = '40001';
  end if;
  if entry_row.status <> 'submitted' then
    raise exception 'Only submitted time entries may be reviewed' using errcode = '23514';
  end if;

  insert into private.time_entry_review_requests (
    request_id, organization_id, location_id, time_entry_id,
    actor_id, approve, review_note
  ) values (
    p_request_id, entry_row.organization_id, entry_row.location_id,
    entry_row.id, actor_id, p_approve, clean_note
  );
  update public.time_entries entry_update
  set status = requested_status,
      approved_by = actor_id,
      approved_at = clock_timestamp(),
      review_note = clean_note
  where entry_update.id = entry_row.id
  returning * into entry_row;
  update private.time_entry_review_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return entry_row;
end
$$;

revoke update (status, approved_by, approved_at, review_note) on public.time_entries
from authenticated;
revoke all on function public.review_time_entry(uuid, uuid, boolean, text) from public;
grant execute on function public.review_time_entry(uuid, uuid, boolean, text) to authenticated;

-- Only approved, explicitly source-backed weighted-hours/hour policies may be
-- used for payroll. Legacy points-only policy versions are intentionally not
-- accepted because they contain no worked-time evidence.
create function public.guard_tip_policy_operational_contract()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  source_count integer;
  distinct_source_count integer;
begin
  if tg_op = 'UPDATE'
    and old.approved_at is null
    and new.approved_at is not null then
    if new.distribution_method = 'points' then
      raise exception 'Points-only tip policies are not valid for derived payroll runs'
        using errcode = '23514';
    end if;
    if jsonb_typeof(new.source_rules -> 'closeout_sources') <> 'array' then
      raise exception 'Tip policy source_rules.closeout_sources must be an array'
        using errcode = '23514';
    end if;
    select count(*), count(distinct source_name)
    into source_count, distinct_source_count
    from jsonb_array_elements_text(new.source_rules -> 'closeout_sources') source(source_name)
    where source_name in ('card_tips', 'cash_tips', 'service_charges');
    if source_count = 0
      or source_count <> jsonb_array_length(new.source_rules -> 'closeout_sources')
      or source_count <> distinct_source_count then
      raise exception 'Tip policy closeout sources must be unique supported source names'
        using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger tip_policy_operational_contract_guard
before update on public.tip_pool_policy_versions
for each row execute function public.guard_tip_policy_operational_contract();

revoke all on function public.serialize_tip_labor_evidence()
from public, anon, authenticated;
revoke all on function public.guard_tip_policy_operational_contract()
from public, anon, authenticated;

create function public.tip_run_derivation_hash(
  p_closeout_id uuid,
  p_policy_version_id uuid
)
returns text
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  closeout_row public.shift_closeouts%rowtype;
  location_timezone text;
  version_row public.tip_pool_policy_versions%rowtype;
  policy_row public.tip_pool_policies%rowtype;
  day_start timestamptz;
  day_end timestamptz;
  rules_payload jsonb;
  entries_payload jsonb;
  breaks_payload jsonb;
  payload jsonb;
begin
  select * into closeout_row
  from public.shift_closeouts closeout
  where closeout.id = p_closeout_id;
  select location.timezone into location_timezone
  from public.locations location
  where location.organization_id = closeout_row.organization_id
    and location.id = closeout_row.location_id;
  select * into version_row
  from public.tip_pool_policy_versions version
  where version.id = p_policy_version_id;
  select * into policy_row
  from public.tip_pool_policies policy
  where policy.id = version_row.policy_id;
  if closeout_row.id is null
    or location_timezone is null
    or version_row.id is null
    or policy_row.id is null then
    return null;
  end if;

  day_start := closeout_row.business_date::timestamp at time zone location_timezone;
  day_end := (closeout_row.business_date + 1)::timestamp at time zone location_timezone;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', rule.id,
        'job_role_id', rule.job_role_id,
        'eligible', rule.eligible,
        'points', rule.points,
        'minimum_minutes', rule.minimum_minutes
      ) order by rule.job_role_id, rule.id
    ),
    '[]'::jsonb
  ) into rules_payload
  from public.tip_pool_eligibility_rules rule
  where rule.organization_id = version_row.organization_id
    and rule.policy_version_id = version_row.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', entry.id,
        'employee_id', entry.employee_id,
        'job_role_id', entry.job_role_id,
        'clocked_in_at', entry.clocked_in_at,
        'clocked_out_at', entry.clocked_out_at,
        'status', entry.status,
        'updated_at', entry.updated_at
      ) order by entry.id
    ),
    '[]'::jsonb
  ) into entries_payload
  from public.time_entries entry
  where entry.organization_id = closeout_row.organization_id
    and entry.location_id = closeout_row.location_id
    and entry.status in ('approved', 'corrected')
    and entry.clocked_out_at is not null
    and tstzrange(entry.clocked_in_at, entry.clocked_out_at, '[)')
      && tstzrange(day_start, day_end, '[)');

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', break_row.id,
        'time_entry_id', break_row.time_entry_id,
        'started_at', break_row.started_at,
        'ended_at', break_row.ended_at,
        'is_paid', break_row.is_paid,
        'updated_at', break_row.updated_at
      ) order by break_row.id
    ),
    '[]'::jsonb
  ) into breaks_payload
  from public.time_breaks break_row
  join public.time_entries entry on entry.id = break_row.time_entry_id
  where entry.organization_id = closeout_row.organization_id
    and entry.location_id = closeout_row.location_id
    and entry.status in ('approved', 'corrected')
    and entry.clocked_out_at is not null
    and tstzrange(entry.clocked_in_at, entry.clocked_out_at, '[)')
      && tstzrange(day_start, day_end, '[)');

  payload := jsonb_build_object(
    'contract', 'closeout-labor-v1',
    'closeout', jsonb_build_object(
      'id', closeout_row.id,
      'organization_id', closeout_row.organization_id,
      'location_id', closeout_row.location_id,
      'business_date', closeout_row.business_date,
      'shift_label', closeout_row.shift_label,
      'status', closeout_row.status,
      'card_tips_cents', closeout_row.card_tips_cents,
      'cash_tips_cents', closeout_row.cash_tips_cents,
      'service_charges_cents', closeout_row.service_charges_cents,
      'updated_at', closeout_row.updated_at
    ),
    'location', jsonb_build_object(
      'id', closeout_row.location_id,
      'timezone', location_timezone
    ),
    'policy', jsonb_build_object(
      'id', policy_row.id,
      'organization_id', policy_row.organization_id,
      'location_id', policy_row.location_id,
      'version_id', version_row.id,
      'distribution_method', version_row.distribution_method,
      'effective_from', version_row.effective_from,
      'effective_to', version_row.effective_to,
      'source_rules', version_row.source_rules,
      'rounding_rule', version_row.rounding_rule,
      'approved_at', version_row.approved_at
    ),
    'eligibility_rules', rules_payload,
    'time_entries', entries_payload,
    'time_breaks', breaks_payload
  );
  return encode(extensions.digest(payload::text, 'sha256'), 'hex');
end
$$;

revoke all on function public.tip_run_derivation_hash(uuid, uuid) from public, anon, authenticated;

create function public.prepare_tip_run_from_closeout(
  p_request_id uuid,
  p_closeout_id uuid,
  p_policy_version_id uuid
)
returns public.tip_runs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  closeout_row public.shift_closeouts%rowtype;
  location_row public.locations%rowtype;
  version_row public.tip_pool_policy_versions%rowtype;
  policy_row public.tip_pool_policies%rowtype;
  run_row public.tip_runs%rowtype;
  prior private.tip_preparation_requests%rowtype;
  day_start timestamptz;
  day_end timestamptz;
  derived_hash text;
  source_total bigint;
  participant_count integer;
  source_count integer;
  distinct_source_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tip-closeout:' || p_closeout_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('tip-prepare:' || p_request_id::text, 0));

  select * into prior
  from private.tip_preparation_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null and (
    prior.actor_id is distinct from actor_id
    or prior.closeout_id is distinct from p_closeout_id
    or prior.policy_version_id is distinct from p_policy_version_id
  ) then
    raise exception 'Tip preparation request id was reused' using errcode = '23505';
  end if;

  select * into closeout_row
  from public.shift_closeouts closeout
  where closeout.id = p_closeout_id
  for update;
  if closeout_row.id is null then
    raise exception 'Closeout not found' using errcode = 'P0002';
  end if;
  select * into location_row
  from public.locations location
  where location.organization_id = closeout_row.organization_id
    and location.id = closeout_row.location_id
    and location.is_active
  for update;
  if location_row.id is null
    or not public.can_manage_location(closeout_row.organization_id, closeout_row.location_id) then
    raise exception 'Not authorized to prepare tips for this closeout'
      using errcode = '42501';
  end if;
  if closeout_row.status <> 'approved' then
    raise exception 'Tip preparation requires an independently approved closeout'
      using errcode = '23514';
  end if;
  perform private.lock_tip_labor_evidence(
    closeout_row.organization_id,
    closeout_row.location_id,
    closeout_row.business_date::timestamp at time zone location_row.timezone,
    (closeout_row.business_date + 1)::timestamp at time zone location_row.timezone
  );

  select * into version_row
  from public.tip_pool_policy_versions version
  where version.id = p_policy_version_id
  for update;
  select * into policy_row
  from public.tip_pool_policies policy
  where policy.id = version_row.policy_id
  for update;
  if version_row.id is null
    or policy_row.id is null
    or version_row.organization_id <> closeout_row.organization_id
    or policy_row.organization_id <> closeout_row.organization_id
    or (policy_row.location_id is not null
      and policy_row.location_id <> closeout_row.location_id)
    or version_row.approved_at is null
    or version_row.distribution_method = 'points'
    or version_row.effective_from > closeout_row.business_date
    or (version_row.effective_to is not null and version_row.effective_to < closeout_row.business_date) then
    raise exception 'Approved policy version does not match the closeout scope or date'
      using errcode = '23514';
  end if;
  if jsonb_typeof(version_row.source_rules -> 'closeout_sources') <> 'array' then
    raise exception 'Policy version has no valid closeout source contract'
      using errcode = '23514';
  end if;
  select count(*), count(distinct source_name)
  into source_count, distinct_source_count
  from jsonb_array_elements_text(
    version_row.source_rules -> 'closeout_sources'
  ) source(source_name)
  where source_name in ('card_tips', 'cash_tips', 'service_charges');
  if source_count = 0
    or source_count <> jsonb_array_length(version_row.source_rules -> 'closeout_sources')
    or source_count <> distinct_source_count then
    raise exception 'Policy closeout sources must be unique supported source names'
      using errcode = '23514';
  end if;

  day_start := closeout_row.business_date::timestamp at time zone location_row.timezone;
  day_end := (closeout_row.business_date + 1)::timestamp at time zone location_row.timezone;
  perform 1
  from public.tip_pool_eligibility_rules rule
  where rule.policy_version_id = version_row.id
  for update;
  if prior.request_id is null then
    if exists (select 1 from public.tip_runs run where run.id = p_request_id)
      or exists (select 1 from public.tip_runs run where run.closeout_id = closeout_row.id) then
      raise exception 'A tip run already exists for this request or closeout'
        using errcode = '23505';
    end if;
    insert into private.tip_preparation_requests (
      request_id, organization_id, location_id, closeout_id, policy_version_id, actor_id
    ) values (
      p_request_id, closeout_row.organization_id, closeout_row.location_id,
      closeout_row.id, version_row.id, actor_id
    );
    insert into public.tip_runs (
      id, organization_id, location_id, policy_version_id, closeout_id,
      business_date, shift_label, status, created_by
    ) values (
      p_request_id, closeout_row.organization_id, closeout_row.location_id,
      version_row.id, closeout_row.id, closeout_row.business_date,
      closeout_row.shift_label, 'draft', actor_id
    ) returning * into run_row;
  else
    select * into run_row
    from public.tip_runs run
    where run.id = prior.request_id
    for update;
    if run_row.id is null then
      raise exception 'Tip preparation ledger has no result row' using errcode = '40001';
    end if;
    if run_row.closeout_id is distinct from closeout_row.id
      or run_row.policy_version_id is distinct from version_row.id
      or run_row.created_by is distinct from actor_id then
      raise exception 'Tip preparation result no longer matches its request'
        using errcode = '40001';
    end if;
    if run_row.locked_at is not null or run_row.status = 'approved' then
      return run_row;
    end if;
    if run_row.status = 'calculated' then
      update public.tip_runs run_update
      set status = 'draft',
          distributable_cents = 0,
          allocated_cents = 0,
          calculated_at = null,
          updated_at = clock_timestamp()
      where run_update.id = run_row.id
      returning * into run_row;
    elsif run_row.status <> 'draft' then
      raise exception 'Only draft or unlocked calculated runs may be re-prepared'
        using errcode = '23514';
    end if;
  end if;

  delete from public.tip_allocations allocation where allocation.tip_run_id = run_row.id;
  delete from public.tip_sources source where source.tip_run_id = run_row.id;
  delete from public.tip_run_participants participant where participant.tip_run_id = run_row.id;

  insert into public.tip_sources (
    organization_id, tip_run_id, source_type, label, amount_cents,
    is_distributable, reference_type, reference_id
  )
  select closeout_row.organization_id,
    run_row.id,
    case source.source_name
      when 'card_tips' then 'card_tips'
      when 'cash_tips' then 'cash_tips'
      else 'service_charge'
    end,
    case source.source_name
      when 'card_tips' then 'Closeout card tips'
      when 'cash_tips' then 'Closeout cash tips'
      else 'Closeout service charges'
    end,
    case source.source_name
      when 'card_tips' then closeout_row.card_tips_cents
      when 'cash_tips' then closeout_row.cash_tips_cents
      else closeout_row.service_charges_cents
    end,
    true,
    'shift_closeout',
    closeout_row.id
  from jsonb_array_elements_text(
    version_row.source_rules -> 'closeout_sources'
  ) source(source_name);

  with entry_minutes as (
    select entry.id,
      entry.employee_id,
      entry.job_role_id,
      greatest(
        0,
        floor((
          extract(epoch from (
            least(entry.clocked_out_at, day_end)
            - greatest(entry.clocked_in_at, day_start)
          ))
          - coalesce((
            select sum(extract(epoch from (
              least(break_row.ended_at, day_end)
              - greatest(break_row.started_at, day_start)
            )))
            from public.time_breaks break_row
            where break_row.time_entry_id = entry.id
              and not break_row.is_paid
              and break_row.ended_at is not null
              and tstzrange(break_row.started_at, break_row.ended_at, '[)')
                && tstzrange(day_start, day_end, '[)')
          ), 0)
        ) / 60)
      )::integer as worked_minutes
    from public.time_entries entry
    where entry.organization_id = closeout_row.organization_id
      and entry.location_id = closeout_row.location_id
      and entry.status in ('approved', 'corrected')
      and entry.clocked_out_at is not null
      and tstzrange(entry.clocked_in_at, entry.clocked_out_at, '[)')
        && tstzrange(day_start, day_end, '[)')
  ), role_minutes as (
    select entry.employee_id,
      entry.job_role_id,
      sum(entry.worked_minutes)::integer as worked_minutes,
      array_agg(entry.id order by entry.id) as source_time_entry_ids
    from entry_minutes entry
    where entry.worked_minutes > 0
    group by entry.employee_id, entry.job_role_id
  ), eligible_roles as (
    select role_minutes.*,
      rule.points,
      rule.minimum_minutes
    from role_minutes
    join public.tip_pool_eligibility_rules rule
      on rule.organization_id = closeout_row.organization_id
     and rule.policy_version_id = version_row.id
     and rule.job_role_id = role_minutes.job_role_id
    where rule.eligible
      and role_minutes.worked_minutes >= rule.minimum_minutes
  ), employee_rollup as (
    select role.employee_id,
      sum(role.worked_minutes)::integer as worked_minutes,
      (
        sum(role.worked_minutes::numeric * role.points)
        / nullif(sum(role.worked_minutes), 0)
      )::numeric(10,4) as effective_points,
      (array_agg(
        role.job_role_id
        order by role.worked_minutes desc, role.job_role_id
      ))[1] as representative_job_role_id
    from eligible_roles role
    group by role.employee_id
  )
  insert into public.tip_run_participants (
    organization_id, tip_run_id, employee_id, job_role_id,
    worked_minutes, points, eligible, source_time_entry_ids, derivation
  )
  select closeout_row.organization_id,
    run_row.id,
    employee.employee_id,
    employee.representative_job_role_id,
    employee.worked_minutes,
    employee.effective_points,
    true,
    array(
      select distinct source_id
      from eligible_roles role,
        unnest(role.source_time_entry_ids) source_id
      where role.employee_id = employee.employee_id
      order by source_id
    ),
    jsonb_build_object(
      'version', 'closeout-labor-v1',
      'distribution_method', version_row.distribution_method,
      'role_segments', (
        select jsonb_agg(
          jsonb_build_object(
            'job_role_id', role.job_role_id,
            'worked_minutes', role.worked_minutes,
            'points', role.points,
            'minimum_minutes', role.minimum_minutes,
            'source_time_entry_ids', role.source_time_entry_ids
          ) order by role.job_role_id
        )
        from eligible_roles role
        where role.employee_id = employee.employee_id
      )
    )
  from employee_rollup employee;

  if exists (
    select 1
    from public.tip_adjustments adjustment
    where adjustment.tip_run_id = run_row.id
      and not exists (
        select 1
        from public.tip_run_participants participant
        where participant.tip_run_id = run_row.id
          and participant.employee_id = adjustment.employee_id
      )
      and not exists (
        select 1
        from public.employee_job_roles assignment
        where assignment.organization_id = closeout_row.organization_id
          and assignment.location_id = closeout_row.location_id
          and assignment.employee_id = adjustment.employee_id
          and assignment.effective_from <= closeout_row.business_date
          and (assignment.effective_to is null
            or assignment.effective_to >= closeout_row.business_date)
      )
  ) then
    raise exception 'Every adjusted employee must have an effective role at this location'
      using errcode = '23514';
  end if;

  insert into public.tip_run_participants (
    organization_id,
    tip_run_id,
    employee_id,
    job_role_id,
    worked_minutes,
    points,
    eligible,
    exclusion_reason,
    source_time_entry_ids,
    derivation
  )
  select closeout_row.organization_id,
    run_row.id,
    adjustment_employee.employee_id,
    assignment.job_role_id,
    0,
    0,
    false,
    'adjustment_only',
    '{}'::uuid[],
    jsonb_build_object(
      'version', 'closeout-labor-v1',
      'distribution_method', version_row.distribution_method,
      'adjustment_only', true,
      'role_segments', '[]'::jsonb
    )
  from (
    select distinct adjustment.employee_id
    from public.tip_adjustments adjustment
    where adjustment.tip_run_id = run_row.id
  ) adjustment_employee
  join lateral (
    select role.job_role_id
    from public.employee_job_roles role
    where role.organization_id = closeout_row.organization_id
      and role.location_id = closeout_row.location_id
      and role.employee_id = adjustment_employee.employee_id
      and role.effective_from <= closeout_row.business_date
      and (role.effective_to is null or role.effective_to >= closeout_row.business_date)
    order by role.is_primary desc, role.effective_from desc, role.id
    limit 1
  ) assignment on true
  where not exists (
    select 1
    from public.tip_run_participants participant
    where participant.tip_run_id = run_row.id
      and participant.employee_id = adjustment_employee.employee_id
  );

  select coalesce(sum(source.amount_cents), 0)
  into source_total
  from public.tip_sources source
  where source.tip_run_id = run_row.id and source.is_distributable;
  select count(*)::integer
  into participant_count
  from public.tip_run_participants participant
  where participant.tip_run_id = run_row.id and participant.eligible;
  if source_total <= 0 then
    raise exception 'Approved closeout has no positive distributable tip sources'
      using errcode = '23514';
  end if;
  if participant_count = 0 then
    raise exception 'No eligible closed labor entries match this closeout and policy'
      using errcode = '23514';
  end if;

  derived_hash := public.tip_run_derivation_hash(closeout_row.id, version_row.id);
  update public.tip_runs run_update
  set prepared_at = clock_timestamp(),
      prepared_by = actor_id,
      preparation_version = 'closeout-labor-v1',
      derivation_hash = derived_hash,
      updated_at = clock_timestamp()
  where run_update.id = run_row.id
  returning * into run_row;
  update private.tip_preparation_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return run_row;
end
$$;

revoke insert, update, delete on public.tip_runs from authenticated;
revoke insert, update, delete on public.tip_sources from authenticated;
revoke insert, update, delete on public.tip_run_participants from authenticated;
revoke insert, update, delete on public.tip_allocations from authenticated;
revoke all on function public.prepare_tip_run_from_closeout(uuid, uuid, uuid) from public;
grant execute on function public.prepare_tip_run_from_closeout(uuid, uuid, uuid) to authenticated;

alter function public.calculate_tip_run(uuid) rename to calculate_tip_run_unchecked;
revoke all on function public.calculate_tip_run_unchecked(uuid) from public, anon, authenticated;

create function public.calculate_tip_run(p_tip_run_id uuid)
returns public.tip_runs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  run_row public.tip_runs%rowtype;
  closeout_row public.shift_closeouts%rowtype;
  location_timezone text;
  day_start timestamptz;
  day_end timestamptz;
  current_hash text;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into run_row
  from public.tip_runs run
  where run.id = p_tip_run_id
  for update;
  if run_row.id is null then
    raise exception 'Tip run not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(run_row.organization_id, run_row.location_id) then
    raise exception 'Not authorized to calculate this tip run' using errcode = '42501';
  end if;
  if run_row.closeout_id is null
    or run_row.prepared_at is null
    or run_row.preparation_version <> 'closeout-labor-v1'
    or run_row.derivation_hash is null then
    raise exception 'Tip run inputs were not prepared from authoritative evidence'
      using errcode = '23514';
  end if;
  select * into closeout_row
  from public.shift_closeouts closeout
  where closeout.id = run_row.closeout_id
  for update;
  select location.timezone into location_timezone
  from public.locations location
  where location.organization_id = closeout_row.organization_id
    and location.id = closeout_row.location_id
  for update;
  if location_timezone is null then
    raise exception 'Tip run location is unavailable' using errcode = '23514';
  end if;
  day_start := closeout_row.business_date::timestamp at time zone location_timezone;
  day_end := (closeout_row.business_date + 1)::timestamp at time zone location_timezone;
  perform private.lock_tip_labor_evidence(
    run_row.organization_id,
    run_row.location_id,
    day_start,
    day_end
  );
  perform 1
  from public.tip_pool_policy_versions version
  where version.id = run_row.policy_version_id
  for update;
  perform 1
  from public.tip_pool_eligibility_rules rule
  where rule.policy_version_id = run_row.policy_version_id
  for update;
  current_hash := public.tip_run_derivation_hash(
    run_row.closeout_id,
    run_row.policy_version_id
  );
  if current_hash is distinct from run_row.derivation_hash then
    raise exception 'Tip labor evidence changed; rerun preparation before calculation'
      using errcode = '40001';
  end if;
  select * into run_row from public.calculate_tip_run_unchecked(run_row.id);
  return run_row;
end
$$;

revoke all on function public.calculate_tip_run(uuid) from public;
grant execute on function public.calculate_tip_run(uuid) to authenticated;

comment on function public.prepare_tip_run_from_closeout(uuid, uuid, uuid)
is 'Idempotently derives a draft tip run, closeout sources, and split-role effective weighted labor from approved evidence; request id equals tip run id.';
comment on function public.calculate_tip_run(uuid)
is 'Calculates only DB-prepared tip runs whose closeout, policy, labor, and break fingerprint is still current.';
