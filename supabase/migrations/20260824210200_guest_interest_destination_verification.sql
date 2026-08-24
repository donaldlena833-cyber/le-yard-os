-- Public interest is pending evidence until the submitted email destination is
-- proven. Unverified PII remains private and never mutates the canonical CRM.

alter table private.public_guest_interest_requests
  alter column guest_id drop not null,
  add column if not exists status text not null default 'pending',
  add column if not exists payload jsonb,
  add column if not exists normalized_email text,
  add column if not exists normalized_phone text,
  add column if not exists destination_hash text,
  add column if not exists verification_token_hash text,
  add column if not exists expires_at timestamptz,
  add column if not exists verified_at timestamptz;

update private.public_guest_interest_requests
set status = 'verified', verified_at = coalesce(verified_at, created_at)
where guest_id is not null and status = 'pending';

alter table private.public_guest_interest_requests
  add constraint public_guest_interest_status_check
    check (status in ('pending', 'verified', 'expired', 'cancelled')),
  add constraint public_guest_interest_payload_check
    check (payload is null or jsonb_typeof(payload) = 'object'),
  add constraint public_guest_interest_destination_hash_check
    check (destination_hash is null or destination_hash ~ '^[0-9a-f]{64}$'),
  add constraint public_guest_interest_verification_hash_check
    check (verification_token_hash is null or verification_token_hash ~ '^[0-9a-f]{64}$'),
  add constraint public_guest_interest_pending_evidence_check
    check (
      status <> 'pending'
      or (guest_id is null and payload is not null and normalized_email is not null
        and destination_hash is not null and verification_token_hash is not null
        and expires_at is not null and verified_at is null)
    );

create index public_guest_interest_pending_expiry_idx
on private.public_guest_interest_requests (status, expires_at)
where status = 'pending';

drop function if exists public.service_capture_guest_interest(
  uuid, uuid, uuid, text, text, text, text, smallint, smallint, boolean,
  text[], boolean, boolean, boolean, text
);

create function public.service_capture_guest_interest(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text default null,
  p_birthday_month smallint default null,
  p_birthday_day smallint default null,
  p_age_21_plus boolean default null,
  p_interests text[] default '{}'::text[],
  p_email_consent boolean default false,
  p_sms_consent boolean default false,
  p_profile_consent boolean default false,
  p_source text default 'coming_soon',
  p_verification_token_hash text default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  clean_first_name text := nullif(btrim(p_first_name), '');
  clean_last_name text := nullif(btrim(p_last_name), '');
  clean_email text := lower(nullif(btrim(p_email), ''));
  clean_phone text := nullif(btrim(p_phone), '');
  normalized_phone text;
  clean_interests text[];
  birthday_month_day text;
  payload jsonb;
  payload_hash text;
  destination_hash text;
  existing private.public_guest_interest_requests%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null or p_location_id is null
    or clean_first_name is null or length(clean_first_name) > 120
    or length(coalesce(clean_last_name, '')) > 120
    or clean_email is null or length(clean_email) > 320
    or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or not p_email_consent or p_sms_consent
    or p_source not in ('coming_soon', 'website', 'reservation_follow_up', 'order_follow_up')
    or p_verification_token_hash !~ '^[0-9a-f]{64}$'
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '48 hours'
    or not exists (
      select 1 from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id and location.is_active
    ) then
    raise exception 'Invalid pending guest interest payload' using errcode = '22023';
  end if;
  if clean_phone is not null then
    normalized_phone := regexp_replace(clean_phone, '[^0-9]', '', 'g');
    if length(normalized_phone) not between 7 and 20 then
      raise exception 'Invalid guest interest phone' using errcode = '22023';
    end if;
  end if;
  if (p_birthday_month is null) <> (p_birthday_day is null) then
    raise exception 'Birthday month and day must be provided together' using errcode = '22023';
  end if;
  if p_birthday_month is not null then
    begin
      perform make_date(2000, p_birthday_month, p_birthday_day);
    exception when others then
      raise exception 'Invalid birthday month and day' using errcode = '22023';
    end;
    birthday_month_day := lpad(p_birthday_month::text, 2, '0') || '-'
      || lpad(p_birthday_day::text, 2, '0');
  end if;
  select coalesce(array_agg(value order by value), '{}'::text[])
  into clean_interests
  from (
    select distinct btrim(item) value
    from unnest(coalesce(p_interests, '{}'::text[])) item
    where btrim(item) <> ''
  ) normalized;
  if cardinality(clean_interests) > 8 or not clean_interests <@ array[
    'opening','reservations','events','dining','cocktails','private_events',
    'catering','online_ordering'
  ]::text[] then
    raise exception 'Invalid guest interests' using errcode = '22023';
  end if;
  if (birthday_month_day is not null or p_age_21_plus is not null
    or cardinality(clean_interests) > 0) and not p_profile_consent then
    raise exception 'Personalization consent is required' using errcode = '22023';
  end if;

  payload := jsonb_build_object(
    'firstName', clean_first_name,
    'lastName', clean_last_name,
    'email', clean_email,
    'phone', clean_phone,
    'normalizedPhone', normalized_phone,
    'birthdayMonthDay', birthday_month_day,
    'age21Plus', p_age_21_plus,
    'interests', to_jsonb(clean_interests),
    'emailConsent', true,
    'smsConsent', false,
    'profileConsent', p_profile_consent,
    'source', p_source,
    'disclosureVersion', 'guest-interest-v2'
  );
  payload_hash := encode(extensions.digest(payload::text, 'sha256'), 'hex');
  destination_hash := encode(extensions.digest(
    ('guest-interest-email:v2:' || p_organization_id::text || ':' || clean_email)::text,
    'sha256'
  ), 'hex');

  select * into existing from private.public_guest_interest_requests request
  where request.request_id = p_request_id;
  if found then
    if existing.payload_hash <> payload_hash then
      raise exception 'Idempotency key was reused' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'requestId', existing.request_id,
      'status', existing.status,
      'verificationPending', existing.status = 'pending',
      'replayed', true
    );
  end if;

  insert into private.public_guest_interest_requests (
    request_id, organization_id, location_id, guest_id, payload_hash, status,
    payload, normalized_email, normalized_phone, destination_hash,
    verification_token_hash, expires_at
  ) values (
    p_request_id, p_organization_id, p_location_id, null, payload_hash, 'pending',
    payload, clean_email, normalized_phone, destination_hash,
    p_verification_token_hash, p_expires_at
  );

  insert into private.identity_delivery_jobs (
    organization_id, location_id, workflow, correlation_id, channel,
    destination, destination_hash, template_data, dedupe_key
  ) values (
    p_organization_id, p_location_id, 'guest_interest_verification', p_request_id,
    'email', clean_email, destination_hash,
    jsonb_build_object('expiresAt', p_expires_at, 'firstName', clean_first_name),
    'guest-interest:' || p_request_id::text || ':email'
  );

  return jsonb_build_object(
    'requestId', p_request_id,
    'status', 'pending',
    'verificationPending', true,
    'replayed', false
  );
end
$$;

create function public.service_finalize_guest_interest(
  p_request_id uuid,
  p_verification_token_hash text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  request private.public_guest_interest_requests%rowtype;
  guest public.guests%rowtype;
  payload jsonb;
  interests text[];
  captured_at timestamptz := clock_timestamp();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_request_id is null or p_verification_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid guest-interest verification' using errcode = '22023';
  end if;
  select * into request from private.public_guest_interest_requests pending
  where pending.request_id = p_request_id for update;
  if not found then
    raise exception 'Guest-interest request was not found' using errcode = 'P0002';
  end if;
  if request.status = 'verified' then
    return jsonb_build_object('status', 'verified', 'replayed', true);
  end if;
  if request.status <> 'pending' or request.expires_at <= captured_at then
    if request.status = 'pending' then
      update private.public_guest_interest_requests set status = 'expired'
      where request_id = request.request_id;
    end if;
    raise exception 'Guest-interest verification expired' using errcode = '22023';
  end if;
  if request.verification_token_hash <> p_verification_token_hash then
    raise exception 'Guest-interest verification did not match' using errcode = '42501';
  end if;
  payload := request.payload;
  select coalesce(array_agg(value order by value), '{}'::text[])
  into interests from jsonb_array_elements_text(payload -> 'interests') value;

  perform pg_advisory_xact_lock(hashtextextended(
    'guest-email:' || request.organization_id::text || ':' || request.normalized_email,
    0
  ));
  select * into guest from public.guests candidate
  where candidate.organization_id = request.organization_id
    and candidate.merged_into_id is null
    and lower(candidate.email) = request.normalized_email
  limit 1 for update;

  if not found then
    insert into public.guests (
      organization_id, first_name, last_name, display_name, email, phone,
      birthday_month_day, age_21_plus, marketing_interests, source,
      external_references
    ) values (
      request.organization_id,
      payload ->> 'firstName', nullif(payload ->> 'lastName', ''),
      concat_ws(' ', payload ->> 'firstName', nullif(payload ->> 'lastName', '')),
      request.normalized_email, null,
      nullif(payload ->> 'birthdayMonthDay', ''),
      nullif(payload ->> 'age21Plus', '')::boolean,
      interests, 'other',
      jsonb_build_object('le_yard_web', true, 'guest_interest_source', payload ->> 'source')
    ) returning * into guest;
  else
    update public.guests candidate
    set first_name = coalesce(candidate.first_name, payload ->> 'firstName'),
        last_name = coalesce(candidate.last_name, nullif(payload ->> 'lastName', '')),
        birthday_month_day = coalesce(nullif(payload ->> 'birthdayMonthDay', ''), candidate.birthday_month_day),
        age_21_plus = coalesce(nullif(payload ->> 'age21Plus', '')::boolean, candidate.age_21_plus),
        marketing_interests = array(
          select distinct item from unnest(candidate.marketing_interests || interests) item
          order by item
        ),
        updated_at = captured_at
    where candidate.id = guest.id returning * into guest;
  end if;

  insert into public.guest_locations (
    organization_id, guest_id, location_id, is_home_location
  ) values (request.organization_id, guest.id, request.location_id, true)
  on conflict (guest_id, location_id) do nothing;

  insert into public.guest_contacts (
    organization_id, guest_id, contact_type, label, value, normalized_value,
    is_primary, verified_at
  ) values (
    request.organization_id, guest.id, 'email', 'Verified marketing email',
    request.normalized_email, request.normalized_email,
    not exists (
      select 1 from public.guest_contacts contact
      where contact.organization_id = request.organization_id
        and contact.guest_id = guest.id and contact.contact_type = 'email'
        and contact.is_primary
    ), captured_at
  ) on conflict (organization_id, guest_id, contact_type, normalized_value)
    where normalized_value is not null
  do update set value = excluded.value, verified_at = excluded.verified_at,
    updated_at = captured_at;

  insert into public.guest_consents (
    organization_id, guest_id, channel, status, captured_at, revoked_at,
    source, evidence, recorded_by, created_at
  ) values (
    request.organization_id, guest.id, 'email', 'granted', captured_at, null,
    'public_web_signup',
    jsonb_build_object('request_id', request.request_id,
      'disclosure_version', payload ->> 'disclosureVersion',
      'destination_verified', true),
    null, captured_at
  );
  if coalesce((payload ->> 'profileConsent')::boolean, false) then
    insert into public.guest_consents (
      organization_id, guest_id, channel, status, captured_at, revoked_at,
      source, evidence, recorded_by, created_at
    ) values (
      request.organization_id, guest.id, 'profiling', 'granted', captured_at, null,
      'public_web_signup',
      jsonb_build_object('request_id', request.request_id,
        'disclosure_version', payload ->> 'disclosureVersion',
        'email_destination_verified', true),
      null, captured_at
    );
  end if;

  update private.public_guest_interest_requests pending
  set status = 'verified', guest_id = guest.id, verified_at = captured_at
  where pending.request_id = request.request_id;
  return jsonb_build_object('status', 'verified', 'replayed', false);
end
$$;

revoke all on function public.service_capture_guest_interest(
  uuid, uuid, uuid, text, text, text, text, smallint, smallint, boolean,
  text[], boolean, boolean, boolean, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.service_finalize_guest_interest(uuid, text)
from public, anon, authenticated;
grant execute on function public.service_capture_guest_interest(
  uuid, uuid, uuid, text, text, text, text, smallint, smallint, boolean,
  text[], boolean, boolean, boolean, text, text, timestamptz
) to service_role;
grant execute on function public.service_finalize_guest_interest(uuid, text)
to service_role;
