create table private.church_square_marketplace_links (
  organization_id uuid not null,
  location_id uuid not null,
  merchant_id text not null check (merchant_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  square_location_id text not null check (square_location_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  order_id text not null check (order_id ~ '^[A-Za-z0-9_:-]{1,192}$'),
  channel text not null check (channel in ('DOORDASH','UBER_EATS','GRUBHUB')),
  external_store_id text not null check (external_store_id ~ '^[A-Za-z0-9_:-]{1,100}$'),
  external_order_id text not null check (external_order_id ~ '^[A-Za-z0-9_:-]{12,100}$'),
  original_evidence text not null check (original_evidence in ('merchant_order','payout_statement')),
  source_updated_at timestamptz not null,
  source_version bigint check (source_version >= 0),
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid not null,
  payout_evidence_at timestamptz,
  payout_evidence_by uuid,
  payout_source_updated_at timestamptz,
  payout_source_version bigint check (payout_source_version >= 0),
  primary key (location_id,merchant_id,square_location_id,order_id),
  unique (organization_id,channel,external_store_id,external_order_id),
  foreign key (organization_id,location_id) references public.locations(organization_id,id),
  check (
    (payout_evidence_at is not null and payout_evidence_by is not null and payout_source_updated_at is not null
      and original_evidence = 'merchant_order')
    or (payout_evidence_at is null and payout_evidence_by is null and payout_source_updated_at is null
      and payout_source_version is null)
  )
);

alter table private.church_square_marketplace_links enable row level security;
alter table private.church_square_marketplace_links force row level security;
revoke all on private.church_square_marketplace_links from public,anon,authenticated,service_role;

create function private.church_square_marketplace_authority(p_actor_id uuid,p_location_id uuid,p_writes boolean)
returns uuid language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
begin
  if p_actor_id is null or organization is null or not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = organization and membership.user_id = p_actor_id and membership.status = 'active'
      and membership.role in ('owner','admin','manager')
  ) or not private.user_has_capability(p_actor_id,organization,p_location_id,'reports.financial.view',business_date)
    or (p_writes and not private.user_has_capability(p_actor_id,organization,p_location_id,'manager_log.manage',business_date)) then
    raise exception 'Church Street marketplace evidence access is required' using errcode = '42501';
  end if;
  return organization;
end
$$;

create function private.church_square_marketplace_link_view(p_link private.church_square_marketplace_links)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object('channel',p_link.channel,'storeReference',right(p_link.external_store_id,10),
    'orderReference',right(p_link.external_order_id,10),'recordedAt',p_link.recorded_at,
    'evidence',case when p_link.payout_evidence_at is not null then 'payout_statement' else p_link.original_evidence end)
$$;

create function public.get_church_square_marketplace_link(
  p_location_id uuid,p_merchant_id text,p_square_location_id text,p_order_id text
)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_marketplace_authority(auth.uid(),p_location_id,false);
begin
  if coalesce(p_merchant_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_square_location_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_order_id,'') !~ '^[A-Za-z0-9_:-]{1,192}$' then
    raise exception 'An exact scoped Square order is required' using errcode = '22023';
  end if;
  return (
    select private.church_square_marketplace_link_view(link) from private.church_square_marketplace_links link
    where link.organization_id = organization and link.location_id = p_location_id
      and link.merchant_id = p_merchant_id and link.square_location_id = p_square_location_id and link.order_id = p_order_id
  );
end
$$;

create function public.service_save_church_square_marketplace_link(
  p_location_id uuid,p_merchant_id text,p_square_location_id text,p_order_id text,
  p_actor_id uuid,p_square_updated_at timestamptz,p_square_version bigint,p_channel text,
  p_external_store_id text,p_external_order_id text,p_evidence text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid;
  link private.church_square_marketplace_links%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Square verification service access is required' using errcode = '42501';
  end if;
  organization := private.church_square_marketplace_authority(p_actor_id,p_location_id,true);
  if coalesce(p_merchant_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_square_location_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
    or coalesce(p_order_id,'') !~ '^[A-Za-z0-9_:-]{1,192}$'
    or p_square_updated_at is null or not isfinite(p_square_updated_at) or p_square_version < 0
    or coalesce(p_channel,'') not in ('DOORDASH','UBER_EATS','GRUBHUB')
    or coalesce(p_external_store_id,'') !~ '^[A-Za-z0-9_:-]{1,100}$'
    or coalesce(p_external_order_id,'') !~ '^[A-Za-z0-9_:-]{12,100}$'
    or coalesce(p_evidence,'') not in ('merchant_order','payout_statement') then
    raise exception 'Exact Square and marketplace order evidence is required' using errcode = '22023';
  end if;

  -- The canonical row lock serializes attribution and evidence upgrades per order,
  -- while the external identity unique constraint protects across different orders.
  perform 1 from private.church_square_resource_state state
  where state.organization_id = organization and state.location_id = p_location_id
    and state.merchant_id = p_merchant_id and state.square_location_id = p_square_location_id
    and state.resource_kind = 'order' and state.resource_id = p_order_id
    and state.source_updated_at = p_square_updated_at and state.source_version is not distinct from p_square_version
  for update;
  if not found then
    raise exception 'Operations needs the current exact Square order revision. Check the order again.' using errcode = '40001';
  end if;
  perform private.church_square_marketplace_authority(p_actor_id,p_location_id,true);

  select * into link from private.church_square_marketplace_links current_link
  where current_link.organization_id = organization and current_link.location_id = p_location_id
    and current_link.merchant_id = p_merchant_id and current_link.square_location_id = p_square_location_id
    and current_link.order_id = p_order_id;
  if found then
    if (link.channel,link.external_store_id,link.external_order_id) is distinct from
      (p_channel,p_external_store_id,p_external_order_id) then
      raise exception 'This Square order already has a different marketplace identity' using errcode = '23505';
    end if;
    if p_evidence = 'payout_statement' and link.original_evidence = 'merchant_order' and link.payout_evidence_at is null then
      update private.church_square_marketplace_links target
      set payout_evidence_at = clock_timestamp(),payout_evidence_by = p_actor_id,
        payout_source_updated_at = p_square_updated_at,payout_source_version = p_square_version
      where target.location_id = p_location_id and target.merchant_id = p_merchant_id
        and target.square_location_id = p_square_location_id and target.order_id = p_order_id returning * into link;
    end if;
    return private.church_square_marketplace_link_view(link);
  end if;

  begin
    insert into private.church_square_marketplace_links (
      organization_id,location_id,merchant_id,square_location_id,order_id,channel,external_store_id,external_order_id,
      original_evidence,source_updated_at,source_version,recorded_by
    ) values (
      organization,p_location_id,p_merchant_id,p_square_location_id,p_order_id,p_channel,p_external_store_id,p_external_order_id,
      p_evidence,p_square_updated_at,p_square_version,p_actor_id
    ) returning * into link;
  exception when unique_violation then
    raise exception 'This marketplace order already has a different Square identity' using errcode = '23505';
  end;
  return private.church_square_marketplace_link_view(link);
end
$$;

revoke all on function private.church_square_marketplace_authority(uuid,uuid,boolean),
  private.church_square_marketplace_link_view(private.church_square_marketplace_links),
  public.get_church_square_marketplace_link(uuid,text,text,text),
  public.service_save_church_square_marketplace_link(uuid,text,text,text,uuid,timestamptz,bigint,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_church_square_marketplace_link(uuid,text,text,text) to authenticated;
grant execute on function public.service_save_church_square_marketplace_link(uuid,text,text,text,uuid,timestamptz,bigint,text,text,text,text)
  to service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114180103', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
