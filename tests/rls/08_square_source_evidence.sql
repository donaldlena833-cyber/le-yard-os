begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(44);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select ok('square'=any(enum_range(null::public.integration_provider)::text[]),'Square has an explicit provider identity');
select is((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in('square_source_versions','square_source_heads','square_source_runs') and c.relrowsecurity and c.relforcerowsecurity),3::bigint,'all three source evidence relations force RLS');
select ok(not has_table_privilege('authenticated','private.square_source_versions','SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('service_role','private.square_source_versions','INSERT,UPDATE,DELETE'),'browser and adapter cannot bypass the source command');
select ok(not has_function_privilege('anon','public.configure_square_source_connection(uuid,uuid,text,text,boolean)','EXECUTE') and not has_function_privilege('authenticated','public.service_ingest_square_source_window(uuid,uuid,timestamptz,timestamptz,jsonb)','EXECUTE'),'configuration is nonanonymous and source persistence is service-only');
create temporary table financial_before as select (select count(*) from public.income_sales_checks) income,(select count(*) from public.shift_closeouts) closeouts,(select count(*) from public.tip_runs) tips;
create function pg_temp.sq_packet(p_id text,p_version bigint,p_at text,p_amount bigint default 2351) returns jsonb language sql as $$
 select jsonb_build_object('kind','order','externalId',p_id,'sourceUpdatedAt',p_at,'objectVersion',p_version,'facts',jsonb_build_object('id',p_id,'location_id','SQUARE_LOCATION_TEST','created_at','2020-01-01T14:00:00Z','updated_at',p_at,'state','COMPLETED','total_money',jsonb_build_object('amount',p_amount,'currency','USD'))||case when p_version is null then '{}'::jsonb else jsonb_build_object('version',p_version) end)
$$;
create function pg_temp.sq_import(p_id uuid,p_rows jsonb) returns jsonb language sql as $$
 select public.service_ingest_square_source_window(p_id,'a5100000-0000-4000-8000-000000000001','2026-10-22T00:00Z','2026-10-23T00:00Z',p_rows)
$$;
set local role authenticated;
create temporary table configured as select public.configure_square_source_connection('a5100000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','MERCHANT_TEST','SQUARE_LOCATION_TEST',true) result;
select is((select result->>'status' from configured),'pending','Owner configures pending source evidence, not a trusted live feed');
select is((public.configure_square_source_connection('a5100000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','MERCHANT_TEST','SQUARE_LOCATION_TEST',true))->>'id','a5100000-0000-4000-8000-000000000001','exact Owner configuration replay retains one connection');
select throws_ok($q$select public.configure_square_source_connection('a5100000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','DIFFERENT_MERCHANT','SQUARE_LOCATION_TEST',true)$q$,'23505',null,'configuration request is payload-bound');
select throws_ok($q$select public.configure_square_source_connection('a5100000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','MERCHANT_TEST','SQUARE_LOCATION_TEST',true)$q$,'42501',null,'Owner cannot configure another tenant');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);
select throws_ok($q$select public.configure_square_source_connection('a5100000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','MERCHANT_TEST','SQUARE_LOCATION_TEST',true)$q$,'42501',null,'Employee cannot configure Square');
select throws_ok($q$select * from private.square_source_versions$q$,'42501',null,'Employee cannot read private Square versions');
-- A denied call through a SQL wrapper crashes this PG17.6 native probe (F44).
-- Verify the actual ACL here and require separate actual-Auth Data API refusal.
select ok(not has_function_privilege('authenticated','public.service_ingest_square_source_window(uuid,uuid,timestamptz,timestamptz,jsonb)','EXECUTE'),'browser role cannot execute source persistence');
reset role;set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create temporary table first_import as select pg_temp.sq_import('a5100000-0000-4000-8000-000000000010',jsonb_build_array(pg_temp.sq_packet('ORDER_1',1,'2026-10-22T20:00:00Z'))) result;
select is((select(result->>'versionsInserted')::int from first_import),1,'first valid version is persisted');
select is((select(result->>'headsAdvanced')::int from first_import),1,'first version becomes the current source head');
select is((select result->>'financialPostingEnabled' from first_import),'false','source receipt never enables financial posting');
select is((pg_temp.sq_import('a5100000-0000-4000-8000-000000000010',jsonb_build_array(pg_temp.sq_packet('ORDER_1',1,'2026-10-22T20:00:00Z')))->>'replayed'),'true','exact window retry returns its original receipt');
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000010',jsonb_build_array(pg_temp.sq_packet('ORDER_1',1,'2026-10-22T20:00:00Z',999)))$q$,'PT409',null,'completed request identity cannot contain different facts');
select is((pg_temp.sq_import('a5100000-0000-4000-8000-000000000011',jsonb_build_array(pg_temp.sq_packet('ORDER_1',1,'2026-10-22T20:00:00Z')))->>'replayedRecords')::int,1,'overlapping new window recognizes an existing exact version');
select is((pg_temp.sq_import('a5100000-0000-4000-8000-000000000012',jsonb_build_array(pg_temp.sq_packet('ORDER_1',2,'2026-10-22T21:00:00Z',2000)))->>'headsAdvanced')::int,1,'newer numeric order version advances its source head');
select is((pg_temp.sq_import('a5100000-0000-4000-8000-000000000013',jsonb_build_array(pg_temp.sq_packet('ORDER_1',0,'2026-10-22T22:00:00Z',1000)))->>'staleRecords')::int,1,'older numeric version is retained as history without replacing current facts');
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000014',jsonb_build_array(pg_temp.sq_packet('ORDER_1',2,'2026-10-22T21:00:00Z',999)))$q$,'PT409',null,'same provider version with different facts requires review');
select is((pg_temp.sq_import('a5100000-0000-4000-8000-000000000015',jsonb_build_array(pg_temp.sq_packet('POS_ORDER',null,'2026-10-22T20:00:00Z')))->>'versionsInserted')::int,1,'POS order without an API version uses its update timestamp');
select is((pg_temp.sq_import('a5100000-0000-4000-8000-000000000016',jsonb_build_array(pg_temp.sq_packet('POS_ORDER',null,'2026-10-22T21:00:00Z',2000)))->>'headsAdvanced')::int,1,'newer timestamp advances an unnumbered POS order');
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000017',jsonb_build_array(pg_temp.sq_packet('POS_ORDER',3,'2026-10-22T22:00:00Z')))$q$,'PT409',null,'changing the source version scheme cannot silently overwrite history');
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000018',jsonb_build_array(pg_temp.sq_packet('WRONG_LOCATION',1,'2026-10-22T20:00:00Z')||jsonb_build_object('facts',(pg_temp.sq_packet('WRONG_LOCATION',1,'2026-10-22T20:00:00Z')->'facts')||'{"location_id":"OTHER_LOCATION"}'::jsonb)))$q$,'22023',null,'source location must exactly match the approved mapping');
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000019',jsonb_build_array(pg_temp.sq_packet('PII',1,'2026-10-22T20:00:00Z')||jsonb_build_object('facts',(pg_temp.sq_packet('PII',1,'2026-10-22T20:00:00Z')->'facts')||'{"customer_email":"test@example.invalid"}'::jsonb)))$q$,'22023',null,'unexpected guest fields are refused by the database contract');
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000020',jsonb_build_array(pg_temp.sq_packet('UNSAFE',1,'2026-10-22T20:00:00Z',9007199254740992)))$q$,'22023',null,'money outside safe integer precision is refused');
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000021',jsonb_build_array(pg_temp.sq_packet('OUTSIDE_WINDOW',1,'2026-10-21T20:00:00Z')))$q$,'22023',null,'facts outside the requested update window are refused');
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000022',jsonb_build_array(pg_temp.sq_packet('ATOMIC_FIRST',1,'2026-10-22T20:00:00Z'),pg_temp.sq_packet('ATOMIC_BAD',1,'2026-10-21T20:00:00Z')))$q$,'22023',null,'one invalid record refuses the whole source window');
reset role;
select is((select count(*) from private.square_source_versions where external_id='ATOMIC_FIRST'),0::bigint,'refused window leaves no earlier source version');
select is((select count(*) from public.integration_sync_jobs where id='a5100000-0000-4000-8000-000000000022'),0::bigint,'refused window leaves no success job');
select is((select v.object_version from private.square_source_heads h join private.square_source_versions v on v.id=h.version_id where h.external_id='ORDER_1'),2::bigint,'stale and conflicting versions leave the current head unchanged');
select throws_ok($q$update private.square_source_versions set payload_hash='changed'$q$,'42501',null,'retained source versions are append-only');
select ok((select status='pending' and configuration->>'financialPostingEnabled'='false' from public.integration_connections where id='a5100000-0000-4000-8000-000000000001'),'source transport does not declare operating integration accepted');
select ok((select income=(select count(*) from public.income_sales_checks) and closeouts=(select count(*) from public.shift_closeouts) and tips=(select count(*) from public.tip_runs) from financial_before),'source ingestion changes no income, closeout or tip record');
-- Preserve the platform's immutable terminal attempts and Owner-approved retry chain.
insert into public.integration_sync_jobs(id,organization_id,connection_id,direction,resource_type,status,cursor,attempts,started_at,completed_at,error_message)
select 'a5100000-0000-4000-8000-000000000040',organization_id,id,'import','square_source_evidence','failed',
 jsonb_build_object('connectionId',id,'squareScope',configuration->'squareScope','windowFrom','2026-10-22T00:00:00Z','windowTo','2026-10-23T00:00:00Z')::text,1,now(),now(),'Native provider failure fixture'
from public.integration_connections where id='a5100000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000040','[]')$q$,'PT409',null,'terminal failed identity cannot be reused as a source success');
reset role;
select ok((select status='failed' and attempts=1 from public.integration_sync_jobs where id='a5100000-0000-4000-8000-000000000040'),'original failed attempt remains unchanged');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
create temporary table queued_square_retry as select public.retry_integration_sync_job('a5100000-0000-4000-8000-000000000041','a5100000-0000-4000-8000-000000000040') result;
select ok((select (result).status='queued' and(result).attempts=2 and(result).retry_of_id='a5100000-0000-4000-8000-000000000040' from queued_square_retry),'Owner queues a separate bound retry with the next attempt');
reset role;set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is((pg_temp.sq_import('a5100000-0000-4000-8000-000000000041','[]')->>'recordsProcessed')::int,0,'queued retry follows running to succeeded without changing attempt identity');
reset role;
select ok((select status='succeeded' and attempts=2 and retry_of_id='a5100000-0000-4000-8000-000000000040' from public.integration_sync_jobs where id='a5100000-0000-4000-8000-000000000041') and(select status='failed' from public.integration_sync_jobs where id='a5100000-0000-4000-8000-000000000040'),'retry success preserves its original failure and audited attempt number');
select ok((select source_scope=(select configuration->'squareScope' from public.integration_connections where id='a5100000-0000-4000-8000-000000000001') from private.square_source_runs where id='a5100000-0000-4000-8000-000000000041'),'accepted source receipt binds the exact approved mapping');
insert into public.integration_sync_jobs(id,organization_id,connection_id,direction,resource_type,status,cursor,attempts)
select 'a5100000-0000-4000-8000-000000000045',organization_id,id,'import','square_source_evidence','queued',
 jsonb_build_object('connectionId',id,'squareScope',(configuration->'squareScope')||'{"merchantId":"OTHER_MERCHANT"}'::jsonb,'windowFrom','2026-10-22T00:00:00Z','windowTo','2026-10-23T00:00:00Z')::text,1
from public.integration_connections where id='a5100000-0000-4000-8000-000000000001';
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000045','[]')$q$,'PT409',null,'queued source request cannot silently change approved merchant scope');
reset role;
select is((select status::text from public.integration_sync_jobs where id='a5100000-0000-4000-8000-000000000045'),'queued','scope refusal preserves the original queue record');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select throws_ok($q$select public.configure_square_source_connection('a5100000-0000-4000-8000-000000000030','30000000-0000-4000-8000-000000000001','DIFFERENT_MERCHANT','SQUARE_LOCATION_TEST',true)$q$,'PT409',null,'retained source evidence prevents silent remapping');
select public.configure_square_source_connection('a5100000-0000-4000-8000-000000000031','30000000-0000-4000-8000-000000000001','MERCHANT_TEST','SQUARE_LOCATION_TEST',false);
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($q$select pg_temp.sq_import('a5100000-0000-4000-8000-000000000032','[]')$q$,'42501',null,'disabled connection stops further ingestion');
reset role;
select * from finish();
rollback;
