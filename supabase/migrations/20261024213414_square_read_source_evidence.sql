-- Sandbox source evidence is separate from approved income, tips and payroll.
-- It retains immutable versions and refuses ambiguous updates; no financial posting.
create table private.square_source_versions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null, location_id uuid not null, connection_id uuid not null,
 resource_kind text not null check(resource_kind in ('order','payment','refund')),
 external_id text not null check(external_id ~ '^[A-Za-z0-9_-]{1,192}$'),
 version_key text not null, object_version bigint,
 source_updated_at timestamptz not null, source_observed_at timestamptz not null,
 facts jsonb not null check(jsonb_typeof(facts)='object'), payload_hash text not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(organization_id,location_id) references public.locations(organization_id,id),
 foreign key(organization_id,connection_id) references public.integration_connections(organization_id,id),
 unique(connection_id,resource_kind,external_id,version_key),
 unique(organization_id,location_id,connection_id,resource_kind,external_id,id)
);
create table private.square_source_heads (
 organization_id uuid not null, location_id uuid not null, connection_id uuid not null,
 resource_kind text not null, external_id text not null, version_id uuid not null,
 primary key(connection_id,resource_kind,external_id),
 foreign key(organization_id,location_id,connection_id,resource_kind,external_id,version_id)
  references private.square_source_versions(organization_id,location_id,connection_id,resource_kind,external_id,id)
);
create table private.square_source_runs (
 id uuid primary key, organization_id uuid not null, location_id uuid not null, connection_id uuid not null,
 window_from timestamptz not null,window_to timestamptz not null, payload_hash text not null,
 result jsonb not null,completed_at timestamptz not null default clock_timestamp(),
 foreign key(organization_id,location_id) references public.locations(organization_id,id),
 foreign key(organization_id,connection_id) references public.integration_connections(organization_id,id),
 check(window_to>window_from)
);
alter table private.square_source_versions enable row level security;
alter table private.square_source_versions force row level security;
alter table private.square_source_heads enable row level security;
alter table private.square_source_heads force row level security;
alter table private.square_source_runs enable row level security;
alter table private.square_source_runs force row level security;
revoke all on private.square_source_versions,private.square_source_heads,private.square_source_runs from public,anon,authenticated,service_role;
create trigger square_source_versions_append_only before update or delete on private.square_source_versions
 for each row execute function public.guard_reservation_append_only();
create trigger square_source_runs_append_only before update or delete on private.square_source_runs
 for each row execute function public.guard_reservation_append_only();

create function private.square_money_valid(p_value jsonb,p_currency text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p_value)='object'
  and p_value ?& array['amount','currency']
  and not exists(select 1 from jsonb_object_keys(p_value) k where k not in ('amount','currency'))
  and jsonb_typeof(p_value->'amount')='number'
  and (p_value->>'amount') ~ '^-?[0-9]+$'
  and (p_value->>'amount')::numeric between -9007199254740991 and 9007199254740991
  and p_value->>'currency'=p_currency,false)
$$;
revoke all on function private.square_money_valid(jsonb,text) from public,anon,authenticated,service_role;

create function private.square_source_facts_valid(p_kind text,p_facts jsonb,p_location text,p_currency text)
returns boolean language plpgsql stable set search_path='' as $$
declare allowed text[]; k text;v jsonb;child jsonb;money_key text;state text;
begin
 if jsonb_typeof(p_facts) is distinct from 'object' then return false;end if;
 allowed:=array['id','location_id','created_at','updated_at'];
 if p_kind='order' then allowed:=allowed||array['state','version','closed_at','total_money','total_tax_money','total_discount_money','total_tip_money','total_service_charge_money','net_amounts','return_amounts','tenders'];
 elsif p_kind='payment' then allowed:=allowed||array['status','order_id','source_type','amount_money','total_money','tip_money','refunded_money','approved_money','version_token','is_offline_payment','processing_fee'];
 elsif p_kind='refund' then allowed:=allowed||array['status','payment_id','order_id','amount_money'];
 else return false;end if;
 if exists(select 1 from jsonb_object_keys(p_facts) x where not(x=any(allowed)))
  or not(p_facts ?& array['id','location_id','created_at','updated_at'])
  or jsonb_typeof(p_facts->'id')<>'string' or jsonb_typeof(p_facts->'location_id')<>'string'
  or coalesce(p_facts->>'id','') !~ '^[A-Za-z0-9_-]{1,192}$'
  or p_facts->>'location_id' is distinct from p_location then return false;end if;
 foreach k in array array['created_at','updated_at','closed_at'] loop
  if p_facts?k and (jsonb_typeof(p_facts->k)<>'string' or (p_facts->>k) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$') then return false;end if;
 end loop;
 if (p_facts->>'updated_at')::timestamptz < (p_facts->>'created_at')::timestamptz
  or (p_facts?'closed_at' and (p_facts->>'closed_at')::timestamptz < (p_facts->>'created_at')::timestamptz) then return false;end if;
 state:=p_facts->>case when p_kind='order' then 'state' else 'status' end;
 if state is null or (p_kind='order' and state not in ('OPEN','COMPLETED','CANCELED','DRAFT'))
  or(p_kind='payment' and state not in ('APPROVED','PENDING','COMPLETED','CANCELED','FAILED'))
  or(p_kind='refund' and state not in ('PENDING','COMPLETED','REJECTED','FAILED')) then return false;end if;
 if p_facts?'version' and (jsonb_typeof(p_facts->'version')<>'number' or(p_facts->>'version')!~'^[0-9]+$' or(p_facts->>'version')::numeric>9007199254740991) then return false;end if;
 foreach k in array array['order_id','payment_id'] loop
  if p_facts?k and coalesce(p_facts->>k,'') !~'^[A-Za-z0-9_-]{1,192}$' then return false;end if;
 end loop;
 if p_kind='payment' and (coalesce(p_facts->>'source_type','')!~'^[A-Z_]{1,80}$'
  or(p_facts?'is_offline_payment' and jsonb_typeof(p_facts->'is_offline_payment')<>'boolean')
  or(p_facts?'version_token' and(jsonb_typeof(p_facts->'version_token')<>'string' or length(p_facts->>'version_token') not between 1 and 512))) then return false;end if;
 if p_kind='refund' and not(p_facts?'amount_money') then return false;end if;
 for k,v in select * from jsonb_each(p_facts) loop
  if k like '%\_money' escape '\' and not private.square_money_valid(v,p_currency) then return false;end if;
  if k in ('net_amounts','return_amounts') then
   if jsonb_typeof(v)<>'object' or exists(select 1 from jsonb_object_keys(v) x where x not in('total_money','tax_money','discount_money','tip_money','service_charge_money')) then return false;end if;
   for child in select value from jsonb_each(v) loop if not private.square_money_valid(child,p_currency) then return false;end if;end loop;
  end if;
  if k in ('tenders','processing_fee') then
   if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>1000 then return false;end if;
   for child in select value from jsonb_array_elements(v) loop
    if jsonb_typeof(child)<>'object' then return false;end if;
    if k='tenders' then
     if exists(select 1 from jsonb_object_keys(child) x where x not in('id','payment_id','type','amount_money','tip_money')) or coalesce(child->>'type','')!~'^[A-Z_]{1,80}$' then return false;end if;
     foreach money_key in array array['id','payment_id'] loop
      if child?money_key and coalesce(child->>money_key,'')!~'^[A-Za-z0-9_-]{1,192}$' then return false;end if;
     end loop;
    else
     if exists(select 1 from jsonb_object_keys(child) x where x not in('effective_at','type','amount_money')) or not(child?'amount_money')
      or(child?'type' and coalesce(child->>'type','')!~'^[A-Z_]{1,80}$')
      or(child?'effective_at' and (child->>'effective_at')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$') then return false;end if;
    end if;
    foreach money_key in array array['amount_money','tip_money'] loop
     if child?money_key and not private.square_money_valid(child->money_key,p_currency) then return false;end if;
    end loop;
   end loop;
  end if;
 end loop;
 return true;
exception when others then return false;
end
$$;
revoke all on function private.square_source_facts_valid(text,jsonb,text,text) from public,anon,authenticated,service_role;

create function public.configure_square_source_connection(p_request_id uuid,p_location_id uuid,p_merchant_id text,p_square_location_id text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare location public.locations%rowtype;connection public.integration_connections%rowtype;target uuid;payload jsonb;mapping jsonb;claimed boolean;
begin
 select * into location from public.locations l where l.id=p_location_id and l.is_active;
 if location.id is null or auth.uid() is null or not public.has_org_role(location.organization_id,array['owner','admin']::public.app_role[]) then
  raise exception 'Owner or Admin source configuration is required' using errcode='42501';end if;
 if p_request_id is null or p_enabled is null or coalesce(p_merchant_id,'')!~'^[A-Za-z0-9_-]{1,192}$' or coalesce(p_square_location_id,'')!~'^[A-Za-z0-9_-]{1,192}$' then
  raise exception 'Exact Square Sandbox merchant and location identifiers are required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('square-source:'||location.organization_id::text||':'||location.id::text,0));
 select * into connection from public.integration_connections c where c.organization_id=location.organization_id and c.location_id=location.id and c.provider='square' for update;
 target:=coalesce(connection.id,p_request_id);
 mapping:=jsonb_build_object('environment','sandbox','merchantId',p_merchant_id,'locationId',p_square_location_id,'currency','USD','timeZone',location.timezone,'mode','source_evidence_only','contract','square-source-evidence-v1');
 payload:=jsonb_build_object('connectionId',target,'mapping',mapping,'enabled',p_enabled);
 claimed:=private.claim_operation_request(p_request_id,'square.source.configure',location.organization_id,location.id,target,payload);
 if claimed then
  if connection.id is not null and connection.configuration->'squareScope' is distinct from mapping
   and exists(select 1 from private.square_source_versions v where v.connection_id=connection.id) then
   raise exception 'Square mapping with retained evidence requires a reviewed remapping process' using errcode='PT409';end if;
  insert into public.integration_connections(id,organization_id,location_id,provider,display_name,adapter_version,status,capabilities,configuration,created_by)
  values(target,location.organization_id,location.id,'square','Square source evidence · '||location.name,'square-source-evidence-v1',case when p_enabled then 'pending' else 'disabled' end,'["read_source_evidence"]'::jsonb,jsonb_build_object('squareScope',mapping,'financialPostingEnabled',false,'reconciliation','pending'),auth.uid())
  on conflict(id) do update set status=excluded.status,configuration=integration_connections.configuration||excluded.configuration;
  perform private.complete_operation_request(p_request_id);
 end if;
 select * into connection from public.integration_connections c where c.id=target;
 return jsonb_build_object('id',connection.id,'status',connection.status,'environment','sandbox','financialPostingEnabled',false);
end
$$;
revoke all on function public.configure_square_source_connection(uuid,uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.configure_square_source_connection(uuid,uuid,text,text,boolean) to authenticated;

create function public.service_ingest_square_source_window(p_request_id uuid,p_connection_id uuid,p_window_from timestamptz,p_window_to timestamptz,p_snapshots jsonb)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare connection public.integration_connections%rowtype; scope jsonb;receipt private.square_source_runs%rowtype;
 existing_version private.square_source_versions%rowtype;current_version private.square_source_versions%rowtype;
 entry jsonb;facts jsonb;kind text;external text;v_version_key text;object_version bigint;source_updated timestamptz;
 digest text;facts_hash text;version_id uuid;advance boolean;result jsonb;prior_job public.integration_sync_jobs%rowtype;
 inserted integer:=0;advanced integer:=0;replayed integer:=0;stale integer:=0;orders integer:=0;payments integer:=0;refunds integer:=0;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service-role source ingestion is required' using errcode='42501';end if;
 if p_request_id is null or p_connection_id is null or p_window_from is null or p_window_to is null
  or p_window_to<=p_window_from or p_window_to-p_window_from>interval '31 days' or p_window_to>clock_timestamp()+interval '1 minute'
  or jsonb_typeof(p_snapshots) is distinct from 'array' then raise exception 'A bounded complete source window is required' using errcode='22023';end if;
 if jsonb_array_length(p_snapshots)>10000 or pg_column_size(p_snapshots)>33554432 then raise exception 'Source window exceeds bounded capacity' using errcode='22023';end if;
 select * into connection from public.integration_connections c where c.id=p_connection_id and c.provider='square' for update;
 scope:=connection.configuration->'squareScope';
 if connection.id is null or connection.location_id is null or connection.status not in('pending','connected','degraded')
  or scope->>'environment' is distinct from 'sandbox' or scope->>'mode' is distinct from 'source_evidence_only'
  or scope->>'contract' is distinct from 'square-source-evidence-v1'
  or coalesce(scope->>'merchantId','')!~'^[A-Za-z0-9_-]{1,192}$' or coalesce(scope->>'locationId','')!~'^[A-Za-z0-9_-]{1,192}$'
  or scope->>'currency' is distinct from 'USD'
  or not exists(select 1 from public.locations l where l.id=connection.location_id and l.organization_id=connection.organization_id and l.is_active and l.timezone=scope->>'timeZone') then
  raise exception 'An enabled, exact Square Sandbox source mapping is required' using errcode='42501';end if;
 digest:=encode(extensions.digest(convert_to(p_snapshots::text,'UTF8'),'sha256'),'hex');
 select * into receipt from private.square_source_runs r where r.id=p_request_id;
 if receipt.id is not null then
  if receipt.connection_id<>p_connection_id or receipt.window_from<>p_window_from or receipt.window_to<>p_window_to or receipt.payload_hash<>digest then
   raise exception 'Source request identity contains different scope or facts' using errcode='PT409';end if;
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
 if prior_job.id is not null and(prior_job.connection_id<>p_connection_id or prior_job.resource_type<>'square_source_evidence' or prior_job.direction<>'import' or (prior_job.cursor::jsonb->>'windowFrom')::timestamptz is distinct from p_window_from or (prior_job.cursor::jsonb->>'windowTo')::timestamptz is distinct from p_window_to) then
  raise exception 'Source request identity is already in use' using errcode='PT409';end if;
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
 insert into private.square_source_runs(id,organization_id,location_id,connection_id,window_from,window_to,payload_hash,result)
 values(p_request_id,connection.organization_id,connection.location_id,p_connection_id,p_window_from,p_window_to,digest,result);
 insert into public.integration_sync_jobs(id,organization_id,connection_id,direction,resource_type,status,cursor,attempts,records_processed,started_at,completed_at)
 values(p_request_id,connection.organization_id,p_connection_id,'import','square_source_evidence','succeeded',jsonb_build_object('connectionId',p_connection_id,'windowFrom',p_window_from,'windowTo',p_window_to,'result',result)::text,1,jsonb_array_length(p_snapshots),clock_timestamp(),clock_timestamp())
 on conflict(id) do update set status='succeeded',cursor=excluded.cursor,records_processed=excluded.records_processed,attempts=integration_sync_jobs.attempts+1,error_message=null,completed_at=excluded.completed_at;
 -- Source transport success is not reconciliation or live operating acceptance.
 update public.integration_connections set last_synced_at=clock_timestamp(),status='pending',
  configuration=configuration||jsonb_build_object('financialPostingEnabled',false,'reconciliation','pending','lastSourceWindowEnd',greatest(p_window_to,nullif(configuration->>'lastSourceWindowEnd','')::timestamptz))
 where id=p_connection_id;
 return result;
end
$$;
revoke all on function public.service_ingest_square_source_window(uuid,uuid,timestamptz,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_ingest_square_source_window(uuid,uuid,timestamptz,timestamptz,jsonb) to service_role;

comment on function public.configure_square_source_connection(uuid,uuid,text,text,boolean) is
 'Owner/Admin exact Sandbox source mapping. Retained evidence prevents silent remapping; financial posting remains disabled.';
comment on function public.service_ingest_square_source_window(uuid,uuid,timestamptz,timestamptz,jsonb) is
 'Atomic validated Square source-evidence window with immutable versions and payload-bound receipt; no income, closeout, tips or payroll posting.';
update private.runtime_schema_contract_expected expected
set migration_head='20261024213414',table_fingerprint=s.value->>'tableFingerprint',
 function_fingerprint=s.value->>'functionFingerprint',access_fingerprint=s.value->>'accessFingerprint',captured_at=clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) s where expected.contract_version='runtime-schema-v2';
