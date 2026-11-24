-- Extend the existing source-evidence contract to the Ninth Avenue production
-- merchant while keeping Sandbox callers and their retry receipts compatible.
do $square_predecessor$
begin
  if (select md5(prosrc) from pg_proc
      where oid='public.configure_square_source_connection(uuid,uuid,text,text,boolean)'::regprocedure)
      is distinct from '40f9805caed73d774b67f5a4ae124895'
    or (select md5(prosrc) from pg_proc
      where oid='public.service_ingest_square_source_window(uuid,uuid,timestamptz,timestamptz,jsonb)'::regprocedure)
      is distinct from '3b41e7ef61511ccc37beba1012b9d55d' then
    raise exception 'Square source functions differ from the reviewed predecessor';
  end if;
end;
$square_predecessor$;

create function private.configure_square_source_mapping(
  p_request_id uuid,
  p_location_id uuid,
  p_merchant_id text,
  p_square_location_id text,
  p_enabled boolean,
  p_environment text
)
returns jsonb language plpgsql
set search_path = ''
as $$
declare
  location public.locations%rowtype;
  connection public.integration_connections%rowtype;
  target uuid;
  mapping jsonb;
begin
  select l.* into location
  from public.locations l
  join public.organizations o on o.id=l.organization_id
  where l.id=p_location_id and l.is_active
    and (p_environment='sandbox' or (o.slug='le-yard' and o.status='active' and l.code='MAIN'));

  if location.id is null or auth.uid() is null
    or not public.has_org_role(location.organization_id,array['owner','admin']::public.app_role[]) then
    raise exception 'Owner or Admin source configuration is required' using errcode='42501';
  end if;
  if p_request_id is null or p_enabled is null
    or coalesce(p_merchant_id,'') !~ '^[A-Za-z0-9_-]{1,192}$'
    or coalesce(p_square_location_id,'') !~ '^[A-Za-z0-9_-]{1,192}$' then
    raise exception 'Exact Square merchant and location identifiers are required' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('square-source:'||location.organization_id::text||':'||location.id::text,0));
  select c.* into connection
  from public.integration_connections c
  where c.organization_id=location.organization_id and c.location_id=location.id and c.provider='square'
  for update;

  target:=coalesce(connection.id,p_request_id);
  mapping:=jsonb_build_object(
    'environment',p_environment,'merchantId',p_merchant_id,'locationId',p_square_location_id,
    'currency','USD','timeZone',location.timezone,'mode','source_evidence_only','contract','square-source-evidence-v1'
  );

  if private.claim_operation_request(
    p_request_id,'square.source.configure',location.organization_id,location.id,target,
    jsonb_build_object('connectionId',target,'mapping',mapping,'enabled',p_enabled)
  ) then
    if connection.id is not null and connection.configuration->'squareScope' is distinct from mapping
      and (exists(select 1 from private.square_source_versions v where v.connection_id=connection.id)
        or exists(select 1 from private.square_source_runs r where r.connection_id=connection.id)) then
      raise exception 'Square mapping with retained evidence requires a reviewed remapping process' using errcode='PT409';
    end if;

    if connection.id is null then
      insert into public.integration_connections(
        id,organization_id,location_id,provider,display_name,adapter_version,status,capabilities,configuration,created_by
      ) values (
        target,location.organization_id,location.id,'square','Square source evidence · '||location.name,
        'square-source-evidence-v1',case when p_enabled then 'pending' else 'disabled' end,
        '["read_source_evidence"]'::jsonb,
        jsonb_build_object('squareScope',mapping,'financialPostingEnabled',false,'reconciliation','pending'),auth.uid()
      ) returning * into connection;
    else
      update public.integration_connections c
      set status=case when p_enabled then 'pending' else 'disabled' end,
        configuration=c.configuration||jsonb_build_object('squareScope',mapping,'financialPostingEnabled',false,'reconciliation','pending')
      where c.id=connection.id
      returning * into connection;
    end if;
    perform private.complete_operation_request(p_request_id);
  elsif connection.configuration->'squareScope' is distinct from mapping then
    raise exception 'Square source mapping changed after this configuration request' using errcode='PT409';
  end if;

  return jsonb_build_object('id',connection.id,'status',connection.status,'environment',p_environment,'financialPostingEnabled',false);
end;
$$;
revoke all on function private.configure_square_source_mapping(uuid,uuid,text,text,boolean,text)
  from public,anon,authenticated,service_role;

create or replace function public.configure_square_source_connection(
  p_request_id uuid,p_location_id uuid,p_merchant_id text,p_square_location_id text,p_enabled boolean
)
returns jsonb language sql security definer set search_path='' set row_security=off as $$
  select private.configure_square_source_mapping(p_request_id,p_location_id,p_merchant_id,p_square_location_id,p_enabled,'sandbox')
$$;

create function public.configure_square_production_source_connection(
  p_request_id uuid,p_location_id uuid,p_merchant_id text,p_square_location_id text,p_enabled boolean
)
returns jsonb language sql security definer set search_path='' set row_security=off as $$
  select private.configure_square_source_mapping(p_request_id,p_location_id,p_merchant_id,p_square_location_id,p_enabled,'production')
$$;
revoke all on function public.configure_square_production_source_connection(uuid,uuid,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.configure_square_production_source_connection(uuid,uuid,text,text,boolean) to authenticated;

create function private.ingest_square_source_window(
  p_request_id uuid,p_connection_id uuid,p_window_from timestamptz,p_window_to timestamptz,p_snapshots jsonb,
  p_environment text,p_source_scope jsonb
)
returns jsonb language plpgsql set search_path='' as $$
declare connection public.integration_connections%rowtype; scope jsonb;receipt private.square_source_runs%rowtype;
 existing_version private.square_source_versions%rowtype;current_version private.square_source_versions%rowtype;
 entry jsonb;facts jsonb;kind text;external text;v_version_key text;object_version bigint;source_updated timestamptz;
 digest text;facts_hash text;version_id uuid;advance boolean;result jsonb;prior_job public.integration_sync_jobs%rowtype;
 inserted integer:=0;advanced integer:=0;replayed integer:=0;stale integer:=0;orders integer:=0;payments integer:=0;refunds integer:=0;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service-role source ingestion is required' using errcode='42501';end if;
 if p_request_id is null or p_connection_id is null or p_window_from is null or p_window_to is null
  or p_window_to<=p_window_from
  or p_window_to-p_window_from>(case when p_environment='production' then interval '72 hours' else interval '31 days' end)
  or p_window_to>clock_timestamp()+interval '1 minute'
  or jsonb_typeof(p_snapshots) is distinct from 'array' then raise exception 'A bounded complete source window is required' using errcode='22023';end if;
 if jsonb_array_length(p_snapshots)>10000 or pg_column_size(p_snapshots)>33554432 then raise exception 'Source window exceeds bounded capacity' using errcode='22023';end if;
 select * into connection from public.integration_connections c where c.id=p_connection_id and c.provider='square' for update;
 scope:=connection.configuration->'squareScope';
 if connection.id is null or connection.location_id is null or connection.status not in('pending','connected','degraded')
  or scope->>'environment' is distinct from p_environment or scope->>'mode' is distinct from 'source_evidence_only'
  or scope->>'contract' is distinct from 'square-source-evidence-v1'
  or coalesce(scope->>'merchantId','')!~'^[A-Za-z0-9_-]{1,192}$' or coalesce(scope->>'locationId','')!~'^[A-Za-z0-9_-]{1,192}$'
  or scope->>'currency' is distinct from 'USD'
  or connection.configuration->'financialPostingEnabled' is distinct from 'false'::jsonb
  or not exists(
    select 1 from public.locations l
    join public.organizations o on o.id=l.organization_id
    where l.id=connection.location_id and l.organization_id=connection.organization_id
      and l.is_active and l.timezone=scope->>'timeZone'
      and (p_environment='sandbox' or (o.slug='le-yard' and o.status='active' and l.code='MAIN'))
  ) then
  raise exception 'An enabled, exact Square source mapping is required' using errcode='42501';end if;
 if p_environment='production' and p_source_scope is distinct from scope then
  raise exception 'Square source mapping changed after the provider read' using errcode='PT409';end if;
 digest:=encode(extensions.digest(convert_to(p_snapshots::text,'UTF8'),'sha256'),'hex');
 select * into receipt from private.square_source_runs r where r.id=p_request_id;
 if receipt.id is not null then
  if receipt.connection_id<>p_connection_id or receipt.window_from<>p_window_from or receipt.window_to<>p_window_to or receipt.payload_hash<>digest then
   raise exception 'Source request identity contains different scope or facts' using errcode='PT409';end if;
  if receipt.source_scope is distinct from scope then raise exception 'Source receipt scope is unknown or changed; review required' using errcode='PT409';end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 -- Validate the complete window before any source row or public success receipt.
 for entry in select value from jsonb_array_elements(p_snapshots) loop
  if jsonb_typeof(entry)<>'object' or not(entry?&array['kind','externalId','sourceUpdatedAt','objectVersion','facts'])
   or exists(select 1 from jsonb_object_keys(entry) x where x not in('kind','externalId','sourceUpdatedAt','objectVersion','facts'))
   or not private.square_source_facts_valid(entry->>'kind',entry->'facts',scope->>'locationId',scope->>'currency') then
   raise exception 'Invalid or unapproved source fact fields' using errcode='22023';end if;
  facts:=entry->'facts';kind:=entry->>'kind';source_updated:=(facts->>'updated_at')::timestamptz;
  if jsonb_typeof(entry->'externalId')<>'string' or jsonb_typeof(entry->'sourceUpdatedAt')<>'string' or entry->>'externalId' is distinct from facts->>'id' or entry->>'sourceUpdatedAt' is distinct from facts->>'updated_at'
   or source_updated<p_window_from or source_updated>p_window_to
   or coalesce(entry->'objectVersion','null'::jsonb) is distinct from coalesce(facts->'version','null'::jsonb) then
   raise exception 'Source identity/version/window mismatch' using errcode='22023';end if;
 end loop;
 select * into prior_job from public.integration_sync_jobs j where j.id=p_request_id for update;
 if prior_job.id is not null and(prior_job.connection_id<>p_connection_id or prior_job.resource_type<>'square_source_evidence' or prior_job.direction<>'import' or (prior_job.cursor::jsonb->>'windowFrom')::timestamptz is distinct from p_window_from or (prior_job.cursor::jsonb->>'windowTo')::timestamptz is distinct from p_window_to or prior_job.cursor::jsonb->'squareScope' is distinct from scope) then
  raise exception 'Source request identity is already in use' using errcode='PT409';end if;
 if prior_job.id is not null and prior_job.status<>'queued' then
  raise exception 'A terminal or running source attempt requires an Owner-approved queued retry identity' using errcode='PT409';end if;
 if prior_job.id is null then
  insert into public.integration_sync_jobs(id,organization_id,connection_id,direction,resource_type,status,attempts,started_at)
  values(p_request_id,connection.organization_id,p_connection_id,'import','square_source_evidence','running',1,clock_timestamp());
 else
  update public.integration_sync_jobs set status='running',started_at=clock_timestamp(),completed_at=null where id=p_request_id;
 end if;
 for entry in select value from jsonb_array_elements(p_snapshots) order by value->>'kind',value->>'externalId',value->>'sourceUpdatedAt' loop
  facts:=entry->'facts';kind:=entry->>'kind';external:=entry->>'externalId';source_updated:=(entry->>'sourceUpdatedAt')::timestamptz;
  object_version:=nullif(entry->>'objectVersion','')::bigint;
  v_version_key:=case when object_version is not null then 'version:'||object_version::text else 'time:'||extract(epoch from source_updated)::text end;
  facts_hash:=encode(extensions.digest(convert_to(facts::text,'UTF8'),'sha256'),'hex');
  select * into existing_version from private.square_source_versions v where v.connection_id=p_connection_id and v.resource_kind=kind and v.external_id=external and v.version_key=v_version_key;
  if existing_version.id is not null then
   if existing_version.payload_hash<>facts_hash then raise exception 'Square source version contains conflicting facts' using errcode='PT409';end if;
   replayed:=replayed+1;
  else
   insert into private.square_source_versions(organization_id,location_id,connection_id,resource_kind,external_id,version_key,object_version,source_updated_at,source_observed_at,facts,payload_hash)
   values(connection.organization_id,connection.location_id,p_connection_id,kind,external,v_version_key,object_version,source_updated,clock_timestamp(),facts,facts_hash)
   returning id into version_id;
   inserted:=inserted+1;
   select v.* into current_version from private.square_source_heads h join private.square_source_versions v on v.id=h.version_id
    where h.connection_id=p_connection_id and h.resource_kind=kind and h.external_id=external;
   if current_version.id is not null and((current_version.object_version is null)<>(object_version is null)) then
    raise exception 'Square source version scheme changed; review required' using errcode='PT409';end if;
   advance:=current_version.id is null or(case when object_version is not null then object_version>current_version.object_version else source_updated>current_version.source_updated_at end);
   if advance then
    insert into private.square_source_heads(organization_id,location_id,connection_id,resource_kind,external_id,version_id)
    values(connection.organization_id,connection.location_id,p_connection_id,kind,external,version_id)
    on conflict(connection_id,resource_kind,external_id) do update set version_id=excluded.version_id;
    advanced:=advanced+1;
   else stale:=stale+1;end if;
  end if;
  if kind='order' then orders:=orders+1;elsif kind='payment' then payments:=payments+1;else refunds:=refunds+1;end if;
 end loop;
 result:=jsonb_build_object('id',p_request_id,'recordsProcessed',jsonb_array_length(p_snapshots),'versionsInserted',inserted,'headsAdvanced',advanced,'replayedRecords',replayed,'staleRecords',stale,
  'sourceCounts',jsonb_build_object('orders',orders,'payments',payments,'refunds',refunds),'windowFrom',p_window_from,'windowTo',p_window_to,'financialPostingEnabled',false,'reconciliation','pending','replayed',false);
 insert into private.square_source_runs(id,organization_id,location_id,connection_id,window_from,window_to,payload_hash,result,source_scope)
 values(p_request_id,connection.organization_id,connection.location_id,p_connection_id,p_window_from,p_window_to,digest,result,scope);
 update public.integration_sync_jobs set status='succeeded',
  cursor=jsonb_build_object('connectionId',p_connection_id,'squareScope',scope,'windowFrom',p_window_from,'windowTo',p_window_to,'result',result)::text,
  records_processed=jsonb_array_length(p_snapshots),error_message=null,completed_at=clock_timestamp()
 where id=p_request_id;
 -- Source transport success is not reconciliation or live operating acceptance.
 update public.integration_connections set last_synced_at=clock_timestamp(),status='pending',
  configuration=configuration||jsonb_build_object('financialPostingEnabled',false,'reconciliation','pending','lastSourceWindowEnd',greatest(p_window_to,nullif(configuration->>'lastSourceWindowEnd','')::timestamptz))
 where id=p_connection_id;
 return result;
end
$$;
revoke all on function private.ingest_square_source_window(uuid,uuid,timestamptz,timestamptz,jsonb,text,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.service_ingest_square_source_window(
  p_request_id uuid,p_connection_id uuid,p_window_from timestamptz,p_window_to timestamptz,p_snapshots jsonb
)
returns jsonb language sql security definer set search_path='' set row_security=off as $$
  select private.ingest_square_source_window(p_request_id,p_connection_id,p_window_from,p_window_to,p_snapshots,'sandbox',null)
$$;

create function public.service_ingest_square_production_source_window(
  p_request_id uuid,p_connection_id uuid,p_window_from timestamptz,p_window_to timestamptz,p_snapshots jsonb,p_source_scope jsonb
)
returns jsonb language sql security definer set search_path='' set row_security=off as $$
  select private.ingest_square_source_window(p_request_id,p_connection_id,p_window_from,p_window_to,p_snapshots,'production',p_source_scope)
$$;
revoke all on function public.service_ingest_square_production_source_window(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.service_ingest_square_production_source_window(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb) to service_role;

comment on function public.configure_square_production_source_connection(uuid,uuid,text,text,boolean) is
  'Owner/Admin production Square source mapping for the Ninth Avenue restaurant. Retained evidence prevents silent remapping.';
comment on function public.service_ingest_square_production_source_window(uuid,uuid,timestamptz,timestamptz,jsonb,jsonb) is
  'Stores a production Square window only when the scope verified by the worker matches the locked database mapping. No financial posting.';

update private.runtime_schema_contract_expected expected
set migration_head='20261114053212',
  table_fingerprint=snapshot.value->>'tableFingerprint',
  function_fingerprint=snapshot.value->>'functionFingerprint',
  access_fingerprint=snapshot.value->>'accessFingerprint',
  captured_at=clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version='runtime-schema-v2';
