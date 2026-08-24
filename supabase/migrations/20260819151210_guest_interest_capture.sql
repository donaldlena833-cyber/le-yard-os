-- Consent-first public guest-interest capture for the Le Yard marketing site.
-- Transactional reservation contact remains separate from marketing consent.

alter table public.guests
  add column if not exists birthday_month_day text,
  add column if not exists age_21_plus boolean,
  add column if not exists marketing_interests text[] not null default '{}'::text[];

alter table public.guests
  add constraint guests_birthday_month_day_check
  check (
    birthday_month_day is null
    or birthday_month_day ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
  ),
  add constraint guests_marketing_interests_check
  check (
    marketing_interests <@ array[
      'opening',
      'reservations',
      'events',
      'dining',
      'cocktails',
      'private_events',
      'catering',
      'online_ordering'
    ]::text[]
    and cardinality(marketing_interests) <= 8
  );

create table private.public_guest_interest_requests (
  request_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  guest_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, guest_id)
    references public.guests(organization_id, id) on delete cascade
);

create or replace function public.service_capture_guest_interest(
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
  p_source text default 'coming_soon'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  clean_first_name text := nullif(btrim(p_first_name), '');
  clean_last_name text := nullif(btrim(p_last_name), '');
  clean_email text := lower(nullif(btrim(p_email), ''));
  clean_phone text := nullif(btrim(p_phone), '');
  clean_source text := nullif(btrim(p_source), '');
  clean_interests text[];
  clean_birthday_month_day text;
  normalized_phone text;
  payload_hash text;
  existing_request private.public_guest_interest_requests%rowtype;
  guest_row public.guests%rowtype;
  captured_at timestamptz := clock_timestamp();
begin
  if p_request_id is null
    or p_organization_id is null
    or p_location_id is null
    or clean_first_name is null
    or clean_email is null
    or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or length(clean_first_name) > 120
    or length(coalesce(clean_last_name, '')) > 120
    or length(clean_email) > 320
    or length(coalesce(clean_phone, '')) > 80
    or clean_source not in ('coming_soon', 'website', 'reservation_follow_up', 'order_follow_up')
    or not p_email_consent then
    raise exception 'Invalid guest interest payload' using errcode = '22023';
  end if;

  if clean_phone is not null then
    normalized_phone := regexp_replace(clean_phone, '[^0-9]', '', 'g');
    if length(normalized_phone) < 7 or length(normalized_phone) > 20 then
      raise exception 'Invalid guest interest phone' using errcode = '22023';
    end if;
  end if;
  if p_sms_consent and clean_phone is null then
    raise exception 'SMS consent requires a phone number' using errcode = '22023';
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
    clean_birthday_month_day :=
      lpad(p_birthday_month::text, 2, '0') || '-' ||
      lpad(p_birthday_day::text, 2, '0');
  end if;

  select coalesce(array_agg(value order by value), '{}'::text[])
  into clean_interests
  from (
    select distinct btrim(value) as value
    from unnest(coalesce(p_interests, '{}'::text[])) value
    where btrim(value) <> ''
  ) normalized;
  if cardinality(clean_interests) > 8
    or not clean_interests <@ array[
      'opening',
      'reservations',
      'events',
      'dining',
      'cocktails',
      'private_events',
      'catering',
      'online_ordering'
    ]::text[] then
    raise exception 'Invalid guest interests' using errcode = '22023';
  end if;
  if (
    clean_birthday_month_day is not null
    or p_age_21_plus is not null
    or cardinality(clean_interests) > 0
  ) and not p_profile_consent then
    raise exception 'Personalization consent is required' using errcode = '22023';
  end if;

  payload_hash := encode(extensions.digest(
    concat_ws(chr(31),
      'public-guest-interest:v1',
      p_organization_id::text,
      p_location_id::text,
      clean_first_name,
      coalesce(clean_last_name, ''),
      clean_email,
      coalesce(clean_phone, ''),
      coalesce(clean_birthday_month_day, ''),
      coalesce(p_age_21_plus::text, ''),
      array_to_string(clean_interests, ','),
      p_email_consent::text,
      p_sms_consent::text,
      p_profile_consent::text,
      clean_source
    ),
    'sha256'
  ), 'hex');

  select * into existing_request
  from private.public_guest_interest_requests request
  where request.request_id = p_request_id;
  if existing_request.request_id is not null then
    if existing_request.payload_hash <> payload_hash then
      raise exception 'Idempotency key was reused' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'guestId', existing_request.guest_id,
      'emailConsent', true,
      'smsConsent', p_sms_consent,
      'replayed', true
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'guest-email:' || p_organization_id::text || ':' || clean_email,
    0
  ));

  select * into guest_row
  from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.merged_into_id is null
    and lower(guest.email) = clean_email
  limit 1;

  if guest_row.id is null then
    insert into public.guests (
      organization_id,
      first_name,
      last_name,
      display_name,
      email,
      phone,
      birthday_month_day,
      age_21_plus,
      marketing_interests,
      source,
      external_references
    ) values (
      p_organization_id,
      clean_first_name,
      clean_last_name,
      concat_ws(' ', clean_first_name, clean_last_name),
      clean_email,
      clean_phone,
      clean_birthday_month_day,
      p_age_21_plus,
      clean_interests,
      'other',
      jsonb_build_object('le_yard_web', true, 'guest_interest_source', clean_source)
    ) returning * into guest_row;
  else
    update public.guests guest
    set first_name = coalesce(guest.first_name, clean_first_name),
        last_name = coalesce(guest.last_name, clean_last_name),
        phone = coalesce(guest.phone, clean_phone),
        birthday_month_day = coalesce(clean_birthday_month_day, guest.birthday_month_day),
        age_21_plus = coalesce(p_age_21_plus, guest.age_21_plus),
        marketing_interests = (
          select coalesce(array_agg(value order by value), '{}'::text[])
          from (
            select distinct unnest(
              coalesce(guest.marketing_interests, '{}'::text[]) || clean_interests
            ) as value
          ) combined
        ),
        external_references = coalesce(guest.external_references, '{}'::jsonb)
          || jsonb_build_object('le_yard_web', true, 'guest_interest_source', clean_source),
        updated_at = captured_at
    where guest.id = guest_row.id
    returning * into guest_row;
  end if;

  insert into public.guest_locations (
    organization_id,
    guest_id,
    location_id,
    is_home_location
  ) values (
    p_organization_id,
    guest_row.id,
    p_location_id,
    true
  ) on conflict (guest_id, location_id) do nothing;

  insert into public.guest_contacts (
    organization_id,
    guest_id,
    contact_type,
    label,
    value,
    normalized_value,
    is_primary,
    verified_at
  ) values (
    p_organization_id,
    guest_row.id,
    'email',
    'Marketing email',
    clean_email,
    clean_email,
    not exists (
      select 1
      from public.guest_contacts contact
      where contact.organization_id = p_organization_id
        and contact.guest_id = guest_row.id
        and contact.contact_type = 'email'
        and contact.is_primary
    ),
    null
  ) on conflict (
    organization_id,
    guest_id,
    contact_type,
    normalized_value
  ) where normalized_value is not null do update
  set value = excluded.value,
      updated_at = captured_at;

  if clean_phone is not null then
    insert into public.guest_contacts (
      organization_id,
      guest_id,
      contact_type,
      label,
      value,
      normalized_value,
      is_primary,
      verified_at
    ) values (
      p_organization_id,
      guest_row.id,
      'phone',
      'Marketing mobile',
      clean_phone,
      normalized_phone,
      not exists (
        select 1
        from public.guest_contacts contact
        where contact.organization_id = p_organization_id
          and contact.guest_id = guest_row.id
          and contact.contact_type = 'phone'
          and contact.is_primary
      ),
      null
    ) on conflict (
      organization_id,
      guest_id,
      contact_type,
      normalized_value
    ) where normalized_value is not null do update
    set value = excluded.value,
        updated_at = captured_at;
  end if;

  insert into public.guest_consents (
    organization_id,
    guest_id,
    channel,
    status,
    captured_at,
    revoked_at,
    source,
    evidence,
    recorded_by,
    created_at
  ) values (
    p_organization_id,
    guest_row.id,
    'email',
    'granted',
    captured_at,
    null,
    'public_web_signup',
    jsonb_build_object(
      'request_id', p_request_id,
      'source', clean_source,
      'disclosure_version', 'guest-interest-v1'
    ),
    null,
    captured_at
  );

  if p_sms_consent then
    insert into public.guest_consents (
      organization_id,
      guest_id,
      channel,
      status,
      captured_at,
      revoked_at,
      source,
      evidence,
      recorded_by,
      created_at
    ) values (
      p_organization_id,
      guest_row.id,
      'sms',
      'granted',
      captured_at,
      null,
      'public_web_signup',
      jsonb_build_object(
        'request_id', p_request_id,
        'source', clean_source,
        'disclosure_version', 'guest-interest-v1'
      ),
      null,
      captured_at
    );
  end if;

  if p_profile_consent then
    insert into public.guest_consents (
      organization_id,
      guest_id,
      channel,
      status,
      captured_at,
      revoked_at,
      source,
      evidence,
      recorded_by,
      created_at
    ) values (
      p_organization_id,
      guest_row.id,
      'profiling',
      'granted',
      captured_at,
      null,
      'public_web_signup',
      jsonb_build_object(
        'request_id', p_request_id,
        'source', clean_source,
        'disclosure_version', 'guest-interest-v1',
        'birthday_month_day', clean_birthday_month_day is not null,
        'age_21_plus', p_age_21_plus is not null,
        'interests', clean_interests
      ),
      null,
      captured_at
    );
  end if;

  insert into private.public_guest_interest_requests (
    request_id,
    organization_id,
    location_id,
    guest_id,
    payload_hash,
    created_at
  ) values (
    p_request_id,
    p_organization_id,
    p_location_id,
    guest_row.id,
    payload_hash,
    captured_at
  );

  return jsonb_build_object(
    'guestId', guest_row.id,
    'emailConsent', true,
    'smsConsent', p_sms_consent,
    'replayed', false
  );
end
$$;

revoke all on function public.service_capture_guest_interest(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  smallint,
  smallint,
  boolean,
  text[],
  boolean,
  boolean,
  boolean,
  text
) from public, anon, authenticated;

grant execute on function public.service_capture_guest_interest(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  smallint,
  smallint,
  boolean,
  text[],
  boolean,
  boolean,
  boolean,
  text
) to service_role;

comment on function public.service_capture_guest_interest(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  smallint,
  smallint,
  boolean,
  text[],
  boolean,
  boolean,
  boolean,
  text
) is
  'Captures an idempotent, consented public guest-interest profile. Callable only by the service role behind the authenticated Le Yard BFF.';
