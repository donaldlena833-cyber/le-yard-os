create table private.church_square_stock_push_devices (
  endpoint_hash text primary key check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  organization_id uuid not null,
  location_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  version_id uuid not null default gen_random_uuid(),
  encrypted_subscription bytea,
  registered_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  foreign key (organization_id,location_id) references public.locations(organization_id,id) on delete cascade,
  check ((encrypted_subscription is null) = (revoked_at is not null)),
  check (encrypted_subscription is null or (
    octet_length(encrypted_subscription) between 30 and 8192 and substring(encrypted_subscription from 1 for 1) = '\x01'::bytea
  ))
);

create index church_square_stock_push_active_devices
  on private.church_square_stock_push_devices(organization_id,location_id,user_id) where revoked_at is null;

create table private.church_square_stock_push_outbox (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references private.church_square_count_items(id) on delete cascade,
  episode_id uuid not null,
  endpoint_hash text not null references private.church_square_stock_push_devices(endpoint_hash) on delete cascade,
  device_version uuid not null,
  enqueued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null check (expires_at >= enqueued_at),
  status text not null default 'pending' check (status in ('pending','dispatching','sent','gone','failed','uncertain','skipped')),
  worker_id uuid,
  claim_token uuid,
  claimed_at timestamptz,
  completed_at timestamptz,
  unique (item_id,episode_id,endpoint_hash),
  check (status <> 'dispatching' or (worker_id is not null and claim_token is not null and claimed_at is not null)),
  check ((status in ('pending','dispatching')) = (completed_at is null))
);

create index church_square_stock_push_pending
  on private.church_square_stock_push_outbox(enqueued_at,id) where status = 'pending';
create index church_square_stock_push_expiring
  on private.church_square_stock_push_outbox(expires_at,id) where status = 'pending';
create index church_square_stock_push_claimed
  on private.church_square_stock_push_outbox(claimed_at,id) where status = 'dispatching';
create index church_square_stock_push_terminal
  on private.church_square_stock_push_outbox(enqueued_at,id)
  where status in ('sent','gone','failed','uncertain','skipped');

alter table private.church_square_stock_push_devices enable row level security;
alter table private.church_square_stock_push_devices force row level security;
alter table private.church_square_stock_push_outbox enable row level security;
alter table private.church_square_stock_push_outbox force row level security;
revoke all on private.church_square_stock_push_devices,private.church_square_stock_push_outbox
  from public,anon,authenticated,service_role;

create function public.get_church_square_stock_push_device(p_location_id uuid,p_endpoint_hash text)
returns boolean language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
begin
  if not private.can_record_church_square_count(actor,organization,p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;
  if p_endpoint_hash is null or p_endpoint_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid device reference is required' using errcode = '22023';
  end if;
  return exists (
    select 1 from private.church_square_stock_push_devices device
    where device.endpoint_hash = p_endpoint_hash and device.user_id = actor
      and device.organization_id = organization and device.location_id = p_location_id and device.revoked_at is null
  );
end
$$;

create function public.save_church_square_stock_push_device(
  p_location_id uuid,p_endpoint_hash text,p_encrypted_subscription bytea
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  prior private.church_square_stock_push_devices%rowtype;
begin
  if not private.can_record_church_square_count(actor,organization,p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;
  if p_endpoint_hash is null or p_endpoint_hash !~ '^[0-9a-f]{64}$' or p_encrypted_subscription is null
    or octet_length(p_encrypted_subscription) not between 30 and 8192
    or substring(p_encrypted_subscription from 1 for 1) <> '\x01'::bytea then
    raise exception 'A valid encrypted push device is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('church-square-stock-push-owner:' || p_location_id::text || ':' || actor::text,0));
  perform pg_advisory_xact_lock(hashtextextended('church-square-stock-push-device:' || p_endpoint_hash,0));
  select * into prior from private.church_square_stock_push_devices device
  where device.endpoint_hash = p_endpoint_hash for update;
  if private.church_square_count_organization(p_location_id) is distinct from organization
    or not private.can_record_church_square_count(actor,organization,p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;
  if prior.revoked_at is null and prior.endpoint_hash is not null then
    if (prior.user_id,prior.organization_id,prior.location_id) is distinct from (actor,organization,p_location_id) then
      raise exception 'The device could not be enrolled. Refresh the browser subscription and try again.' using errcode = 'PT409';
    end if;
    if prior.encrypted_subscription = p_encrypted_subscription then return true; end if;
  elsif (select count(*) from private.church_square_stock_push_devices device
    where device.organization_id = organization and device.location_id = p_location_id
      and device.user_id = actor and device.revoked_at is null) >= 8 then
    raise exception 'The Church Street device limit has been reached' using errcode = 'PT409';
  end if;

  insert into private.church_square_stock_push_devices as device (
    endpoint_hash,organization_id,location_id,user_id,encrypted_subscription
  ) values (p_endpoint_hash,organization,p_location_id,actor,p_encrypted_subscription)
  on conflict (endpoint_hash) do update set organization_id = excluded.organization_id,location_id = excluded.location_id,
    user_id = excluded.user_id,encrypted_subscription = excluded.encrypted_subscription,version_id = excluded.version_id,
    registered_at = excluded.registered_at,revoked_at = null;
  return true;
end
$$;

create function public.remove_church_square_stock_push_device(p_location_id uuid,p_endpoint_hash text)
returns boolean language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
begin
  if not private.can_record_church_square_count(actor,organization,p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;
  if p_endpoint_hash is null or p_endpoint_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid device reference is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('church-square-stock-push-device:' || p_endpoint_hash,0));
  if private.church_square_count_organization(p_location_id) is distinct from organization
    or not private.can_record_church_square_count(actor,organization,p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;
  update private.church_square_stock_push_devices device set revoked_at = clock_timestamp(),encrypted_subscription = null
  where device.endpoint_hash = p_endpoint_hash and device.user_id = actor and device.organization_id = organization
    and device.location_id = p_location_id and device.revoked_at is null;
  return true;
end
$$;

create function private.queue_church_square_stock_push()
returns trigger language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  queued_at timestamptz := clock_timestamp();
begin
  if new.episode_id is null or new.calculated_at <= queued_at - interval '12 minutes' then return null; end if;
  if tg_op = 'UPDATE' and old.episode_id is not distinct from new.episode_id then return null; end if;
  insert into private.church_square_stock_push_outbox(item_id,episode_id,endpoint_hash,device_version,enqueued_at,expires_at)
  select item.id,new.episode_id,device.endpoint_hash,device.version_id,queued_at,least(queued_at,new.calculated_at) + interval '12 minutes'
  from private.church_square_count_items item
  join private.church_square_stock_push_devices device on (device.organization_id,device.location_id) = (item.organization_id,item.location_id)
  where item.id = new.item_id and item.is_enabled and device.revoked_at is null
    and device.registered_at <= least(queued_at,new.calculated_at)
    and item.organization_id = private.church_square_count_organization(item.location_id)
    and private.can_record_church_square_count(device.user_id,device.organization_id,device.location_id)
  on conflict (item_id,episode_id,endpoint_hash) do nothing;
  return null;
end
$$;

create trigger queue_church_square_stock_push
  after insert or update on private.church_square_stock_state
  for each row execute function private.queue_church_square_stock_push();

create function public.service_claim_church_square_stock_push(p_worker_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  attempt_at timestamptz := clock_timestamp();
  delivery private.church_square_stock_push_outbox%rowtype;
  encrypted bytea;
begin
  if p_worker_id is null then
    raise exception 'A push worker identifier is required' using errcode = '22023';
  end if;

  with expired as (
    select queued.id from private.church_square_stock_push_outbox queued
    where queued.status = 'pending' and queued.expires_at <= attempt_at
    order by queued.expires_at,queued.id limit 30 for update skip locked
  ), abandoned as (
    select queued.id from private.church_square_stock_push_outbox queued
    where queued.status = 'dispatching' and queued.claimed_at <= attempt_at - interval '60 seconds'
    order by queued.claimed_at,queued.id limit 30 for update skip locked
  ), stale as (
    select queued.id from private.church_square_stock_push_outbox queued
    where queued.status in ('sent','gone','failed','uncertain','skipped') and queued.enqueued_at < attempt_at - interval '30 days'
    order by queued.enqueued_at,queued.id limit 30 for update skip locked
  ), purged as (
    delete from private.church_square_stock_push_outbox queued using stale where queued.id = stale.id
  )
  update private.church_square_stock_push_outbox queued set
    status = case when queued.status = 'dispatching' then 'uncertain' else 'skipped' end,
    completed_at = attempt_at
  where queued.id in (select id from expired union all select id from abandoned);

  -- Skip ineligible rows while polling. Old work ages out rather than blocking another device.
  select queued.* into delivery from private.church_square_stock_push_outbox queued
  join private.church_square_stock_push_devices device on device.endpoint_hash = queued.endpoint_hash
    and device.version_id = queued.device_version and device.revoked_at is null
  join private.church_square_count_items item on item.id = queued.item_id and item.is_enabled
    and (item.organization_id,item.location_id) = (device.organization_id,device.location_id)
  join private.church_square_stock_state stock on stock.item_id = item.id and stock.episode_id = queued.episode_id
  where queued.status = 'pending' and queued.expires_at > attempt_at
    and item.organization_id = private.church_square_count_organization(item.location_id)
    and private.can_record_church_square_count(device.user_id,device.organization_id,device.location_id)
    and not exists (select 1 from private.church_square_stock_acknowledgments ack
      where ack.item_id = queued.item_id and ack.episode_id = queued.episode_id)
  order by queued.enqueued_at,queued.id limit 1 for update of queued skip locked;
  if not found then return null; end if;

  -- Stock projection and acknowledgment use this lock. A competing update can be handled on the next poll.
  if not pg_try_advisory_xact_lock(hashtextextended('church-square-stock:' || delivery.item_id::text,0)) then return null; end if;
  select device.encrypted_subscription into encrypted
  from private.church_square_stock_push_devices device
  join private.church_square_count_items item on item.id = delivery.item_id and item.is_enabled
    and (item.organization_id,item.location_id) = (device.organization_id,device.location_id)
  join private.church_square_stock_state stock on stock.item_id = item.id and stock.episode_id = delivery.episode_id
  where device.endpoint_hash = delivery.endpoint_hash and device.version_id = delivery.device_version and device.revoked_at is null
    and item.organization_id = private.church_square_count_organization(item.location_id)
    and private.can_record_church_square_count(device.user_id,device.organization_id,device.location_id)
    and not exists (select 1 from private.church_square_stock_acknowledgments ack
      where ack.item_id = delivery.item_id and ack.episode_id = delivery.episode_id)
  for share of item,device;
  attempt_at := clock_timestamp();
  if encrypted is null or delivery.expires_at <= attempt_at then return null; end if;

  update private.church_square_stock_push_outbox queued set status = 'dispatching',worker_id = p_worker_id,
    claim_token = gen_random_uuid(),claimed_at = attempt_at
  where queued.id = delivery.id returning * into delivery;
  return jsonb_build_object('id',delivery.id,'claimToken',delivery.claim_token,'episodeId',delivery.episode_id,
    'encryptedSubscription',encrypted);
end
$$;

create function public.service_complete_church_square_stock_push(p_id uuid,p_claim_token uuid,p_status text)
returns boolean language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  delivery private.church_square_stock_push_outbox%rowtype;
begin
  if p_id is null or p_claim_token is null or p_status is null or p_status not in ('sent','gone','failed','uncertain') then
    raise exception 'A valid push delivery result is required' using errcode = '22023';
  end if;
  select * into delivery from private.church_square_stock_push_outbox queued
  where queued.id = p_id and queued.claim_token = p_claim_token for update;
  if not found then return false; end if;
  if delivery.status = p_status then return true; end if;
  if delivery.status <> 'dispatching' then return false; end if;

  update private.church_square_stock_push_outbox queued
  set status = p_status,completed_at = clock_timestamp() where queued.id = delivery.id;
  if p_status = 'gone' then
    update private.church_square_stock_push_devices device set revoked_at = clock_timestamp(),encrypted_subscription = null
    where device.endpoint_hash = delivery.endpoint_hash and device.version_id = delivery.device_version and device.revoked_at is null;
  end if;
  return true;
end
$$;

revoke all on function private.queue_church_square_stock_push(),
  public.get_church_square_stock_push_device(uuid,text),public.save_church_square_stock_push_device(uuid,text,bytea),
  public.remove_church_square_stock_push_device(uuid,text),public.service_claim_church_square_stock_push(uuid),
  public.service_complete_church_square_stock_push(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_church_square_stock_push_device(uuid,text),
  public.save_church_square_stock_push_device(uuid,text,bytea),public.remove_church_square_stock_push_device(uuid,text) to authenticated;
grant execute on function public.service_claim_church_square_stock_push(uuid),
  public.service_complete_church_square_stock_push(uuid,uuid,text) to service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114190200', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
