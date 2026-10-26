begin;
set local search_path=public,extensions;
select plan(25);
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='private.schedule_assignment_scopes'::regclass),'assignment scope rows force RLS');
select ok(not has_table_privilege('authenticated','private.schedule_assignment_scopes','select,insert,update,delete') and not has_table_privilege('anon','private.schedule_assignment_scopes','select,insert,update,delete'),'browser roles have no private scope-table access');
select ok(not has_function_privilege('authenticated','private.lock_schedule_assignment_scope(uuid)','execute') and not has_function_privilege('service_role','private.assert_shift_assignment_available(uuid,uuid,uuid,timestamptz,timestamptz,boolean)','execute'),'scope/availability helpers remain internal');
-- Synthetic qualifications for the alternate worker and decision actor.
insert into public.employee_job_roles(organization_id,employee_id,job_role_id,location_id,effective_from,effective_to,is_primary)
values('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-10-26','2026-11-02',false),
('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-10-26','2026-11-02',false),
('20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','2026-10-26','2026-11-02',false);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select public.create_schedule_draft('b2000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-10-26',null);
insert into public.shifts(id,organization_id,location_id,schedule_id,employee_id,job_role_id,starts_at,ends_at,break_minutes,status,is_open)values
('b2100000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000001','2026-10-26T16:00Z','2026-10-26T18:00Z',0,'scheduled',false),
('b2100000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001',null,'40000000-0000-4000-8000-000000000001','2026-10-26T17:00Z','2026-10-26T19:00Z',0,'open',true),
('b2100000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000001','2026-10-26T19:00Z','2026-10-26T21:00Z',0,'scheduled',false);
select lives_ok($$select public.publish_schedule('b2000000-0000-4000-8000-000000000001','Native staffing rehearsal')$$,'valid adjacent/nonoverlapping work publishes');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);
select public.request_shift_swap('b2200000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000001',null,'READINESS ONLY — callout');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select public.offer_shift_swap('b2300000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000001','READINESS ONLY — qualified offer');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select public.offer_shift_swap('b2300000-0000-4000-8000-000000000002','b2200000-0000-4000-8000-000000000001','READINESS ONLY — alternate offer');
select is((public.decide_shift_swap('b2400000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000001','b2300000-0000-4000-8000-000000000001',true)).status,'approved'::public.request_status,'one qualified offer is approved');
select is((public.decide_shift_swap('b2400000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000001','b2300000-0000-4000-8000-000000000001',true)).status,'approved'::public.request_status,'exact decision retry remains valid');
select throws_ok($$select public.decide_shift_swap('b2400000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000001','b2300000-0000-4000-8000-000000000002',true)$$,'23505',null,'decision nonce cannot select a different offer');
select throws_ok($$select public.decide_shift_swap('b2400000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000001',null,true)$$,'23505',null,'offer approval nonce cannot change to preferred-person path');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select public.claim_open_shift('b2500000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000002')$$,'PT409',null,'overlapping assigned worker cannot claim open work');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);
select is((public.claim_open_shift('b2500000-0000-4000-8000-000000000002','b2100000-0000-4000-8000-000000000002')).employee_id,'50000000-0000-4000-8000-000000000005'::uuid,'adjacent boundary is allowed for another available qualified worker');
select public.request_shift_swap('b2200000-0000-4000-8000-000000000002','b2100000-0000-4000-8000-000000000002',null,'READINESS ONLY — unavailable replacement');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',true);
select throws_ok($$select public.offer_shift_swap('b2300000-0000-4000-8000-000000000003','b2200000-0000-4000-8000-000000000002','Overlapping offer')$$,'PT409',null,'unavailable worker cannot offer overlapping coverage');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select public.reopen_shift('b2600000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000003');
select public.claim_open_shift('b2500000-0000-4000-8000-000000000003','b2100000-0000-4000-8000-000000000003');
select public.request_shift_swap('b2200000-0000-4000-8000-000000000003','b2100000-0000-4000-8000-000000000003',null,'READINESS ONLY — request replay scope');
reset role;
create temporary table scope_revision_before as select revision from private.schedule_assignment_scopes where organization_id='20000000-0000-4000-8000-000000000001';
update public.organization_memberships set status='suspended' where user_id='10000000-0000-4000-8000-000000000001'and organization_id='20000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*)from public.shifts),0::bigint,'suspended caller loses direct shift visibility');
select throws_ok($$select public.decide_shift_swap('b2400000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000001','b2300000-0000-4000-8000-000000000001',true)$$,'42501',null,'suspension denies exact decision replay');
select throws_ok($$select public.claim_open_shift('b2500000-0000-4000-8000-000000000003','b2100000-0000-4000-8000-000000000003')$$,'42501',null,'suspension denies exact claim replay');
select throws_ok($$select public.reopen_shift('b2600000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000003')$$,'42501',null,'suspension is checked before stale reopen state');
select throws_ok($$select public.request_shift_swap('b2200000-0000-4000-8000-000000000003','b2100000-0000-4000-8000-000000000003',null,'READINESS ONLY — request replay scope')$$,'42501',null,'suspension denies exact request replay');
select throws_ok($$select public.offer_shift_swap('b2300000-0000-4000-8000-000000000002','b2200000-0000-4000-8000-000000000001','READINESS ONLY — alternate offer')$$,'42501',null,'suspension denies exact offer replay');
reset role;
select is((select revision from private.schedule_assignment_scopes where organization_id='20000000-0000-4000-8000-000000000001'),(select revision from scope_revision_before),'unauthorized retries do not write even the scope guard');
update public.organization_memberships set status='active' where user_id='10000000-0000-4000-8000-000000000001'and organization_id='20000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((public.decide_shift_swap('b2400000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000001','b2300000-0000-4000-8000-000000000001',true)).status,'approved'::public.request_status,'restored current access recovers the original retry');
-- A valid next published version replaces its location/week, without
-- considering the superseded version a second simultaneous obligation.
select public.create_schedule_draft('b2000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','2026-10-26',null);
insert into public.shifts(id,organization_id,location_id,schedule_id,employee_id,job_role_id,starts_at,ends_at,break_minutes,status,is_open)values
('b2100000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000001','2026-10-26T17:00Z','2026-10-26T19:00Z',0,'scheduled',false);
select lives_ok($$select public.publish_schedule('b2000000-0000-4000-8000-000000000002','READINESS ONLY — replacement plan')$$,'new published version replaces its own location/week');
select throws_ok($$select public.reopen_shift('b2600000-0000-4000-8000-000000000002','b2100000-0000-4000-8000-000000000001')$$,'PT409',null,'superseded plan refuses fresh assignment changes');
select public.create_schedule_draft('b2000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002','2026-10-26',null);
insert into public.shifts(id,organization_id,location_id,schedule_id,employee_id,job_role_id,starts_at,ends_at,break_minutes,status,is_open)values
('b2100000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000001','2026-10-26T18:00Z','2026-10-26T20:00Z',0,'scheduled',false);
select throws_ok($$select public.publish_schedule('b2000000-0000-4000-8000-000000000003','READINESS ONLY — cross-location conflict')$$,'PT409',null,'publication checks overlapping work at another location');
select is((select status from public.schedules where id='b2000000-0000-4000-8000-000000000003'),'draft'::public.schedule_status,'refused publication remains a draft');
select public.create_schedule_draft('b2000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','2026-11-02',null);
insert into public.shifts(id,organization_id,location_id,schedule_id,employee_id,job_role_id,starts_at,ends_at,break_minutes,status,is_open)values
('b2100000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000001','2026-11-02T16:00Z','2026-11-02T18:00Z',0,'scheduled',false),
('b2100000-0000-4000-8000-000000000007','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004','50000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-000000000001','2026-11-02T17:00Z','2026-11-02T19:00Z',0,'scheduled',false);
select throws_ok($$select public.publish_schedule('b2000000-0000-4000-8000-000000000004','READINESS ONLY — draft overlap')$$,'PT409',null,'publication refuses duplicate overlapping assignments inside one draft');
reset role;
select is((select count(*)from private.shift_transition_requests where request_id='b2500000-0000-4000-8000-000000000001'),0::bigint,'refused overlap leaves no claim receipt');
select * from finish();rollback;
