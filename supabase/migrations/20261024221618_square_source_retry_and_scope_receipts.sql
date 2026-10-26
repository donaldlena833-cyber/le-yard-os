-- Preserve terminal attempt evidence and use the existing Owner-approved retry flow.
-- New receipts bind the approved source mapping. Older null-scope receipts remain
-- immutable and require review; no provenance is fabricated by backfilling them.
alter table private.square_source_runs add column source_scope jsonb
 check(source_scope is null or jsonb_typeof(source_scope)='object');
do $square_retry$
declare original text;rewritten text;
begin
 if(select md5(prosrc) from pg_proc where oid='public.service_ingest_square_source_window(uuid,uuid,timestamptz,timestamptz,jsonb)'::regprocedure)
  is distinct from '975faa57b96ae4f041de60a5cf315e61' then raise exception 'Reviewed Square source-window body drifted';end if;
 select pg_get_functiondef('public.service_ingest_square_source_window(uuid,uuid,timestamptz,timestamptz,jsonb)'::regprocedure) into original;
 rewritten:=original;
 if position($old0$  return receipt.result||jsonb_build_object('replayed',true);$old0$ in rewritten)=0 then raise exception 'Reviewed Square retry clause0 missing';end if;
 rewritten:=replace(rewritten,$old0$  return receipt.result||jsonb_build_object('replayed',true);$old0$,$new0$  if receipt.source_scope is distinct from scope then raise exception 'Source receipt scope is unknown or changed; review required' using errcode='PT409';end if;
  return receipt.result||jsonb_build_object('replayed',true);$new0$);
 if position($old1$or (prior_job.cursor::jsonb->>'windowTo')::timestamptz is distinct from p_window_to)$old1$ in rewritten)=0 then raise exception 'Reviewed Square retry clause1 missing';end if;
 rewritten:=replace(rewritten,$old1$or (prior_job.cursor::jsonb->>'windowTo')::timestamptz is distinct from p_window_to)$old1$,$new1$or (prior_job.cursor::jsonb->>'windowTo')::timestamptz is distinct from p_window_to or prior_job.cursor::jsonb->'squareScope' is distinct from scope)$new1$);
 if position($old2$ for entry in select value from jsonb_array_elements(p_snapshots) order by value->>'kind',value->>'externalId',value->>'sourceUpdatedAt' loop$old2$ in rewritten)=0 then raise exception 'Reviewed Square retry clause2 missing';end if;
 rewritten:=replace(rewritten,$old2$ for entry in select value from jsonb_array_elements(p_snapshots) order by value->>'kind',value->>'externalId',value->>'sourceUpdatedAt' loop$old2$,$new2$ if prior_job.id is not null and prior_job.status<>'queued' then
  raise exception 'A terminal or running source attempt requires an Owner-approved queued retry identity' using errcode='PT409';end if;
 if prior_job.id is null then
  insert into public.integration_sync_jobs(id,organization_id,connection_id,direction,resource_type,status,attempts,started_at)
  values(p_request_id,connection.organization_id,p_connection_id,'import','square_source_evidence','running',1,clock_timestamp());
 else
  update public.integration_sync_jobs set status='running',started_at=clock_timestamp(),completed_at=null where id=p_request_id;
 end if;
 for entry in select value from jsonb_array_elements(p_snapshots) order by value->>'kind',value->>'externalId',value->>'sourceUpdatedAt' loop$new2$);
 if position($old3$insert into private.square_source_runs(id,organization_id,location_id,connection_id,window_from,window_to,payload_hash,result)
 values(p_request_id,connection.organization_id,connection.location_id,p_connection_id,p_window_from,p_window_to,digest,result);$old3$ in rewritten)=0 then raise exception 'Reviewed Square retry clause3 missing';end if;
 rewritten:=replace(rewritten,$old3$insert into private.square_source_runs(id,organization_id,location_id,connection_id,window_from,window_to,payload_hash,result)
 values(p_request_id,connection.organization_id,connection.location_id,p_connection_id,p_window_from,p_window_to,digest,result);$old3$,$new3$insert into private.square_source_runs(id,organization_id,location_id,connection_id,window_from,window_to,payload_hash,result,source_scope)
 values(p_request_id,connection.organization_id,connection.location_id,p_connection_id,p_window_from,p_window_to,digest,result,scope);$new3$);
 if position($old4$ insert into public.integration_sync_jobs(id,organization_id,connection_id,direction,resource_type,status,cursor,attempts,records_processed,started_at,completed_at)
 values(p_request_id,connection.organization_id,p_connection_id,'import','square_source_evidence','succeeded',jsonb_build_object('connectionId',p_connection_id,'windowFrom',p_window_from,'windowTo',p_window_to,'result',result)::text,1,jsonb_array_length(p_snapshots),clock_timestamp(),clock_timestamp())
 on conflict(id) do update set status='succeeded',cursor=excluded.cursor,records_processed=excluded.records_processed,attempts=integration_sync_jobs.attempts+1,error_message=null,completed_at=excluded.completed_at;$old4$ in rewritten)=0 then raise exception 'Reviewed Square retry clause4 missing';end if;
 rewritten:=replace(rewritten,$old4$ insert into public.integration_sync_jobs(id,organization_id,connection_id,direction,resource_type,status,cursor,attempts,records_processed,started_at,completed_at)
 values(p_request_id,connection.organization_id,p_connection_id,'import','square_source_evidence','succeeded',jsonb_build_object('connectionId',p_connection_id,'windowFrom',p_window_from,'windowTo',p_window_to,'result',result)::text,1,jsonb_array_length(p_snapshots),clock_timestamp(),clock_timestamp())
 on conflict(id) do update set status='succeeded',cursor=excluded.cursor,records_processed=excluded.records_processed,attempts=integration_sync_jobs.attempts+1,error_message=null,completed_at=excluded.completed_at;$old4$,$new4$ update public.integration_sync_jobs set status='succeeded',
  cursor=jsonb_build_object('connectionId',p_connection_id,'squareScope',scope,'windowFrom',p_window_from,'windowTo',p_window_to,'result',result)::text,
  records_processed=jsonb_array_length(p_snapshots),error_message=null,completed_at=clock_timestamp()
 where id=p_request_id;$new4$);
 execute rewritten;
 if(select md5(prosrc) from pg_proc where oid='public.configure_square_source_connection(uuid,uuid,text,text,boolean)'::regprocedure)
  is distinct from 'c8cb909a0a381777fca97796fdf9eb03' then raise exception 'Reviewed Square mapping body drifted';end if;
 select pg_get_functiondef('public.configure_square_source_connection(uuid,uuid,text,text,boolean)'::regprocedure) into original;
 rewritten:=replace(original,
  $old$and exists(select 1 from private.square_source_versions v where v.connection_id=connection.id)$old$,
  $new$and (exists(select 1 from private.square_source_versions v where v.connection_id=connection.id)
   or exists(select 1 from private.square_source_runs r where r.connection_id=connection.id))$new$);
 if rewritten=original then raise exception 'Reviewed Square mapping evidence guard missing';end if;
 execute rewritten;
end
$square_retry$;
update private.runtime_schema_contract_expected expected
set migration_head='20261024221618',table_fingerprint=s.value->>'tableFingerprint',
 function_fingerprint=s.value->>'functionFingerprint',access_fingerprint=s.value->>'accessFingerprint',captured_at=clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) s where expected.contract_version='runtime-schema-v2';
