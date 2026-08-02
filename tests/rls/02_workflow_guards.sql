begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);

select throws_ok(
  $$select public.record_clock_in(
      'a0000000-0000-4000-8000-000000000099',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      null
    )$$,
  '23514', null,
  'employee cannot clock into an unassigned job role'
);
select lives_ok(
  $$select public.record_clock_in(
      'a0000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      null
    )$$,
  'employee can clock into their own assigned location and role'
);
select lives_ok(
  $$insert into public.time_entry_corrections (
      id, organization_id, location_id, time_entry_id, requested_by, proposed_clocked_in_at, reason
    ) values (
      'a1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000005', '2026-08-01 09:55:00-04', 'Missed exact clock-in'
    )$$,
  'employee may request a correction to their own punch'
);
select throws_ok(
  $$update public.time_entry_corrections set status = 'approved', decided_by = '10000000-0000-4000-8000-000000000005', decided_at = now()
    where id = 'a1000000-0000-4000-8000-000000000001'$$,
  '42501', 'new row violates row-level security policy for table "time_entry_corrections"',
  'employee cannot approve their own punch correction'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);

select lives_ok(
  $$select public.apply_time_entry_correction('a1000000-0000-4000-8000-000000000001', true, 'Manager verified')$$,
  'assigned manager can approve and apply a punch correction'
);
select is((select status from public.time_entries where id = 'a0000000-0000-4000-8000-000000000001'), 'open'::public.time_entry_status, 'clock-in correction keeps an active time entry open');

reset role;
select is((select count(*) from public.audit_events where record_id = 'a0000000-0000-4000-8000-000000000001'), 2::bigint, 'time entry creation and correction are both audited');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);
select lives_ok(
  $$update public.inventory_transactions set quantity_delta = 99 where id = gen_random_uuid()$$,
  'empty ledger updates are harmless'
);

reset role;
select throws_ok(
  $$update public.audit_events set action = 'tampered' where id = (select min(id) from public.audit_events)$$,
  '42501', 'audit_events is append-only',
  'audit records cannot be altered even by a table owner'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);
select is((select count(*) from public.tip_allocations), 0::bigint, 'employee sees no other employees tip allocations');

reset role;
select * from finish();
rollback;
