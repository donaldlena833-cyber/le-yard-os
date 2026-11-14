create table private.church_square_order_recoveries (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  location_id uuid not null,
  merchant_id text not null,
  square_location_id text not null,
  order_id text not null,
  source_updated_at timestamptz not null,
  source_version bigint,
  recovered_at timestamptz not null default clock_timestamp(),
  recovered_by uuid not null,
  foreign key (organization_id,location_id) references public.locations(organization_id,id),
  unique nulls not distinct (merchant_id,square_location_id,order_id,source_updated_at,source_version)
);
alter table private.church_square_order_recoveries enable row level security;
alter table private.church_square_order_recoveries force row level security;
revoke all on private.church_square_order_recoveries from public,anon,authenticated,service_role;
create trigger church_square_order_recoveries_append_only
  before update or delete on private.church_square_order_recoveries
  for each row execute function public.prevent_ledger_mutation();

create function public.service_recover_church_square_order(
  p_actor_id uuid,p_location_id uuid,p_merchant_id text,p_square_location_id text,p_order_id text,p_facts jsonb
)
returns boolean language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid;
  updated_at timestamptz;
  created_at timestamptz;
  provider_version bigint;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Square recovery service access is required' using errcode = '42501';
  end if;

  -- Use the location lock shared by Square onboarding and backfill.
  perform 1 from public.locations where id = p_location_id for update;
  organization := private.church_square_count_organization(p_location_id);
  if organization is null or p_actor_id is null or not exists (
    select 1 from public.organization_memberships membership where membership.user_id = p_actor_id
      and membership.organization_id = organization and membership.status = 'active'
      and membership.role in ('owner','admin','manager')
  ) or not private.user_has_capability(p_actor_id,organization,p_location_id,'reports.financial.view',
    (statement_timestamp() at time zone 'America/New_York')::date)
    or not private.user_has_capability(p_actor_id,organization,p_location_id,'manager_log.manage',
      (statement_timestamp() at time zone 'America/New_York')::date) then
    raise exception 'Church Street financial reports and Manager Log access are required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from private.church_square_order_backfill backfill
    where backfill.organization_id = organization and backfill.location_id = p_location_id
      and backfill.merchant_id = p_merchant_id and backfill.square_location_id = p_square_location_id
  ) then
    raise exception 'The Square merchant and location do not match the Church Street connection' using errcode = '42501';
  end if;

  updated_at := private.church_square_watch_instant(p_facts->>'updatedAt');
  created_at := private.church_square_watch_instant(p_facts->>'createdAt');
  if coalesce(p_order_id,'') !~ '^[A-Za-z0-9_:-]{1,192}$'
    or jsonb_typeof(p_facts) is distinct from 'object'
    or p_facts->>'kind' is distinct from 'order'
    or p_facts->>'id' is distinct from p_order_id
    or p_facts->>'locationId' is distinct from p_square_location_id
    or p_facts->>'currency' is distinct from 'USD'
    or coalesce(p_facts->>'status','') not in ('OPEN','COMPLETED','CANCELED','DRAFT','UNKNOWN')
    or updated_at is null or created_at is null or created_at > updated_at
    or updated_at > statement_timestamp() + interval '5 minutes'
    or pg_column_size(p_facts) > 512000
    or not (p_facts ? 'version')
    or (p_facts->'version' <> 'null'::jsonb and (
      jsonb_typeof(p_facts->'version') <> 'number' or p_facts->>'version' !~ '^[0-9]{1,16}$'
    )) then
    raise exception 'The verified order is invalid for Church Street recovery' using errcode = '22023';
  end if;
  provider_version := (p_facts->>'version')::bigint;

  -- Compare revisions exactly as the webhook and scheduled backfill do.
  insert into private.church_square_resource_state as current_state (
    merchant_id,square_location_id,organization_id,location_id,resource_kind,resource_id,source_updated_at,source_version,facts
  ) values (p_merchant_id,p_square_location_id,organization,p_location_id,'order',p_order_id,updated_at,provider_version,p_facts)
  on conflict (merchant_id,square_location_id,resource_kind,resource_id) do update
  set source_updated_at = excluded.source_updated_at, source_version = excluded.source_version,
    facts = excluded.facts, saved_at = clock_timestamp()
  where current_state.organization_id = excluded.organization_id and current_state.location_id = excluded.location_id
    and case when excluded.source_version is not null and current_state.source_version is not null
      then excluded.source_version > current_state.source_version
        or (excluded.source_version = current_state.source_version and excluded.source_updated_at > current_state.source_updated_at)
      else excluded.source_updated_at > current_state.source_updated_at end;
  if not found then return false; end if;

  insert into private.church_square_order_recoveries (
    organization_id,location_id,merchant_id,square_location_id,order_id,source_updated_at,source_version,recovered_by
  ) values (organization,p_location_id,p_merchant_id,p_square_location_id,p_order_id,updated_at,provider_version,p_actor_id)
  on conflict (merchant_id,square_location_id,order_id,source_updated_at,source_version) do nothing;
  return true;
end
$$;

revoke all on function public.service_recover_church_square_order(uuid,uuid,text,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.service_recover_church_square_order(uuid,uuid,text,text,text,jsonb)
  to service_role;

create or replace function public.get_church_square_order_evidence(
  p_location_id uuid,p_merchant_id text,p_square_location_id text,p_order_id text,
  p_square_updated_at timestamptz,p_square_version bigint
)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_count_organization(p_location_id);
begin
  if auth.uid() is null or organization is null
    or not public.has_org_role(organization,array['owner','admin','manager']::public.app_role[])
    or not private.user_has_capability(auth.uid(),organization,p_location_id,'reports.financial.view',
      (statement_timestamp() at time zone 'America/New_York')::date) then
    raise exception 'Church Street financial reports access is required' using errcode = '42501';
  end if;
  if coalesce(p_merchant_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_square_location_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_order_id,'') !~ '^[A-Za-z0-9_:-]{1,192}$'
    or p_square_updated_at is null or not isfinite(p_square_updated_at) or p_square_version < 0 then
    raise exception 'An exact scoped Square order and update are required' using errcode = '22023';
  end if;

  return (
    select jsonb_build_object(
      'updatedAt',state.source_updated_at,
      'matches',state.source_updated_at = p_square_updated_at
        and state.source_version is not distinct from p_square_version,
      'recoveredAt',recovery.recovered_at
    )
    from private.church_square_resource_state state
    left join private.church_square_order_recoveries recovery
      on recovery.organization_id = state.organization_id and recovery.location_id = state.location_id
      and recovery.merchant_id = state.merchant_id and recovery.square_location_id = state.square_location_id
      and recovery.order_id = state.resource_id and recovery.source_updated_at = state.source_updated_at
      and recovery.source_version is not distinct from state.source_version
    where state.organization_id = organization and state.location_id = p_location_id
      and state.merchant_id = p_merchant_id and state.square_location_id = p_square_location_id
      and state.resource_kind = 'order' and state.resource_id = p_order_id
  );
end
$$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114155516', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
