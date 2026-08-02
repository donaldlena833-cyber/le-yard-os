begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

insert into public.tip_pool_policy_versions (
  id, organization_id, policy_id, version, distribution_method, effective_from,
  approved_by, approved_at, created_by
)
values
  ('b0000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 1, 'hours', date '2026-01-01', '10000000-0000-4000-8000-000000000001', now(), '10000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 2, 'weighted_hours', date '2026-01-01', '10000000-0000-4000-8000-000000000001', now(), '10000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 3, 'points', date '2026-01-01', null, null, '10000000-0000-4000-8000-000000000001');

-- Scenario group A: equal hours and largest-remainder tie-breaking.
insert into public.tip_runs (id, organization_id, location_id, policy_version_id, business_date, shift_label, created_by)
values ('b1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', date '2026-08-01', 'unit-hours', '10000000-0000-4000-8000-000000000004');
insert into public.tip_sources (organization_id, tip_run_id, source_type, label, amount_cents)
values ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'card_tips', 'Card', 100);
insert into public.tip_run_participants (organization_id, tip_run_id, employee_id, job_role_id, worked_minutes)
values
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 60),
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 60),
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 60);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);

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

reset role;

-- Scenario group B: weighted hours, aggregate split-shift provenance, exclusions, and zero hours.
insert into public.tip_runs (id, organization_id, location_id, policy_version_id, business_date, shift_label, created_by)
values ('b1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', date '2026-08-02', 'unit-weighted', '10000000-0000-4000-8000-000000000004');
insert into public.tip_sources (organization_id, tip_run_id, source_type, label, amount_cents)
values ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'card_tips', 'Card', 100);
insert into public.tip_run_participants (organization_id, tip_run_id, employee_id, job_role_id, worked_minutes, points, eligible, exclusion_reason, source_time_entry_ids)
values
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 60, 1, true, null, array['c0000000-0000-4000-8000-000000000001'::uuid]),
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 120, 2, true, null, array['c0000000-0000-4000-8000-000000000002'::uuid, 'c0000000-0000-4000-8000-000000000003'::uuid]),
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 0, 10, true, null, '{}'),
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', 100, 5, false, 'Not eligible for this pool', '{}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);

select lives_ok($$select public.calculate_tip_run('b1000000-0000-4000-8000-000000000002')$$, '11 weighted-hours calculation succeeds');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000002' and employee_id = '50000000-0000-4000-8000-000000000001'), 20::bigint, '12 sixty minutes at one point receives 20 percent');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000002' and employee_id = '50000000-0000-4000-8000-000000000002'), 80::bigint, '13 aggregate split shifts at two points receive 80 percent');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000002' and employee_id = '50000000-0000-4000-8000-000000000003'), 0::bigint, '14 zero-hour participant receives zero under weighted hours');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000002' and employee_id = '50000000-0000-4000-8000-000000000004'), 0::bigint, '15 excluded participant receives zero');
select is((select cardinality(source_time_entry_ids) from public.tip_run_participants where tip_run_id = 'b1000000-0000-4000-8000-000000000002' and employee_id = '50000000-0000-4000-8000-000000000002'), 2, '16 split-shift source provenance is retained');
select is((select explanation ->> 'method' from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000002' limit 1), 'weighted_hours', '17 explanation identifies weighted hours');
select is((select allocated_cents from public.tip_runs where id = 'b1000000-0000-4000-8000-000000000002'), 100::bigint, '18 weighted run remains balanced');

reset role;

-- Scenario group C: approved positive/negative direct adjustments and locking.
insert into public.tip_runs (id, organization_id, location_id, policy_version_id, business_date, shift_label, created_by)
values ('b1000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', date '2026-08-03', 'unit-adjustments', '10000000-0000-4000-8000-000000000004');
insert into public.tip_sources (organization_id, tip_run_id, source_type, label, amount_cents)
values ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', 'card_tips', 'Card', 101);
insert into public.tip_run_participants (organization_id, tip_run_id, employee_id, job_role_id, worked_minutes)
values
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 60),
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 60);
insert into public.tip_adjustments (organization_id, tip_run_id, employee_id, amount_cents, reason, created_by, approved_by, approved_at)
values
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000001', 10, 'Approved direct addition', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', now()),
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000002', -5, 'Approved direct deduction', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);

select lives_ok($$select public.calculate_tip_run('b1000000-0000-4000-8000-000000000003')$$, '19 adjusted calculation succeeds');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000003' and employee_id = '50000000-0000-4000-8000-000000000001'), 58::bigint, '20 positive adjustment is applied after a 48-cent base share');
select is((select final_amount_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000003' and employee_id = '50000000-0000-4000-8000-000000000002'), 43::bigint, '21 negative adjustment is applied after a 48-cent base share');
select is((select sum(final_amount_cents) from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000003'), 101::numeric, '22 adjusted allocations still reconcile exactly');
select is((select adjustment_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000003' and employee_id = '50000000-0000-4000-8000-000000000001'), 10::bigint, '23 positive adjustment evidence is retained');
select is((select adjustment_cents from public.tip_allocations where tip_run_id = 'b1000000-0000-4000-8000-000000000003' and employee_id = '50000000-0000-4000-8000-000000000002'), (-5)::bigint, '24 negative adjustment evidence is retained');
select lives_ok($$select public.approve_tip_run('b1000000-0000-4000-8000-000000000003')$$, '25 balanced run can be human-approved');
select is((select status from public.tip_runs where id = 'b1000000-0000-4000-8000-000000000003'), 'approved'::public.run_status, '26 approval changes state and locks the run');
select throws_ok(
  $$update public.tip_sources set amount_cents = 102 where tip_run_id = 'b1000000-0000-4000-8000-000000000003'$$,
  '42501', 'Approved tip runs and their inputs are immutable',
  '27 approved source inputs cannot be edited'
);
select throws_ok(
  $$update public.tip_pool_policy_versions set distribution_method = 'points' where id = 'b0000000-0000-4000-8000-000000000001'$$,
  '42501', 'tip_pool_policy_versions is approved and immutable',
  '28 approved policy versions cannot be edited'
);

reset role;

insert into public.tip_runs (id, organization_id, location_id, policy_version_id, business_date, shift_label, created_by)
values
  ('b1000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', date '2026-08-04', 'unit-zero', '10000000-0000-4000-8000-000000000004'),
  ('b1000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', date '2026-08-05', 'unit-unapproved', '10000000-0000-4000-8000-000000000004');
insert into public.tip_sources (organization_id, tip_run_id, source_type, label, amount_cents)
values
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000004', 'card_tips', 'Card', 10),
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000005', 'card_tips', 'Card', 10);
insert into public.tip_run_participants (organization_id, tip_run_id, employee_id, job_role_id, worked_minutes, points)
values
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 0, 1),
  ('20000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 60, 1);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);

select throws_ok(
  $$select public.calculate_tip_run('b1000000-0000-4000-8000-000000000004')$$,
  '23514', 'A positive pool requires at least one eligible participant with non-zero weight',
  '29 zero total weight is rejected for a positive pool'
);
select throws_ok(
  $$select public.calculate_tip_run('b1000000-0000-4000-8000-000000000005')$$,
  '23514', 'Tip calculations require an approved policy version',
  '30 unapproved policy versions cannot calculate tips'
);

reset role;
select * from finish();
rollback;
