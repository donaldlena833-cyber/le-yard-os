begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(28);

select ok((select count(*)=2 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('reservation_invalidation_signals','service_control_invalidation_signals') and c.relrowsecurity and c.relforcerowsecurity),'both signal tables force RLS');

select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='reservation_invalidation_signals'),array['id','organization_id','location_id','revision','updated_at']::text[],'reservation_invalidation_signals has only bounded scope revision fields');

select ok(has_table_privilege('authenticated','public.reservation_invalidation_signals','SELECT') and not has_table_privilege('authenticated','public.reservation_invalidation_signals','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'),'reservation_invalidation_signals is browser read-only');

select ok(not has_table_privilege('anon','public.reservation_invalidation_signals','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'reservation_invalidation_signals has no anonymous privilege');

select ok(not has_table_privilege('service_role','public.reservation_invalidation_signals','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'),'reservation_invalidation_signals cannot be forged by an adapter');

insert into public.reservation_invalidation_signals(organization_id,location_id) values ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002'),('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003');

select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='service_control_invalidation_signals'),array['id','organization_id','location_id','revision','updated_at']::text[],'service_control_invalidation_signals has only bounded scope revision fields');

select ok(has_table_privilege('authenticated','public.service_control_invalidation_signals','SELECT') and not has_table_privilege('authenticated','public.service_control_invalidation_signals','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'),'service_control_invalidation_signals is browser read-only');

select ok(not has_table_privilege('anon','public.service_control_invalidation_signals','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'service_control_invalidation_signals has no anonymous privilege');

select ok(not has_table_privilege('service_role','public.service_control_invalidation_signals','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'),'service_control_invalidation_signals cannot be forged by an adapter');

insert into public.service_control_invalidation_signals(organization_id,location_id) values ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002'),('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003');

select ok((select count(*)=2 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename in ('reservation_invalidation_signals','service_control_invalidation_signals')),'both safe signal tables are published');

select ok(pg_get_functiondef('public.broadcast_reservation_change()'::regprocedure) !~ 'realtime\.(send|broadcast_changes)' and pg_get_functiondef('private.broadcast_preshift_invalidation()'::regprocedure) !~ 'realtime\.(send|broadcast_changes)','legacy producers no longer emit cached private broadcasts');

select is((select count(*) from pg_policies where schemaname='realtime' and tablename='messages' and policyname in ('le_yard_reservation_broadcast_read','le_yard_preshift_invalidation_read')),0::bigint,'legacy topic policies are retired');

reset role; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);

select is((select count(*) from public.service_control_invalidation_signals),1::bigint,'ordinary staff sees only assigned-location service signal');

select is((select count(*) from public.reservation_invalidation_signals),0::bigint,'location access alone does not expose reservation signal');

select throws_ok($q$insert into public.service_control_invalidation_signals(organization_id,location_id) values ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001')$q$,'42501',null,'browser cannot forge or remove signal: insert');

select throws_ok($q$update public.service_control_invalidation_signals set revision=99$q$,'42501',null,'browser cannot forge or remove signal: update');

select throws_ok($q$delete from public.service_control_invalidation_signals$q$,'42501',null,'browser cannot forge or remove signal: delete');

-- Calling a trigger function as ordinary SQL crashes this local PostgreSQL build.
-- Check its actual ACL here; a separate HTTP case confirms it is not a Data API RPC.
select ok(not has_function_privilege('authenticated','public.broadcast_reservation_change()','EXECUTE') and not has_function_privilege('authenticated',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='broadcast_preshift_invalidation'),'EXECUTE'),'browser cannot directly execute signal producers');

reset role; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);

select is((select count(*) from public.service_control_invalidation_signals),2::bigint,'Owner service signals remain tenant-scoped');

select is((select count(*) from public.reservation_invalidation_signals),2::bigint,'Owner reservation signals remain tenant-scoped');

select public.configure_user_capability_override('a4200000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','a4200000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','reservations.view','30000000-0000-4000-8000-000000000001','grant','Native active-scope fixture',current_date-1,null,true);

reset role; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);

select is((select count(*) from public.reservation_invalidation_signals),1::bigint,'explicit reservation capability admits only its location');

reset role; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);

select public.configure_user_capability_override('a4200000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','a4200000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','reservations.view','30000000-0000-4000-8000-000000000001','deny','Native active-scope fixture',current_date-1,null,true);

reset role; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);

select is((select count(*) from public.reservation_invalidation_signals),0::bigint,'current capability denial removes signal access without token change');

select is((select count(*) from public.service_control_invalidation_signals),1::bigint,'reservation denial does not remove ordinary staff service access');

reset role; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);

select public.administer_organization_member('a4200000-0000-4000-8000-000000000003',(select id from public.organization_memberships where organization_id='20000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000005'),'employee','active',array['30000000-0000-4000-8000-000000000002'::uuid],'30000000-0000-4000-8000-000000000002');

reset role; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);

select is((select count(*) from public.service_control_invalidation_signals where location_id='30000000-0000-4000-8000-000000000001'),0::bigint,'location withdrawal hides its service signal');

select is((select count(*) from public.service_control_invalidation_signals where location_id='30000000-0000-4000-8000-000000000002'),1::bigint,'new location service signal remains visible');

reset role; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);

select public.administer_organization_member('a4200000-0000-4000-8000-000000000004',(select id from public.organization_memberships where organization_id='20000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000005'),'employee','suspended',array['30000000-0000-4000-8000-000000000002'::uuid],'30000000-0000-4000-8000-000000000002');

reset role; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);

select is((select count(*) from public.service_control_invalidation_signals),0::bigint,'suspension hides all service signals with original claims');

select is((select count(*) from public.reservation_invalidation_signals),0::bigint,'suspension hides all reservation signals with original claims');

reset role;

select throws_ok($q$set local role anon; select * from public.service_control_invalidation_signals$q$,'42501',null,'anonymous API cannot read service signals');

reset role;

select * from finish(); rollback;
