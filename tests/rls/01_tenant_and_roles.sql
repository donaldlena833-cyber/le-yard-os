begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}', true);

select is((select count(*) from public.organizations), 1::bigint, 'employee sees only their tenant');
select is((select count(*) from public.locations), 1::bigint, 'employee sees only their assigned location');
select is((select count(*) from public.schedules), 1::bigint, 'employee cannot read another location schedule');
select is((select count(*) from public.shifts), 1::bigint, 'employee cannot read another location or tenant shift');
select is((select count(*) from public.chat_channels), 2::bigint, 'employee sees all-staff and assigned-location chat, not management chat');
select is((select count(*) from public.guests), 0::bigint, 'employee cannot browse CRM PII');
select is((select count(*) from public.receipts), 0::bigint, 'employee cannot browse financial documents');
select is((select count(*) from public.employees), 1::bigint, 'employee can read only their sensitive employee record');
select lives_ok(
  $$insert into public.shift_acknowledgements (organization_id, shift_id, employee_id)
    values ('20000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005')$$,
  'employee may acknowledge their own assigned shift'
);
select throws_ok(
  $$insert into public.organization_memberships (organization_id, user_id, role, status, joined_at)
    values ('20000000-0000-4000-8000-000000000001', gen_random_uuid(), 'employee', 'active', now())$$,
  '42501', 'new row violates row-level security policy for table "organization_memberships"',
  'employee cannot create users or memberships'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);

select is((select count(*) from public.locations), 1::bigint, 'manager sees only their assigned location');
select is((select count(*) from public.schedules), 1::bigint, 'manager schedule access is location-scoped');
select is((select count(*) from public.employees), 5::bigint, 'manager cannot read an employee based only at another location');
select is((select count(*) from public.guests), 1::bigint, 'manager can use the tenant-wide unified CRM');
select lives_ok(
  $$update public.organization_memberships set role = 'manager'
    where organization_id = '20000000-0000-4000-8000-000000000001'
      and user_id = '10000000-0000-4000-8000-000000000005'$$,
  'manager role-assignment attempt is safely filtered'
);
select is(
  (select role from public.organization_memberships
    where organization_id = '20000000-0000-4000-8000-000000000001'
      and user_id = '10000000-0000-4000-8000-000000000005'),
  'employee'::public.app_role,
  'manager cannot assign account roles'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}', true);

select is((select count(*) from public.locations), 2::bigint, 'admin has access to every tenant location');
select is((select count(*) from public.employees), 6::bigint, 'admin can read employees across all tenant locations');
select lives_ok(
  $$update public.organization_memberships set updated_at = now()
    where organization_id = '20000000-0000-4000-8000-000000000001'
      and user_id = '10000000-0000-4000-8000-000000000005'$$,
  'admin can administer users'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);

select is((select count(*) from public.locations), 2::bigint, 'owner may read all locations at AAL1');
select lives_ok(
  $$update public.organizations set name = 'AAL1 mutation should fail'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'owner AAL1 mutation attempt is safely filtered'
);
select is(
  (select name from public.organizations where id = '20000000-0000-4000-8000-000000000001'),
  'Le Yard Demo',
  'owner administrative mutation is blocked until AAL2'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$update public.organizations set updated_at = now()
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'owner administrative mutation succeeds at AAL2'
);
select is((select count(*) from public.audit_events where organization_id = '20000000-0000-4000-8000-000000000001' and actor_id = '10000000-0000-4000-8000-000000000001'), 1::bigint, 'successful owner mutation is audited');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}', true);

select is((select count(*) from public.organizations where id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'other tenant owner cannot read Le Yard');
select is((select count(*) from public.shifts where organization_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'other tenant owner cannot read Le Yard shifts');
select is((select count(*) from public.guests where organization_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'other tenant owner cannot read Le Yard guests');

reset role;
select * from finish();
rollback;
