-- Local/demo data only. All identities use the reserved example.invalid domain.
-- Passwords are intentionally shared demo credentials and must never be copied to production.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'donald.owner@example.invalid', extensions.crypt('DemoOnly-change-me!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Donald Demo"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'maris.owner@example.invalid', extensions.crypt('DemoOnly-change-me!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Maris Demo"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'alex.admin@example.invalid', extensions.crypt('DemoOnly-change-me!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Alex Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'morgan.manager@example.invalid', extensions.crypt('DemoOnly-change-me!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Morgan Manager"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'riley.employee@example.invalid', extensions.crypt('DemoOnly-change-me!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Riley Employee"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'casey.other@example.invalid', extensions.crypt('DemoOnly-change-me!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Casey Other Tenant"}', now(), now())
on conflict (id) do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.id in (
  '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000006'
)
on conflict (provider_id, provider) do nothing;

insert into public.profiles (id, display_name)
values
  ('10000000-0000-4000-8000-000000000001', 'Donald Demo'),
  ('10000000-0000-4000-8000-000000000002', 'Maris Demo'),
  ('10000000-0000-4000-8000-000000000003', 'Alex Admin'),
  ('10000000-0000-4000-8000-000000000004', 'Morgan Manager'),
  ('10000000-0000-4000-8000-000000000005', 'Riley Employee'),
  ('10000000-0000-4000-8000-000000000006', 'Casey Other Tenant')
on conflict (id) do update set display_name = excluded.display_name;

insert into public.organizations (id, name, slug, timezone)
values
  ('20000000-0000-4000-8000-000000000001', 'Le Yard Demo', 'le-yard-demo', 'America/New_York'),
  ('20000000-0000-4000-8000-000000000002', 'Other Restaurant Demo', 'other-restaurant-demo', 'America/Chicago')
on conflict (id) do nothing;

insert into public.locations (id, organization_id, name, code, timezone, address)
values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Le Yard Downtown', 'DWTN', 'America/New_York', '{"city":"New York","region":"NY"}'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Le Yard Uptown', 'UPTN', 'America/New_York', '{"city":"New York","region":"NY"}'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'Other Restaurant', 'OTHER', 'America/Chicago', '{"city":"Chicago","region":"IL"}')
on conflict (id) do nothing;

insert into public.organization_memberships (id, organization_id, user_id, role, status, joined_at)
values
  ('21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('21000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'owner', 'active', now()),
  ('21000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'admin', 'active', now()),
  ('21000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'manager', 'active', now()),
  ('21000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'employee', 'active', now()),
  ('21000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006', 'owner', 'active', now())
on conflict (organization_id, user_id) do nothing;

insert into public.location_memberships (id, organization_id, location_id, user_id, is_primary)
values
  ('31000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', true),
  ('31000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', true)
on conflict (location_id, user_id) do nothing;

insert into public.organization_settings (organization_id, week_starts_on, default_location_id)
values ('20000000-0000-4000-8000-000000000001', 1, '30000000-0000-4000-8000-000000000001')
on conflict (organization_id) do nothing;

insert into public.job_roles (id, organization_id, name, code, department, default_tip_points, is_tipped)
values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Server', 'SERVER', 'Front of house', 1, true),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Bartender', 'BAR', 'Front of house', 1.25, true),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Cook', 'COOK', 'Back of house', 0.75, true),
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 'Other Server', 'SERVER', 'Front of house', 1, true)
on conflict (id) do nothing;

insert into public.employees (id, organization_id, user_id, home_location_id, employee_number, display_name, email, employment_status)
values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'D001', 'Donald Demo', 'donald.owner@example.invalid', 'active'),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'D002', 'Maris Demo', 'maris.owner@example.invalid', 'active'),
  ('50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000001', 'D003', 'Alex Admin', 'alex.admin@example.invalid', 'active'),
  ('50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', 'D004', 'Morgan Manager', 'morgan.manager@example.invalid', 'active'),
  ('50000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', 'D005', 'Riley Employee', 'riley.employee@example.invalid', 'active'),
  ('50000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000003', 'O001', 'Casey Other Tenant', 'casey.other@example.invalid', 'active'),
  ('50000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001', null, '30000000-0000-4000-8000-000000000002', 'U001', 'Uptown Demo Employee', 'uptown.employee@example.invalid', 'active')
on conflict (id) do nothing;

insert into public.employee_job_roles (id, organization_id, employee_id, job_role_id, location_id, effective_from, is_primary)
values
  ('51000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', date '2026-01-01', true),
  ('51000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', date '2026-01-01', true)
on conflict (id) do nothing;

insert into public.schedules (id, organization_id, location_id, week_start, status, version, created_by, published_by, published_at)
values
  ('60000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', date '2026-07-27', 'published', 1, '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', now()),
  ('60000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', date '2026-07-27', 'published', 1, '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', now()),
  ('60000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', date '2026-07-27', 'published', 1, '10000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', now())
on conflict (id) do nothing;

insert into public.shifts (id, organization_id, location_id, schedule_id, employee_id, job_role_id, starts_at, ends_at, status, is_open)
values
  ('61000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000001', '2026-08-01 16:00:00-04', '2026-08-01 23:00:00-04', 'scheduled', false),
  ('61000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', null, '40000000-0000-4000-8000-000000000002', '2026-08-01 16:00:00-04', '2026-08-01 23:00:00-04', 'open', true),
  ('61000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '60000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000004', '2026-08-01 16:00:00-05', '2026-08-01 23:00:00-05', 'scheduled', false)
on conflict (id) do nothing;

insert into public.chat_channels (id, organization_id, location_id, kind, name, created_by)
values
  ('62000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', null, 'all_staff', 'All Staff', '10000000-0000-4000-8000-000000000001'),
  ('62000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'location', 'Downtown', '10000000-0000-4000-8000-000000000001'),
  ('62000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', null, 'management', 'Management', '10000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.chat_messages (id, organization_id, channel_id, author_id, body, is_announcement)
values ('63000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'Welcome to the safe local demo workspace.', true)
on conflict (id) do nothing;

insert into public.measurement_units (id, organization_id, name, symbol, dimension, is_base)
values
  ('70000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Each', 'ea', 'count', true),
  ('70000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Pound', 'lb', 'mass', true)
on conflict (id) do nothing;

insert into public.inventory_categories (id, organization_id, name)
values ('71000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Produce')
on conflict (id) do nothing;

insert into public.inventory_items (id, organization_id, category_id, base_unit_id, name, sku)
values ('72000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000002', 'Demo Tomatoes', 'DEMO-TOMATO')
on conflict (id) do nothing;

insert into public.vendors (id, organization_id, name, email)
values ('73000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Demo Produce Co.', 'orders@vendor.example.invalid')
on conflict (id) do nothing;

insert into public.inventory_par_levels (id, organization_id, location_id, inventory_item_id, par_quantity)
values ('74000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 25)
on conflict (id) do nothing;

insert into public.guests (id, organization_id, display_name, email, preferences, allergies, vip)
values ('80000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Jamie Demo Guest', 'jamie.guest@example.invalid', 'Corner table', 'Tree nuts', true)
on conflict (id) do nothing;

insert into public.tasks (id, organization_id, location_id, title, description, assigned_employee_id, created_by, due_at)
values ('81000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Review produce delivery', 'Safe demo task', '50000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000004', now() + interval '1 day')
on conflict (id) do nothing;

insert into public.tip_pool_policies (id, organization_id, location_id, name, description, created_by)
values ('90000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Unconfigured Demo Pool', 'Illustrative only; owners must approve real policy rules.', '10000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

-- Deliberately no labor-law, break, overtime, tip, payroll, or retention policy defaults.
