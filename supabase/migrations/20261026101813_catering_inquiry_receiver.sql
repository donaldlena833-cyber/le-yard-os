-- Dormant until a dedicated client and receiver feature flag are explicitly enabled.
-- This migration seeds no clients, sends no messages, and changes no booking state.
create table private.catering_api_clients (
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
create table private.catering_rate_buckets (
  client_id uuid not null references private.catering_api_clients(id) on delete cascade,
  window_start timestamptz not null,
  bucket_hash text not null,
  attempts integer not null check (attempts > 0),
  primary key (client_id, window_start, bucket_hash)
);
create table public.catering_inquiries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  client_id uuid not null,
  request_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'received' check (status = 'received'),
  notification_status text not null default 'not_configured' check (notification_status = 'not_configured'),
  created_at timestamptz not null default clock_timestamp(),
  unique (client_id, request_id),
  foreign key (client_id, organization_id, location_id) references private.catering_api_clients(id, organization_id, location_id) on delete restrict,
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete restrict
);
create index catering_inquiries_org_created_idx on public.catering_inquiries(organization_id, created_at desc, id);
create index catering_inquiries_location_idx on public.catering_inquiries(organization_id, location_id);
-- Dedicated credentials have no reservation, guest-profile or marketing privileges.
revoke all on private.catering_api_clients, private.catering_rate_buckets, public.catering_inquiries from public, anon, authenticated, service_role;
grant usage on schema private, extensions to service_role;
grant execute on function extensions.digest(text,text) to service_role;
grant select on private.catering_api_clients to service_role;
grant select, insert, update, delete on private.catering_rate_buckets to service_role;
grant select, insert on public.catering_inquiries to service_role;
grant select on public.catering_inquiries to authenticated;
alter table private.catering_api_clients enable row level security;
alter table private.catering_rate_buckets enable row level security;
alter table public.catering_inquiries enable row level security;
alter table public.catering_inquiries force row level security;
create policy catering_clients_service_read on private.catering_api_clients for select to service_role using (true);
create policy catering_rates_service on private.catering_rate_buckets for all to service_role using (true) with check (true);
create policy catering_inquiries_service_read on public.catering_inquiries for select to service_role using (true);
create policy catering_inquiries_service_insert on public.catering_inquiries for insert to service_role with check (true);
create policy catering_inquiries_owner_read on public.catering_inquiries for select to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.app_role[]));

create function public.service_authenticate_catering_client(p_key_hash text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', c.id)
  from private.catering_api_clients c
  where c.key_hash = p_key_hash and c.is_active
    and (c.expires_at is null or c.expires_at > now())
$$;
revoke execute on function public.service_authenticate_catering_client(text) from public, anon, authenticated;
grant execute on function public.service_authenticate_catering_client(text) to service_role;

create function public.service_capture_catering_inquiry(p_client_id uuid, p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  client private.catering_api_clients%rowtype;
  previous public.catering_inquiries%rowtype;
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
  select * into client from private.catering_api_clients where id = p_client_id and is_active and (expires_at is null or expires_at > clock_timestamp());
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
  select * into previous from public.catering_inquiries where client_id = p_client_id and request_id = p_request_id;
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
  contact_bucket := encode(extensions.digest(p_payload ->> 'email', 'sha256'), 'hex');
  select attempts into global_attempts from private.catering_rate_buckets where client_id = p_client_id and window_start = bucket_window and bucket_hash = 'global';
  select attempts into contact_attempts from private.catering_rate_buckets where client_id = p_client_id and window_start = bucket_window and bucket_hash = contact_bucket;
  if coalesce(global_attempts,0) >= client.hourly_limit or coalesce(contact_attempts,0) >= client.contact_hourly_limit then
    raise exception 'catering_rate_limited' using errcode = 'P0001';
  end if;
  insert into private.catering_rate_buckets(client_id,window_start,bucket_hash,attempts)
    values(p_client_id,bucket_window,'global',1),(p_client_id,bucket_window,contact_bucket,1)
    on conflict(client_id,window_start,bucket_hash) do update set attempts = catering_rate_buckets.attempts + 1;
  insert into public.catering_inquiries(organization_id,location_id,client_id,request_id,payload_hash,payload)
    values(client.organization_id,client.location_id,p_client_id,p_request_id,fingerprint,p_payload) returning id into inquiry_id;
  -- Counter hashes are operational abuse metadata, not an inquiry retention rule.
  delete from private.catering_rate_buckets where client_id = p_client_id and window_start < bucket_window - interval '24 hours';
  return jsonb_build_object('status','accepted','stored',true,'inquiryId',inquiry_id);
end;
$$;
revoke execute on function public.service_capture_catering_inquiry(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.service_capture_catering_inquiry(uuid,uuid,jsonb) to service_role;
comment on table public.catering_inquiries is 'Service requests only; no marketing/profile consent, notification, quote, order or booking is implied. Owner reads are organization-scoped.';

-- Keep the application's fail-closed schema identity aligned with this exact
-- forward migration. App and migration must be released as a coordinated batch.
update private.runtime_schema_contract_expected expected
set migration_head = '20261026101813',
    table_fingerprint = snapshot.value ->> 'tableFingerprint',
    function_fingerprint = snapshot.value ->> 'functionFingerprint',
    access_fingerprint = snapshot.value ->> 'accessFingerprint',
    captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
