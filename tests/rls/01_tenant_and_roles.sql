begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

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
  '42501', null,
  'employee cannot create users or memberships'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}', true);

select is((select count(*) from public.locations), 1::bigint, 'manager sees only their assigned location');
select is((select count(*) from public.schedules), 1::bigint, 'manager schedule access is location-scoped');
select is((select count(*) from public.employees), 5::bigint, 'manager cannot read an employee based only at another location');
select is((select count(*) from public.guests), 0::bigint, 'a Manager title alone does not grant CRM access');

-- Positive capability fixture, with an independently linked other-location guest.
reset role;
insert into public.user_capability_overrides (organization_id,user_id,capability_key,location_id,effect,reason,effective_from,created_by,updated_by)
values ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','guest.manage','30000000-0000-4000-8000-000000000001','grant','Native RLS fixture',current_date-1,'10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
insert into public.guests(id,organization_id,display_name)
values ('80000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Other-location RLS fixture');
insert into public.guest_locations(organization_id,guest_id,location_id) values
 ('20000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*) from public.guests where id='80000000-0000-4000-8000-000000000001'),1::bigint,'explicit guest capability permits the linked location guest');
select is((select count(*) from public.guests where id='80000000-0000-4000-8000-000000000002'),0::bigint,'that capability cannot read a guest linked only to another location');
select throws_ok(
  $$update public.organization_memberships set role = 'manager'
    where organization_id = '20000000-0000-4000-8000-000000000001'
      and user_id = '10000000-0000-4000-8000-000000000005'$$,
  '42501', null,
  'manager cannot assign roles through direct table writes'
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
  $$select public.administer_organization_member(
    'ad000000-0000-4000-8000-000000000001',
    (select id from public.organization_memberships where organization_id='20000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000005'),
    'manager','active',array['30000000-0000-4000-8000-000000000001'::uuid],'30000000-0000-4000-8000-000000000001')$$,
  'Admin can administer another employee through the scoped command'
);
select is((select role from public.organization_memberships where organization_id='20000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000005'),'manager'::public.app_role,'Admin command changes the intended account role');
select throws_ok(
  $$select public.administer_organization_member(
    'ad000000-0000-4000-8000-000000000002',
    (select id from public.organization_memberships where organization_id='20000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000005'),
    'owner','active',array['30000000-0000-4000-8000-000000000001'::uuid],'30000000-0000-4000-8000-000000000001')$$,
  '42501',null,'Admin cannot promote another account to Owner'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}', true);

select is((select count(*) from public.locations), 2::bigint, 'owner may read all locations at AAL1');
select lives_ok(
  $$update public.organizations set name = 'AAL1 owner mutation accepted'
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'password-only Owner may perform the authorized administrative mutation'
);
select is(
  (select name from public.organizations where id = '20000000-0000-4000-8000-000000000001'),
  'AAL1 owner mutation accepted',
  'current password-only policy permits the Owner mutation at AAL1'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$update public.organizations set updated_at = now()
    where id = '20000000-0000-4000-8000-000000000001'$$,
  'owner administrative mutation succeeds at AAL2'
);
select is((select count(*) from public.audit_events where organization_id = '20000000-0000-4000-8000-000000000001' and actor_id = '10000000-0000-4000-8000-000000000001'), 2::bigint, 'both authorized Owner mutations are audited');

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
