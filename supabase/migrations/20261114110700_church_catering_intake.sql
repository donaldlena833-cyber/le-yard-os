-- Website requests enter the Church Street management queue before any job exists.
create schema catering_private;
revoke all on schema catering_private from public, anon, authenticated, service_role;
create table catering_private.catering_api_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  is_active boolean not null default false,
  expires_at timestamptz,
  hourly_limit integer not null default 60 check (hourly_limit between 1 and 1000),
  contact_hourly_limit integer not null default 4 check (contact_hourly_limit between 1 and 20),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, organization_id, location_id),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade
);
create table catering_private.catering_rate_buckets (
  client_id uuid not null references catering_private.catering_api_clients(id) on delete cascade,
  window_start timestamptz not null,
  bucket_hash text not null,
  attempts integer not null check (attempts > 0),
  primary key (client_id, window_start, bucket_hash)
);
create table catering_private.catering_inquiries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  client_id uuid not null,
  request_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  job_id uuid,
  conversion_request_id uuid,
  conversion_actor_id uuid,
  conversion_title text,
  conversion_service_date date,
  created_at timestamptz not null default clock_timestamp(),
  unique (client_id, request_id),
  unique (location_id, job_id),
  unique (location_id, conversion_request_id),
  foreign key (location_id, job_id) references private.church_catering_jobs(location_id, id) on delete restrict,
  check (
    (job_id is null and conversion_request_id is null and conversion_actor_id is null
      and conversion_title is null and conversion_service_date is null)
    or (job_id is not null and conversion_request_id is not null and conversion_actor_id is not null
      and conversion_title is not null and conversion_service_date is not null)
  ),
  foreign key (client_id, organization_id, location_id) references catering_private.catering_api_clients(id, organization_id, location_id) on delete restrict,
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete restrict
);
create index catering_inquiries_location_created_idx on catering_private.catering_inquiries
  (location_id, (job_id is not null), created_at desc, id);
-- Dedicated credentials have no reservation, guest-profile or marketing privileges.
revoke all on catering_private.catering_api_clients, catering_private.catering_rate_buckets, catering_private.catering_inquiries from public, anon, authenticated, service_role;
alter table catering_private.catering_api_clients enable row level security;
alter table catering_private.catering_api_clients force row level security;
alter table catering_private.catering_rate_buckets enable row level security;
alter table catering_private.catering_rate_buckets force row level security;
alter table catering_private.catering_inquiries enable row level security;
alter table catering_private.catering_inquiries force row level security;
create function public.service_authenticate_catering_client(p_key_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object('id', client.id)
    from catering_private.catering_api_clients client
    where client.key_hash = p_key_hash and client.is_active
      and (client.expires_at is null or client.expires_at > statement_timestamp())
      and client.organization_id = private.church_square_count_organization(client.location_id)
  );
end
$$;

create function public.service_capture_catering_inquiry(p_client_id uuid, p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  client catering_private.catering_api_clients%rowtype;
  previous catering_private.catering_inquiries%rowtype;
  inquiry_id uuid;
  fingerprint text;
  contact_bucket text;
  bucket_window timestamptz := date_trunc('hour', clock_timestamp() at time zone 'UTC') at time zone 'UTC';
  today date := (clock_timestamp() at time zone 'America/New_York')::date;
  fields text[] := array['audience','contactName','email','phone','company','occasion','eventDate','eventTime','location','dietaryNeeds','format','budget','notes','source','channel','purpose','noticeVersion'];
  caps integer[] := array[20,120,254,40,160,180,10,80,300,500,600,120,1200,40,20,40,40];
  i integer;
  target_date date;
  global_attempts integer;
  contact_attempts integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  select * into client from catering_private.catering_api_clients candidate
  where candidate.id = p_client_id and candidate.is_active
    and (candidate.expires_at is null or candidate.expires_at > clock_timestamp())
    and candidate.organization_id = private.church_square_count_organization(candidate.location_id)
  for share;
  if not found then raise exception 'catering_client_unavailable' using errcode = '28000'; end if;
  if p_request_id is null or p_request_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 16384
    or (select count(*) from jsonb_object_keys(p_payload)) <> 21
    or not p_payload ?& (fields || array['guestCount','emailMarketingConsent','smsMarketingConsent','profileConsent']) then
    raise exception 'invalid_catering_payload' using errcode = '22023';
  end if;
  for i in 1..array_length(fields, 1) loop
    if jsonb_typeof(p_payload -> fields[i]) <> 'string' or length(p_payload ->> fields[i]) > caps[i]
      or (p_payload ->> fields[i]) ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]' then
      raise exception 'invalid_catering_payload' using errcode = '22023';
    end if;
  end loop;
  if p_payload ->> 'audience' not in ('corporate', 'private_party')
    or length(btrim(p_payload ->> 'contactName')) = 0 or length(btrim(p_payload ->> 'occasion')) = 0
    or p_payload ->> 'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_payload ->> 'email' <> lower(btrim(p_payload ->> 'email'))
    or (p_payload ->> 'audience' = 'private_party' and p_payload ->> 'company' <> '')
    or p_payload ->> 'source' not in ('direct','google_business_profile','tripadvisor','apple_maps','bing_places','instagram','facebook','nextdoor','website')
    or p_payload ->> 'channel' <> 'website' or p_payload ->> 'purpose' <> 'catering_service_inquiry'
    or p_payload ->> 'noticeVersion' <> 'catering-2026-10-21'
    or p_payload -> 'emailMarketingConsent' <> 'false'::jsonb
    or p_payload -> 'smsMarketingConsent' <> 'false'::jsonb or p_payload -> 'profileConsent' <> 'false'::jsonb
    or (p_payload -> 'guestCount' <> 'null'::jsonb and (jsonb_typeof(p_payload -> 'guestCount') <> 'number' or p_payload ->> 'guestCount' !~ '^[1-9][0-9]{0,4}$'))
    or (p_payload ->> 'phone' <> '' and (p_payload ->> 'phone' !~ '^[+()0-9 .-]+$' or length(regexp_replace(p_payload ->> 'phone','[^0-9]','','g')) < 7)) then
    raise exception 'invalid_catering_payload' using errcode = '22023';
  end if;
  fingerprint := encode(extensions.digest(p_payload::text, 'sha256'), 'hex');
  -- Serialize this bounded client stream across instances. Replay lookup and both
  -- abuse counters share the insertion transaction; failures roll everything back.
  perform pg_advisory_xact_lock(hashtextextended('catering-client:' || p_client_id::text, 0));
  select * into previous from catering_private.catering_inquiries where client_id = p_client_id and request_id = p_request_id;
  if found then
    if previous.payload_hash <> fingerprint then raise exception 'catering_idempotency_conflict' using errcode = '23505'; end if;
    return jsonb_build_object('status','accepted','stored',true,'inquiryId',previous.id);
  end if;
  if p_payload ->> 'eventDate' <> '' then
    begin target_date := (p_payload ->> 'eventDate')::date;
    exception when others then raise exception 'invalid_catering_date' using errcode = '22023'; end;
    if to_char(target_date, 'YYYY-MM-DD') <> p_payload ->> 'eventDate' or target_date < today then
      raise exception 'invalid_catering_date' using errcode = '22023';
    end if;
  end if;
  contact_bucket := encode(extensions.digest(
    'church-catering-email:v1:' || p_client_id::text || ':' || (p_payload ->> 'email'), 'sha256'), 'hex');
  select attempts into global_attempts from catering_private.catering_rate_buckets where client_id = p_client_id and window_start = bucket_window and bucket_hash = 'global';
  select attempts into contact_attempts from catering_private.catering_rate_buckets where client_id = p_client_id and window_start = bucket_window and bucket_hash = contact_bucket;
  if coalesce(global_attempts,0) >= client.hourly_limit or coalesce(contact_attempts,0) >= client.contact_hourly_limit then
    raise exception 'catering_rate_limited' using errcode = 'P0001';
  end if;
  insert into catering_private.catering_rate_buckets(client_id,window_start,bucket_hash,attempts)
    values(p_client_id,bucket_window,'global',1),(p_client_id,bucket_window,contact_bucket,1)
    on conflict(client_id,window_start,bucket_hash) do update set attempts = catering_rate_buckets.attempts + 1;
  insert into catering_private.catering_inquiries(organization_id,location_id,client_id,request_id,payload_hash,payload)
    values(client.organization_id,client.location_id,p_client_id,p_request_id,fingerprint,
      p_payload - array['dietaryNeeds','notes','emailMarketingConsent','smsMarketingConsent','profileConsent'])
    returning id into inquiry_id;
  -- Counter hashes are operational abuse metadata, not an inquiry retention rule.
  delete from catering_private.catering_rate_buckets where client_id = p_client_id and window_start < bucket_window - interval '24 hours';
  return jsonb_build_object('status','accepted','stored',true,'inquiryId',inquiry_id);
end;
$$;
comment on table catering_private.catering_inquiries is
  'Church Street service inquiries. Receipt records no booking, quote, notification or marketing subscription.';

create function private.church_catering_inquiry_summary(p_row catering_private.catering_inquiries)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_row.id,
    'audience', p_row.payload->>'audience',
    'eventDate', nullif(p_row.payload->>'eventDate', ''),
    'guestCount', p_row.payload->'guestCount',
    'source', p_row.payload->>'source',
    'receivedAt', p_row.created_at,
    'jobId', p_row.job_id
  )
$$;

create function public.list_church_catering_inquiries(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off as $$
declare
  organization uuid := private.church_catering_authority(auth.uid(),p_location_id);
begin
  return (
    select coalesce(jsonb_agg(private.church_catering_inquiry_summary(inquiry.record)
      order by inquiry.converted,inquiry.created_at desc,inquiry.id), '[]'::jsonb)
    from (
      select candidate as record, candidate.job_id is not null as converted, candidate.created_at, candidate.id
      from catering_private.catering_inquiries candidate
      where candidate.organization_id = organization and candidate.location_id = p_location_id
      order by converted, candidate.created_at desc, candidate.id
      limit 50
    ) inquiry
  );
end
$$;

create function public.get_church_catering_inquiry(p_location_id uuid,p_inquiry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off as $$
declare
  organization uuid := private.church_catering_authority(auth.uid(),p_location_id);
  inquiry catering_private.catering_inquiries%rowtype;
begin
  select * into inquiry from catering_private.catering_inquiries candidate
    where candidate.organization_id = organization and candidate.location_id = p_location_id
      and candidate.id = p_inquiry_id;
  if not found then raise exception 'The catering inquiry is unavailable' using errcode = 'P0002'; end if;
  return private.church_catering_inquiry_summary(inquiry) || jsonb_build_object(
    'contactName', inquiry.payload->>'contactName',
    'email', inquiry.payload->>'email',
    'phone', nullif(inquiry.payload->>'phone', ''),
    'company', nullif(inquiry.payload->>'company', ''),
    'occasion', inquiry.payload->>'occasion',
    'eventTime', nullif(inquiry.payload->>'eventTime', ''),
    'location', nullif(inquiry.payload->>'location', ''),
    'format', nullif(inquiry.payload->>'format', ''),
    'budget', nullif(inquiry.payload->>'budget', '')
  );
end
$$;

create function public.convert_church_catering_inquiry(
  p_request_id uuid,p_location_id uuid,p_inquiry_id uuid,p_title text,p_service_date date
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_catering_authority(actor,p_location_id);
  title text := btrim(p_title);
  inquiry catering_private.catering_inquiries%rowtype;
  job jsonb;
begin
  if p_request_id is null or p_inquiry_id is null or title is null or length(title) not between 1 and 120
    or title ~ '[[:cntrl:]]' or p_service_date is null
    or p_service_date not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'Invalid catering job fields' using errcode = '22023';
  end if;

  -- Coordinate with the existing job receipt lock so a prior general job
  -- save cannot be mistaken for a job created from this intake.
  perform pg_advisory_xact_lock(hashtextextended('church-catering-request:' || p_location_id::text || ':' || p_request_id::text,0));
  select * into inquiry from catering_private.catering_inquiries candidate
    where candidate.organization_id = organization and candidate.location_id = p_location_id
      and candidate.id = p_inquiry_id for update;
  if not found then raise exception 'The catering inquiry is unavailable' using errcode = 'P0002'; end if;

  if inquiry.job_id is not null then
    if (inquiry.conversion_request_id,inquiry.conversion_actor_id,inquiry.conversion_title,inquiry.conversion_service_date)
      is distinct from (p_request_id,actor,title,p_service_date) then
      raise exception 'The catering inquiry already has a job' using errcode = 'PT409';
    end if;
    return public.save_church_catering_job(p_request_id,p_location_id,title,p_service_date,'inquiry');
  end if;
  if exists (
    select 1 from private.church_catering_job_changes receipt
    where receipt.location_id = p_location_id and receipt.request_id = p_request_id
  ) then
    raise exception 'The catering request identity was already used' using errcode = 'PT409';
  end if;

  job := public.save_church_catering_job(p_request_id,p_location_id,title,p_service_date,'inquiry');
  update catering_private.catering_inquiries candidate
  set job_id = (job->>'id')::uuid, conversion_request_id = p_request_id,
    conversion_actor_id = actor, conversion_title = title, conversion_service_date = p_service_date
  where candidate.id = inquiry.id;
  return job;
end
$$;

revoke all on function private.church_catering_inquiry_summary(catering_private.catering_inquiries),
  public.service_authenticate_catering_client(text),public.service_capture_catering_inquiry(uuid,uuid,jsonb),
  public.list_church_catering_inquiries(uuid),public.get_church_catering_inquiry(uuid,uuid),
  public.convert_church_catering_inquiry(uuid,uuid,uuid,text,date)
  from public,anon,authenticated,service_role;
grant execute on function public.service_authenticate_catering_client(text),
  public.service_capture_catering_inquiry(uuid,uuid,jsonb) to service_role;
grant execute on function public.list_church_catering_inquiries(uuid),public.get_church_catering_inquiry(uuid,uuid),
  public.convert_church_catering_inquiry(uuid,uuid,uuid,text,date) to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114110700', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
