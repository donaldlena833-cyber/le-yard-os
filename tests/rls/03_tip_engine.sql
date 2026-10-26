begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);

-- Preserve the original rounding, weighting, split-shift, adjustment and
-- locking vectors. Seed reviewed labor as test fixtures, then derive every
-- user-operated run from approved closeouts through the current commands.
-- These synthetic policy/hour inputs are not restaurant operating policy.
select set_config('request.jwt.claims','{}',true);
insert into public.user_capability_overrides(organization_id,user_id,capability_key,location_id,effect,reason,effective_from,created_by,updated_by) select '20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004',cap,'30000000-0000-4000-8000-000000000001','grant','Native financial RLS fixture',current_date-30,'10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001' from unnest(array['tip.calculate','tip.approve','closeout.create','reports.financial.view']) cap;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select public.save_tip_pool_policy_draft('b3000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','hours',((now() at time zone 'America/New_York')::date-5),null,array['card_tips'],'[{"job_role_id": "40000000-0000-4000-8000-000000000001", "eligible": true, "points": 1, "minimum_minutes": 0}, {"job_role_id": "40000000-0000-4000-8000-000000000002", "eligible": false, "points": 1, "minimum_minutes": 0}, {"job_role_id": "40000000-0000-4000-8000-000000000003", "eligible": false, "points": 1, "minimum_minutes": 0}]'::jsonb);
select public.save_tip_pool_policy_draft('b3000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','weighted_hours',((now() at time zone 'America/New_York')::date-5),null,array['card_tips'],'[{"job_role_id": "40000000-0000-4000-8000-000000000001", "eligible": true, "points": 1, "minimum_minutes": 0}, {"job_role_id": "40000000-0000-4000-8000-000000000002", "eligible": true, "points": 2, "minimum_minutes": 0}, {"job_role_id": "40000000-0000-4000-8000-000000000003", "eligible": false, "points": 1, "minimum_minutes": 0}]'::jsonb);
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select public.approve_tip_policy_version('b3100000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001');
select public.approve_tip_policy_version('b3100000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.tip_pool_policy_versions(id,organization_id,policy_id,version,distribution_method,effective_from,source_rules,created_by) values('b0000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001',3,'points',((now() at time zone 'America/New_York')::date-5),'{"closeout_sources":["card_tips"]}','10000000-0000-4000-8000-000000000001');
insert into public.shift_closeouts(id,organization_id,location_id,business_date,shift_label,gross_sales_cents,net_sales_cents,cash_sales_cents,card_sales_cents,expected_cash_cents,actual_cash_cents,card_tips_cents,submitted_by,notes) values('b2000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-5),'native-tip-vector-1',10000,10000,0,10000,0,0,100,'10000000-0000-4000-8000-000000000004','SYNTHETIC native RLS test only');
insert into public.shift_closeouts(id,organization_id,location_id,business_date,shift_label,gross_sales_cents,net_sales_cents,cash_sales_cents,card_sales_cents,expected_cash_cents,actual_cash_cents,card_tips_cents,submitted_by,notes) values('b2000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-4),'native-tip-vector-2',10000,10000,0,10000,0,0,100,'10000000-0000-4000-8000-000000000004','SYNTHETIC native RLS test only');
insert into public.shift_closeouts(id,organization_id,location_id,business_date,shift_label,gross_sales_cents,net_sales_cents,cash_sales_cents,card_sales_cents,expected_cash_cents,actual_cash_cents,card_tips_cents,submitted_by,notes) values('b2000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-3),'native-tip-vector-3',10000,10000,0,10000,0,0,101,'10000000-0000-4000-8000-000000000004','SYNTHETIC native RLS test only');
insert into public.shift_closeouts(id,organization_id,location_id,business_date,shift_label,gross_sales_cents,net_sales_cents,cash_sales_cents,card_sales_cents,expected_cash_cents,actual_cash_cents,card_tips_cents,submitted_by,notes) values('b2000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-2),'native-tip-vector-4',10000,10000,0,10000,0,0,10,'10000000-0000-4000-8000-000000000004','SYNTHETIC native RLS test only');
insert into public.shift_closeouts(id,organization_id,location_id,business_date,shift_label,gross_sales_cents,net_sales_cents,cash_sales_cents,card_sales_cents,expected_cash_cents,actual_cash_cents,card_tips_cents,submitted_by,notes) values('b2000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-1),'native-tip-vector-5',10000,10000,0,10000,0,0,10,'10000000-0000-4000-8000-000000000004','SYNTHETIC native RLS test only');
insert into public.employee_job_roles(organization_id,employee_id,job_role_id,location_id,effective_from,is_primary) values('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-5),true);
insert into public.employee_job_roles(organization_id,employee_id,job_role_id,location_id,effective_from,is_primary) values('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-5),true);
insert into public.employee_job_roles(organization_id,employee_id,job_role_id,location_id,effective_from,is_primary) values('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-5),false);
insert into public.employee_job_roles(organization_id,employee_id,job_role_id,location_id,effective_from,is_primary) values('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-5),true);
insert into public.employee_job_roles(organization_id,employee_id,job_role_id,location_id,effective_from,is_primary) values('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-5),true);
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',((((now() at time zone 'America/New_York')::date-5)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-5)+time '13:00') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',((((now() at time zone 'America/New_York')::date-5)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-5)+time '13:00') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001',((((now() at time zone 'America/New_York')::date-5)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-5)+time '13:00') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',((((now() at time zone 'America/New_York')::date-4)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-4)+time '13:00') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',((((now() at time zone 'America/New_York')::date-4)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-4)+time '13:00') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',((((now() at time zone 'America/New_York')::date-4)+time '14:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-4)+time '15:00') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001',((((now() at time zone 'America/New_York')::date-4)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-4)+time '13:00') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000008','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000003',((((now() at time zone 'America/New_York')::date-4)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-4)+time '13:40') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',((((now() at time zone 'America/New_York')::date-3)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-3)+time '13:00') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',((((now() at time zone 'America/New_York')::date-3)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-3)+time '13:00') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_entries(id,organization_id,location_id,employee_id,job_role_id,clocked_in_at,clocked_out_at,status,source,approved_by,approved_at,notes) values('c0000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',((((now() at time zone 'America/New_York')::date-2)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-2)+time '13:00') at time zone 'America/New_York'),'corrected','manager','10000000-0000-4000-8000-000000000002',now(),'SYNTHETIC reviewed labor fixture');
insert into public.time_breaks(organization_id,time_entry_id,started_at,ended_at,is_paid,source) values('20000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000007',((((now() at time zone 'America/New_York')::date-4)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-4)+time '13:00') at time zone 'America/New_York'),false,'manager');
insert into public.time_breaks(organization_id,time_entry_id,started_at,ended_at,is_paid,source) values('20000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000011',((((now() at time zone 'America/New_York')::date-2)+time '12:00') at time zone 'America/New_York'),((((now() at time zone 'America/New_York')::date-2)+time '13:00') at time zone 'America/New_York'),false,'manager');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select public.approve_closeout('b2000000-0000-4000-8000-000000000001',true,'Independent synthetic source review');
select public.approve_closeout('b2000000-0000-4000-8000-000000000002',true,'Independent synthetic source review');
select public.approve_closeout('b2000000-0000-4000-8000-000000000003',true,'Independent synthetic source review');
select public.approve_closeout('b2000000-0000-4000-8000-000000000004',true,'Independent synthetic source review');
select public.approve_closeout('b2000000-0000-4000-8000-000000000005',true,'Independent synthetic source review');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select public.prepare_tip_run_from_closeout('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001');
select public.prepare_tip_run_from_closeout('b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002');
select public.prepare_tip_run_from_closeout('b1000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000001');

-- A: equal hours and stable largest-remainder tie-breaking.
select lives_ok($$select public.calculate_tip_run('b1000000-0000-4000-8000-000000000001')$$, '01 hours calculation succeeds');
select is((select status from public.tip_runs where id = 'b1000000-0000-4000-8000-000000000001'), 'calculated'::public.run_status, '02 calculated state is explicit');
select is((select count(*) from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000001'), 3::bigint, '03 every eligible participant gets an allocation row');
select is((select sum(final_amount_cents) from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000001'), 100::numeric, '04 integer cents reconcile to the source');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000001' and employee_id = '50000000-0000-4000-8000-000000000001'), 34::bigint, '05 first stable UUID receives the remainder cent');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000001' and employee_id = '50000000-0000-4000-8000-000000000002'), 33::bigint, '06 second equal-hours participant receives 33 cents');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000001' and employee_id = '50000000-0000-4000-8000-000000000003'), 33::bigint, '07 third equal-hours participant receives 33 cents');
select is((select explanation ->> 'rounding' from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000001' limit 1), 'largest_remainder', '08 explanation names the rounding method');
select is((select weight from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000001' and employee_id = '50000000-0000-4000-8000-000000000001'), 60::numeric, '09 hours method uses worked minutes as weight');
select is((select remainder_rank from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000001' and employee_id = '50000000-0000-4000-8000-000000000001'), 1, '10 deterministic remainder rank is persisted');


-- B: split-role labor is derived; zero net minutes and excluded roles get no money.
select lives_ok($$select public.calculate_tip_run('b1000000-0000-4000-8000-000000000002')$$, '11 weighted-hours calculation succeeds');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000002' and employee_id = '50000000-0000-4000-8000-000000000001'), 20::bigint, '12 sixty minutes at one point receives 20 percent');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000002' and employee_id = '50000000-0000-4000-8000-000000000002'), 80::bigint, '13 aggregate split shifts at two points receive 80 percent');
select is(coalesce((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000002' and employee_id = '50000000-0000-4000-8000-000000000003'),0::bigint), 0::bigint, '14 zero-hour participant receives zero under weighted hours');
select is(coalesce((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000002' and employee_id = '50000000-0000-4000-8000-000000000004'),0::bigint), 0::bigint, '15 excluded participant receives zero');
select is((select cardinality(source_time_entry_ids) from public.tip_run_participants where tip_run_id = 'b1000000-0000-4000-8000-000000000002' and employee_id = '50000000-0000-4000-8000-000000000002'), 2, '16 split-shift source provenance is retained');
select is((select explanation ->> 'method' from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000002' limit 1), 'weighted_hours', '17 explanation identifies weighted hours');
select is((select allocated_cents from public.tip_runs where id = 'b1000000-0000-4000-8000-000000000002'), 100::bigint, '18 weighted run remains balanced');


-- C: direct adjustments require independent, server-stamped approval.
insert into public.tip_adjustments(id,organization_id,tip_run_id,employee_id,amount_cents,reason,created_by) values('b4000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000001',10,'SYNTHETIC approved adjustment fixture','10000000-0000-4000-8000-000000000004');
insert into public.tip_adjustments(id,organization_id,tip_run_id,employee_id,amount_cents,reason,created_by) values('b4000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000002',-5,'SYNTHETIC approved adjustment fixture','10000000-0000-4000-8000-000000000004');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select public.approve_tip_adjustment('b4100000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001');
select public.approve_tip_adjustment('b4100000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$insert into public.tip_sources(organization_id,tip_run_id,source_type,label,amount_cents) values('20000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003','card_tips','Forged source',999)$$,'42501',null,'direct tip-source writes remain denied before approval');
select lives_ok($$select public.calculate_tip_run('b1000000-0000-4000-8000-000000000003')$$, '19 adjusted calculation succeeds');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000003' and employee_id = '50000000-0000-4000-8000-000000000001'), 58::bigint, '20 positive adjustment is applied after a 48-cent base share');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000003' and employee_id = '50000000-0000-4000-8000-000000000002'), 43::bigint, '21 negative adjustment is applied after a 48-cent base share');
select is((select sum(final_amount_cents) from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000003'), 101::numeric, '22 adjusted allocations still reconcile exactly');
select is((select adjustment_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000003' and employee_id = '50000000-0000-4000-8000-000000000001'), 10::bigint, '23 positive adjustment evidence is retained');
select is((select adjustment_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000003' and employee_id = '50000000-0000-4000-8000-000000000002'), (-5)::bigint, '24 negative adjustment evidence is retained');
select throws_ok($$select public.approve_tip_run('b1000000-0000-4000-8000-000000000003')$$,'42501',null,'creator cannot approve their own tip run');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1"}',true);
select lives_ok($$select public.approve_tip_run('b1000000-0000-4000-8000-000000000003')$$,'25 independent reviewer can approve the balanced run');
select is((select status from public.tip_runs where id = 'b1000000-0000-4000-8000-000000000003'), 'approved'::public.run_status, '26 approval changes state and locks the run');
reset role;
select throws_ok(
  $$update public.tip_sources set amount_cents = 102 where tip_run_id = 'b1000000-0000-4000-8000-000000000003'$$,
  '42501', 'Approved tip runs and their inputs are immutable',
  '27 approved source inputs cannot be edited'
);
select throws_ok(
  $$update public.tip_pool_policy_versions set distribution_method = 'points' where id = 'b0000000-0000-4000-8000-000000000001'$$,
  '42501', 'Approved tip policy versions are immutable',
  '28 approved policy versions cannot be edited'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select public.prepare_tip_run_from_closeout('b1000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000004','b0000000-0000-4000-8000-000000000001')$$,'23514','No eligible closed labor entries match this closeout and policy','29 positive pool refuses labor with zero net payable minutes');
select throws_ok($$select public.prepare_tip_run_from_closeout('b1000000-0000-4000-8000-000000000005','b2000000-0000-4000-8000-000000000005','b0000000-0000-4000-8000-000000000003')$$,'23514','Approved policy version does not match the closeout scope or date','30 unapproved policy cannot prepare a tip run');
select is((select count(*) from public.tip_runs where id='b1000000-0000-4000-8000-000000000004'),0::bigint,'failed zero-weight preparation leaves no orphan run');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.tip_runs(id,organization_id,location_id,policy_version_id,business_date,shift_label,created_by) values('b1000000-0000-4000-8000-000000000099','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',((now() at time zone 'America/New_York')::date-1),'SYNTHETIC unprepared counterexample','10000000-0000-4000-8000-000000000004');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select public.calculate_tip_run('b1000000-0000-4000-8000-000000000099')$$,'23514','Tip run inputs were not prepared from authoritative evidence','a hand-built unprepared run cannot bypass source derivation');
reset role;
select * from finish();
rollback;
