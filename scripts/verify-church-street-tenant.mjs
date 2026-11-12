import assert from "node:assert/strict";

const ownerId = "10000000-0000-4000-8000-000000000001";
const restaurantEmployeeId = "10000000-0000-4000-8000-000000000005";
const churchEmployeeId = "10000000-0000-4000-8000-000000000011";
const restaurantId = "20000000-0000-4000-8000-000000000001";
const restaurantLocationId = "30000000-0000-4000-8000-000000000001";

async function expectDenial(db, sql, code, label) {
  let result;
  try {
    await db.exec(sql);
  } catch (error) {
    result = error;
  }
  assert.equal(result?.code, code, label);
  return result;
}

async function claims(db, userId, role = "authenticated") {
  const token = JSON.stringify({ sub: userId, role, aal: "aal1" });
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claims', '${token}', false);`);
}

export async function verifyChurchStreetTenant(db) {
  const roster = [
    { user_id: ownerId, role: "owner" },
    { user_id: churchEmployeeId, role: "employee", job_code: "PREP" },
  ];
  const provision = (members = roster) => `select public.service_provision_church_street('${JSON.stringify(members)}') as result`;
  const get = async (sql) => (await db.query(sql)).rows[0];
  // The verifier owns a disposable database and runs each request in its own
  // transaction, matching Supabase's RPC connection behavior.
  await db.exec("reset role; select set_config('request.jwt.claims', '{}', false);");
  try {
    await db.exec(`
      insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
      values ('${churchEmployeeId}', 'church.staff@example.invalid', now(), '{"display_name":"Church Staff"}');
    `);

    assert.deepEqual(await get(`
      select
        has_function_privilege('authenticated', 'public.service_provision_church_street(jsonb)', 'EXECUTE') as staff_provision,
        has_function_privilege('anon', 'public.service_provision_church_street(jsonb)', 'EXECUTE') as anonymous_provision,
        has_function_privilege('service_role', 'public.service_provision_church_street(jsonb)', 'EXECUTE') as service_provision,
        has_function_privilege('authenticated', 'public.service_set_church_street_active(uuid, boolean)', 'EXECUTE') as staff_activate,
        has_function_privilege('service_role', 'public.service_set_church_street_active(uuid, boolean)', 'EXECUTE') as service_activate
    `), { staff_provision: false, anonymous_provision: false, service_provision: true, staff_activate: false, service_activate: true });
    await claims(db, undefined, "service_role");
    await expectDenial(db, provision([{ ...roster[0], user_id: "10000000-0000-4000-8000-000000000012" }]), "22023",
      "unknown owner account rejects provisioning atomically");
    const { result: created } = await get(provision());
    assert.equal(created.created, true);
    const churchId = created.organization_id;
    const churchLocationId = created.location_id;
    assert.notEqual(churchId, restaurantId);
    assert.notEqual(churchLocationId, restaurantLocationId);

    const { result: retry } = await get(provision([...roster].reverse()));
    assert.deepEqual(retry, { ...created, created: false });
    await expectDenial(db, provision([roster[0]]), "23505", "a retry cannot change the reviewed roster");
    await expectDenial(db, `select public.service_set_church_street_active('${restaurantId}', false)`, "22023",
      "lifecycle action cannot target the restaurant");

    await db.exec("reset role");
    const initial = await get(`
      select organization.status, location.is_active, settings.feature_flags,
        (select count(*)::int from public.organization_memberships where organization_id = organization.id) as members,
        (select count(*)::int from public.job_roles where organization_id = organization.id) as jobs,
        (select count(*)::int from public.chat_channels where organization_id = organization.id) as channels,
        (select count(*)::int from public.user_invitations where organization_id = organization.id) as invitations,
        (select count(*)::int from public.reservation_settings where organization_id = organization.id) as reservations,
        (select count(*)::int from public.integration_connections where organization_id = organization.id) as connections
      from public.organizations organization
      join public.organization_settings settings on settings.organization_id = organization.id
      join public.locations location on location.id = settings.default_location_id
      where organization.id = '${churchId}'
    `);
    assert.deepEqual(initial, {
      status: "suspended", is_active: false, feature_flags: { service_model: "counter" },
      members: 2, jobs: 4, channels: 2, invitations: 0, reservations: 0, connections: 0,
    });
    await claims(db, ownerId);
    assert.deepEqual(await get(`
      select public.can_access_org('${churchId}') as church,
        public.can_access_org('${restaurantId}') as restaurant
    `), { church: false, restaurant: true });

    await claims(db, undefined, "service_role");
    const activation = `select public.service_set_church_street_active('${churchId}', true) as result`;
    assert.equal((await get(activation)).result.status, "active");
    assert.equal((await get(activation)).result.status, "active");
    await claims(db, ownerId);
    assert.deepEqual(await get(`
      select public.can_access_org('${churchId}') as church,
        public.can_access_org('${restaurantId}') as restaurant,
        public.has_capability('${churchId}', '${churchLocationId}', 'prep.manage') as church_prep,
        public.has_capability('${churchId}', '${churchLocationId}', 'reservations.configure') as church_reservations,
        public.has_capability('${churchId}', '${churchLocationId}', 'guest.manage') as church_guests,
        public.has_capability('${churchId}', '${churchLocationId}', 'tip.calculate') as church_tips,
        public.has_capability('${churchId}', '${churchLocationId}', 'integrations.manage') as church_integrations,
        public.has_capability('${restaurantId}', '${restaurantLocationId}', 'reservations.configure') as restaurant_reservations
    `), {
      church: true, restaurant: true, church_prep: true, church_reservations: false,
      church_guests: false, church_tips: false, church_integrations: false, restaurant_reservations: true,
    });
    await expectDenial(db, `
      update public.organization_settings set feature_flags = '{}' where organization_id = '${churchId}'
    `, "42501", "workspace owner cannot erase the service model");
    await expectDenial(db, `
      update public.organizations set status = 'suspended' where id = '${churchId}'
    `, "42501", "workspace owner cannot bypass audited activation command");
    await expectDenial(db, `
      update public.locations set code = 'ANOTHER' where id = '${churchLocationId}'
    `, "42501", "workspace owner cannot change the provisioned location key");
    const { accessible_rows: activeCounterSettings } = await get(`
      select count(*)::int as accessible_rows from public.reservation_settings where organization_id = '${churchId}'
    `);
    assert.equal(activeCounterSettings, 0);
    await expectDenial(db, `
      select public.configure_reservation_location(gen_random_uuid(), '${churchLocationId}', 'settings.save', '{}')
    `, "42501", "reservation RPC respects the service model for owners");
    await expectDenial(db, `
      insert into public.reservation_settings (organization_id, location_id)
      values ('${churchId}', '${churchLocationId}')
    `, "42501", "authenticated reservation table writes respect the service model");
    const task = await get(`
      select (public.create_task(gen_random_uuid(), '${churchLocationId}', 'Open counter', 'Prepare the counter', 'normal')).organization_id as organization_id
    `);
    assert.equal(task.organization_id, churchId);

    await db.exec("reset role");
    await expectDenial(db, `
      insert into public.booking_api_clients (organization_id, location_id)
      values ('${churchId}', '${churchLocationId}')
    `, "42501", "the privileged booking writer cannot add Church Street");
    await expectDenial(db, `
      insert into public.reservation_message_outbox (organization_id, location_id)
      values ('${churchId}', '${churchLocationId}')
    `, "42501", "the privileged worker cannot queue Church Street reservation messages");

    await claims(db, restaurantEmployeeId);
    assert.deepEqual(await get(`
      select public.can_access_location('${churchId}', '${churchLocationId}') as church,
        public.can_access_location('${restaurantId}', '${restaurantLocationId}') as restaurant
    `), { church: false, restaurant: true });
    await claims(db, churchEmployeeId);
    assert.deepEqual(await get(`
      select public.can_access_location('${churchId}', '${churchLocationId}') as church,
        public.can_access_location('${restaurantId}', '${restaurantLocationId}') as restaurant,
        public.has_capability('${churchId}', '${churchLocationId}', 'prep.complete') as prep,
        public.has_capability('${churchId}', '${churchLocationId}', 'prep.manage') as manages_prep
    `), { church: true, restaurant: false, prep: true, manages_prep: false });

    await claims(db, undefined, "service_role");
    assert.equal((await get(`select public.service_set_church_street_active('${churchId}', false) as result`)).result.status, "suspended");
    await claims(db, ownerId);
    assert.deepEqual(await get(`
      select public.can_access_org('${churchId}') as church,
        public.can_access_org('${restaurantId}') as restaurant,
        (select count(*)::int from public.tasks where organization_id = '${churchId}') as church_tasks
    `), { church: false, restaurant: true, church_tasks: 0 });
    await db.exec("reset role");
    assert.deepEqual(await get(`
      select
        (select count(*)::int from public.tasks where organization_id = '${churchId}') as retained_tasks,
        (select count(*)::int from public.audit_events where organization_id = '${churchId}' and action = 'church_street.status') as status_events
    `), { retained_tasks: 1, status_events: 2 });
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claims', '{}', false);").catch(() => {});
  }
  process.stdout.write("PASS Church Street provisioning, tenant and role isolation, module guards, and lifecycle\n");
}
