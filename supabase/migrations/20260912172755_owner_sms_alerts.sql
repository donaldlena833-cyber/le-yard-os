begin;

-- A durable, bounded outbox. Recipient destinations are resolved by the server
-- from private configuration and are never copied into this table.
create table public.owner_sms_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  source_sid text,
  source_key text not null check (length(source_key) between 1 and 100),
  recipient text not null check (recipient in ('donald', 'maris')),
  part integer not null check (part between 1 and 16),
  body text not null check (length(body) between 1 and 1600),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'accepted', 'delivered', 'failed', 'uncertain')),
  provider_sid text check (provider_sid ~ '^(SM|MM)[0-9a-fA-F]{32}$'),
  provider_status text,
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (organization_id, source_key, recipient, part),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id),
  foreign key (organization_id, source_sid)
    references public.communication_messages(organization_id, sid),
  constraint owner_sms_alerts_source_check check (
    (source_sid is not null and source_key = source_sid)
    or (source_sid is null and source_key ~ '^setup:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
  )
);

create index owner_sms_alerts_queue
  on public.owner_sms_alerts(organization_id, status, created_at, source_key, recipient, part)
  where status in ('queued', 'sending');
create index owner_sms_alerts_provider_sid
  on public.owner_sms_alerts(organization_id, provider_sid)
  where provider_sid is not null;
create trigger owner_sms_alerts_touch_updated_at
  before update on public.owner_sms_alerts
  for each row execute function public.touch_updated_at();

alter table public.owner_sms_alerts enable row level security;
alter table public.owner_sms_alerts force row level security;
revoke all on public.owner_sms_alerts from public, anon, authenticated;
grant select on public.owner_sms_alerts to authenticated;
grant select, insert, update, delete on public.owner_sms_alerts to service_role;
create policy owner_sms_alerts_owner_read on public.owner_sms_alerts
  for select to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]));
create policy owner_sms_alerts_service_write on public.owner_sms_alerts
  for all to service_role using (true) with check (true);

create function public.service_claim_owner_sms_alert(p_organization_id uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  alert public.owner_sms_alerts%rowtype;
  ready_parts integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  -- The row lock makes two workers racing for one part observe a single claim.
  select * into alert from public.owner_sms_alerts
  where organization_id = p_organization_id and id = p_id for update;
  if not found then return jsonb_build_object('status', 'missing'); end if;

  -- A timed-out request may have reached the provider. Preserve it for review;
  -- never turn it back into a sendable job automatically.
  if alert.status = 'sending'
    and coalesce(alert.started_at, alert.created_at) < clock_timestamp() - interval '2 minutes' then
    update public.owner_sms_alerts
    set status = 'uncertain', completed_at = clock_timestamp(),
      error_code = coalesce(error_code, 'worker_interrupted')
    where id = alert.id returning * into alert;
  end if;
  if alert.status <> 'queued' then
    return jsonb_build_object('status', alert.status, 'alert', to_jsonb(alert));
  end if;

  -- Require every earlier part, including missing parts, to be accepted before
  -- sending the next one. Each recipient has an independent ordered sequence.
  select count(*) into ready_parts from public.owner_sms_alerts prior
  where prior.organization_id = alert.organization_id
    and prior.source_key = alert.source_key and prior.recipient = alert.recipient
    and prior.part < alert.part and prior.status in ('accepted', 'delivered');
  if ready_parts <> alert.part - 1 then
    return jsonb_build_object('status', 'busy', 'alert', to_jsonb(alert));
  end if;

  update public.owner_sms_alerts
  set status = 'sending', started_at = clock_timestamp()
  where id = alert.id returning * into alert;
  return jsonb_build_object('status', 'claimed', 'alert', to_jsonb(alert));
end $$;

revoke all on function public.service_claim_owner_sms_alert(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_claim_owner_sms_alert(uuid, uuid) to service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20260912172755',
  table_fingerprint = snapshot.value ->> 'tableFingerprint',
  function_fingerprint = snapshot.value ->> 'functionFingerprint',
  access_fingerprint = snapshot.value ->> 'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';

commit;
