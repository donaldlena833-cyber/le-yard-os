-- Durable, service-written pilot jobs. Reserve cost before any paid model call.
create table public.sms_ai_runs (
 organization_id uuid not null,
 location_id uuid not null,
 source_sid text not null,
 status text not null default 'queued' check(status in ('queued','processing','completed','held','failed')),
 model text not null default 'gemini-3.1-flash-lite' check(model='gemini-3.1-flash-lite'),
 created_at timestamptz not null default clock_timestamp(),
 started_at timestamptz,
 completed_at timestamptz,
 week_start date,
 reserved_micro_usd integer not null default 0 check(reserved_micro_usd between 0 and 10000),
 input_tokens integer check(input_tokens >= 0),
 output_tokens integer check(output_tokens >= 0),
 latency_ms integer check(latency_ms >= 0),
 decision jsonb,
 reply_sid text,
 error_code text,
 primary key(organization_id,source_sid),
 foreign key(organization_id,source_sid) references public.communication_messages(organization_id,sid),
 foreign key(organization_id,location_id) references public.locations(organization_id,id)
);
create index sms_ai_runs_queue on public.sms_ai_runs(organization_id,status,created_at);
create index sms_ai_runs_budget on public.sms_ai_runs(organization_id,week_start);
alter table public.sms_ai_runs enable row level security;
alter table public.sms_ai_runs force row level security;
revoke all on public.sms_ai_runs from public,anon,authenticated;
grant select on public.sms_ai_runs to authenticated;
grant all on public.sms_ai_runs to service_role;
create policy sms_ai_runs_owner_read on public.sms_ai_runs for select to authenticated using(public.has_org_role(organization_id,array['owner','admin']::public.app_role[]));

create function public.service_enqueue_sms_ai_run(p_organization_id uuid,p_location_id uuid,p_source_sid text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if not exists(select 1 from public.communication_messages m where m.organization_id=p_organization_id and m.location_id=p_location_id and m.sid=p_source_sid and m.direction='inbound') then raise exception 'Inbound message required' using errcode='22023'; end if;
 insert into public.sms_ai_runs(organization_id,location_id,source_sid) values(p_organization_id,p_location_id,p_source_sid) on conflict do nothing;
end $$;

create function public.service_claim_sms_ai_run(p_organization_id uuid,p_source_sid text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.sms_ai_runs%rowtype; message public.communication_messages%rowtype; week date := date_trunc('week',clock_timestamp() at time zone 'UTC')::date; spent bigint;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 -- Serialize claims and budget reservations across all server instances.
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':sms-ai-budget',0));
 select * into job from public.sms_ai_runs where organization_id=p_organization_id and source_sid=p_source_sid for update;
 if not found then return jsonb_build_object('status','missing'); end if;
 select * into strict message from public.communication_messages where organization_id=p_organization_id and sid=p_source_sid;
 if exists(select 1 from public.sms_ai_runs r join public.communication_messages m on m.organization_id=r.organization_id and m.sid=r.source_sid where r.organization_id=p_organization_id and r.status='processing' and m.from_number=message.from_number and r.started_at < clock_timestamp()-interval '90 seconds') then
   update public.sms_ai_runs r set status='held',completed_at=clock_timestamp(),error_code='worker_interrupted' from public.communication_messages m where m.organization_id=r.organization_id and m.sid=r.source_sid and r.organization_id=p_organization_id and r.status='processing' and m.from_number=message.from_number;
   insert into public.communication_threads(organization_id,location_id,phone,mode,reason) values(p_organization_id,job.location_id,message.from_number,'human','Pilot result needs review after an interrupted worker') on conflict(organization_id,phone) do update set mode='human',reason=excluded.reason,updated_at=clock_timestamp();
 end if;
 if job.status='processing' and job.started_at < clock_timestamp()-interval '90 seconds' then return jsonb_build_object('status','held'); end if;
 if job.status<>'queued' then return jsonb_build_object('status',job.status); end if;
 if exists(select 1 from public.communication_threads where organization_id=p_organization_id and phone=message.from_number and mode='human') then
   update public.sms_ai_runs set status='held',completed_at=clock_timestamp(),error_code='human_handling' where organization_id=p_organization_id and source_sid=p_source_sid;
   return jsonb_build_object('status','held');
 end if;
 if exists(select 1 from public.sms_ai_runs r join public.communication_messages m on m.organization_id=r.organization_id and m.sid=r.source_sid where r.organization_id=p_organization_id and r.status='processing' and m.from_number=message.from_number) then return jsonb_build_object('status','busy'); end if;
 -- Preserve conversation order even if two callback workers race.
 if exists(select 1 from public.sms_ai_runs r join public.communication_messages m on m.organization_id=r.organization_id and m.sid=r.source_sid where r.organization_id=p_organization_id and r.status='queued' and m.from_number=message.from_number and (r.created_at,r.source_sid)<(job.created_at,job.source_sid)) then return jsonb_build_object('status','busy'); end if;
 select coalesce(sum(reserved_micro_usd),0) into spent from public.sms_ai_runs where organization_id=p_organization_id and week_start=week;
 if spent+10000>5000000 then
   update public.sms_ai_runs set status='held',completed_at=clock_timestamp(),error_code='weekly_budget' where organization_id=p_organization_id and source_sid=p_source_sid;
   return jsonb_build_object('status','budget');
 end if;
 update public.sms_ai_runs set status='processing',started_at=clock_timestamp(),week_start=week,reserved_micro_usd=10000 where organization_id=p_organization_id and source_sid=p_source_sid;
 return jsonb_build_object('status','claimed');
end $$;
revoke all on function public.service_enqueue_sms_ai_run(uuid,uuid,text),public.service_claim_sms_ai_run(uuid,text) from public,anon,authenticated;
grant execute on function public.service_enqueue_sms_ai_run(uuid,uuid,text),public.service_claim_sms_ai_run(uuid,text) to service_role;

update private.runtime_schema_contract_expected expected set migration_head='20260908120002',table_fingerprint=snapshot.value->>'tableFingerprint',function_fingerprint=snapshot.value->>'functionFingerprint',access_fingerprint=snapshot.value->>'accessFingerprint',captured_at=clock_timestamp() from(select private.compute_runtime_schema_fingerprints() as value) snapshot where expected.contract_version='runtime-schema-v2';
