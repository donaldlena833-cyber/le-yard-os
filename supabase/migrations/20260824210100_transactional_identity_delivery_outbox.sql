-- Durable, service-only delivery work for identity-bound workflows. This is
-- deliberately separate from reservation_message_outbox: reservation delivery
-- has reservation/version fences that must never be diluted for general mail.

create table private.identity_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  workflow text not null check (workflow in ('guest_interest_verification', 'user_invitation')),
  correlation_id uuid not null,
  channel text not null check (channel in ('email', 'sms')),
  destination text not null check (length(btrim(destination)) between 3 and 320),
  destination_hash text not null check (destination_hash ~ '^[0-9a-f]{64}$'),
  template_data jsonb not null default '{}'::jsonb check (jsonb_typeof(template_data) = 'object'),
  status text not null default 'queued'
    check (status in ('queued', 'dispatching', 'sent', 'failed', 'cancelled')),
  dedupe_key text not null check (length(btrim(dedupe_key)) between 1 and 240),
  attempts integer not null default 0 check (attempts between 0 and 20),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default clock_timestamp(),
  claim_token uuid,
  claimed_by uuid,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, dedupe_key),
  check (
    (status = 'dispatching' and claim_token is not null and claimed_by is not null
      and claimed_at is not null and lease_expires_at is not null)
    or (status <> 'dispatching' and claim_token is null and claimed_by is null
      and claimed_at is null and lease_expires_at is null)
  )
);

create index identity_delivery_due_idx
on private.identity_delivery_jobs (status, next_attempt_at, lease_expires_at, created_at)
where status in ('queued', 'failed', 'dispatching');

revoke all on table private.identity_delivery_jobs from public, anon, authenticated;
grant select, insert, update on table private.identity_delivery_jobs to service_role;

create function public.service_enqueue_identity_delivery(
  p_organization_id uuid,
  p_location_id uuid,
  p_workflow text,
  p_correlation_id uuid,
  p_channel text,
  p_destination text,
  p_destination_hash text,
  p_template_data jsonb,
  p_dedupe_key text
)
returns uuid
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  delivery_id uuid;
  existing private.identity_delivery_jobs%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_correlation_id is null
    or p_workflow not in ('guest_interest_verification', 'user_invitation')
    or p_channel not in ('email', 'sms')
    or length(btrim(coalesce(p_destination, ''))) not between 3 and 320
    or p_destination_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(coalesce(p_template_data, '{}'::jsonb)) <> 'object'
    or length(btrim(coalesce(p_dedupe_key, ''))) not between 1 and 240 then
    raise exception 'Invalid identity delivery work' using errcode = '22023';
  end if;
  if p_location_id is not null and not exists (
    select 1 from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id
  ) then
    raise exception 'Identity delivery location is unavailable' using errcode = '23503';
  end if;

  select * into existing
  from private.identity_delivery_jobs job
  where job.organization_id = p_organization_id
    and job.dedupe_key = btrim(p_dedupe_key);
  if found then
    if existing.workflow <> p_workflow
      or existing.correlation_id <> p_correlation_id
      or existing.channel <> p_channel
      or existing.destination_hash <> p_destination_hash
      or existing.template_data <> coalesce(p_template_data, '{}'::jsonb) then
      raise exception 'Identity delivery key was reused' using errcode = '23505';
    end if;
    return existing.id;
  end if;

  insert into private.identity_delivery_jobs (
    organization_id, location_id, workflow, correlation_id, channel,
    destination, destination_hash, template_data, dedupe_key
  ) values (
    p_organization_id, p_location_id, p_workflow, p_correlation_id, p_channel,
    btrim(p_destination), p_destination_hash,
    coalesce(p_template_data, '{}'::jsonb), btrim(p_dedupe_key)
  ) returning id into delivery_id;
  return delivery_id;
end
$$;

create function public.service_claim_identity_delivery(
  p_worker_id uuid,
  p_limit integer default 25,
  p_lease_seconds integer default 120,
  p_now timestamptz default clock_timestamp()
)
returns setof jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  job private.identity_delivery_jobs%rowtype;
  claim uuid;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_limit not between 1 and 100
    or p_lease_seconds not between 30 and 900 or p_now is null then
    raise exception 'Invalid identity delivery claim' using errcode = '22023';
  end if;

  for job in
    select candidate.*
    from private.identity_delivery_jobs candidate
    where candidate.attempts < candidate.max_attempts
      and (
        (candidate.status in ('queued', 'failed') and candidate.next_attempt_at <= p_now)
        or (candidate.status = 'dispatching' and candidate.lease_expires_at <= p_now)
      )
    order by candidate.next_attempt_at, candidate.created_at
    limit p_limit
    for update skip locked
  loop
    claim := gen_random_uuid();
    update private.identity_delivery_jobs candidate
    set status = 'dispatching',
        attempts = candidate.attempts + 1,
        claim_token = claim,
        claimed_by = p_worker_id,
        claimed_at = p_now,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        updated_at = p_now
    where candidate.id = job.id
    returning * into job;

    return next jsonb_build_object(
      'id', job.id,
      'claimToken', claim,
      'workflow', job.workflow,
      'correlationId', job.correlation_id,
      'organizationId', job.organization_id,
      'locationId', job.location_id,
      'channel', job.channel,
      'destination', job.destination,
      'destinationHash', job.destination_hash,
      'templateData', job.template_data,
      'attempts', job.attempts
    );
  end loop;
end
$$;

create function public.service_complete_identity_delivery(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_next_attempt_at timestamptz default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  job private.identity_delivery_jobs%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_status not in ('sent', 'failed', 'cancelled') then
    raise exception 'Invalid identity delivery completion' using errcode = '22023';
  end if;
  select * into job from private.identity_delivery_jobs candidate
  where candidate.id = p_id for update;
  if not found or job.status <> 'dispatching' or job.claim_token <> p_claim_token
    or job.lease_expires_at <= clock_timestamp() then
    raise exception 'Identity delivery lease is unavailable' using errcode = 'P0002';
  end if;
  if p_status = 'failed' and p_next_attempt_at is null and job.attempts < job.max_attempts then
    raise exception 'Retryable identity delivery needs a next attempt' using errcode = '22023';
  end if;

  update private.identity_delivery_jobs candidate
  set status = p_status,
      provider_message_id = case when p_status = 'sent' then nullif(btrim(p_provider_message_id), '') else null end,
      last_error_code = case when p_status = 'failed' then left(nullif(btrim(p_error_code), ''), 120) else null end,
      next_attempt_at = case
        when p_status = 'failed' and job.attempts < job.max_attempts then p_next_attempt_at
        else candidate.next_attempt_at
      end,
      sent_at = case when p_status = 'sent' then clock_timestamp() else candidate.sent_at end,
      claim_token = null,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where candidate.id = job.id
  returning * into job;
  return jsonb_build_object('id', job.id, 'status', job.status, 'attempts', job.attempts);
end
$$;

revoke all on function public.service_enqueue_identity_delivery(
  uuid, uuid, text, uuid, text, text, text, jsonb, text
) from public, anon, authenticated;
revoke all on function public.service_claim_identity_delivery(uuid, integer, integer, timestamptz)
from public, anon, authenticated;
revoke all on function public.service_complete_identity_delivery(
  uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.service_enqueue_identity_delivery(
  uuid, uuid, text, uuid, text, text, text, jsonb, text
) to service_role;
grant execute on function public.service_claim_identity_delivery(uuid, integer, integer, timestamptz)
to service_role;
grant execute on function public.service_complete_identity_delivery(
  uuid, uuid, text, text, text, timestamptz
) to service_role;
