import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXPECTED_PROJECT_REF = "qcmwqnonxabdsntfsuzy";
const INTERNAL_EMAIL_SUFFIX = "@le-yard.local";
const KITCHEN_CREW_CAPABILITIES = [
  "inventory.count.create",
  "inventory.waste.create",
  "prep.complete",
];

const existingStaff = [
  {
    email: "mateo@le-yard.local",
    displayName: "Mateo",
    employeeNumber: "LY-004",
    jobRoleCode: "CHEF",
    appRole: "manager",
  },
  {
    email: "server1@le-yard.local",
    displayName: "Server 1",
    employeeNumber: "LY-003",
    jobRoleCode: "SERVER",
    appRole: "employee",
  },
];

const newStaff = [
  ...Array.from({ length: 5 }, (_, index) => ({
    email: `boh${index + 1}@le-yard.local`,
    displayName: `Kitchen Crew ${index + 1}`,
    employeeNumber: `LY-${String(index + 5).padStart(3, "0")}`,
    jobRoleCode: "BOH_CREW",
  })),
  ...Array.from({ length: 3 }, (_, index) => ({
    email: `server${index + 2}@le-yard.local`,
    displayName: `Server ${index + 2}`,
    employeeNumber: `LY-${String(index + 10).padStart(3, "0")}`,
    jobRoleCode: "SERVER",
  })),
  {
    email: "bartender@le-yard.local",
    displayName: "Bartender",
    employeeNumber: "LY-013",
    jobRoleCode: "BARTENDER",
  },
  {
    email: "runner@le-yard.local",
    displayName: "Busser / Runner",
    employeeNumber: "LY-014",
    jobRoleCode: "SUPPORT",
  },
];

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function stableUuid(label) {
  const bytes = createHash("sha256")
    .update(`le-yard-opening-staff\u001f${label}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assertSuccess(error, message) {
  if (error) throw new Error(`${message}: ${error.message}`);
}

async function listAllAuthUsers(admin) {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    assertSuccess(error, "Could not inspect Auth users");
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
  throw new Error("Auth user inspection exceeded the safe pagination bound.");
}

async function removeCreatedUsers(admin, userIds) {
  if (!userIds.length) return;
  const { data: employees } = await admin
    .from("employees")
    .select("id")
    .eq("organization_id", ORGANIZATION_ID)
    .in("user_id", userIds);
  const employeeIds = (employees ?? []).map((employee) => employee.id);
  if (employeeIds.length) {
    await admin.from("employee_job_roles").delete().in("employee_id", employeeIds);
    await admin.from("employees").delete().in("id", employeeIds);
  }
  await admin
    .from("location_memberships")
    .delete()
    .eq("organization_id", ORGANIZATION_ID)
    .in("user_id", userIds);
  await admin
    .from("organization_memberships")
    .delete()
    .eq("organization_id", ORGANIZATION_ID)
    .in("user_id", userIds);
  await admin.from("profiles").delete().in("id", userIds);
  for (const userId of userIds) {
    await admin.auth.admin.deleteUser(userId);
  }
}

async function verifyCredential(supabaseUrl, publishableKey, staff, password) {
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await client.auth.signInWithPassword({
    email: staff.email,
    password,
  });
  assertSuccess(authError, `Sign-in verification failed for ${staff.email}`);
  if (!authData.user) throw new Error(`Sign-in returned no user for ${staff.email}.`);

  const [{ data: membership, error: membershipError }, { data: employee, error: employeeError }] =
    await Promise.all([
      client
        .from("organization_memberships")
        .select("role, status")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("user_id", authData.user.id)
        .single(),
      client
        .from("employees")
        .select("id, display_name, employee_number, home_location_id, employment_status")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("user_id", authData.user.id)
        .single(),
    ]);
  assertSuccess(membershipError, `Membership verification failed for ${staff.email}`);
  assertSuccess(employeeError, `Employee verification failed for ${staff.email}`);
  const expectedAppRole = staff.appRole ?? "employee";
  if (membership.role !== expectedAppRole || membership.status !== "active") {
    throw new Error(
      `${staff.email} does not have the expected active ${expectedAppRole} membership.`,
    );
  }
  if (
    employee.display_name !== staff.displayName ||
    employee.employee_number !== staff.employeeNumber ||
    employee.home_location_id !== LOCATION_ID ||
    employee.employment_status !== "active"
  ) {
    throw new Error(`${staff.email} has an unexpected employee record.`);
  }
  const { data: capabilityRows, error: capabilityError } = await client.rpc(
    "effective_capabilities",
    {
      p_organization_id: ORGANIZATION_ID,
      p_location_id: LOCATION_ID,
      p_effective_on: new Date().toISOString().slice(0, 10),
    },
  );
  assertSuccess(capabilityError, `Capability verification failed for ${staff.email}`);
  if (staff.jobRoleCode === "BOH_CREW") {
    const capabilityKeys = (capabilityRows ?? [])
      .flatMap((row) =>
        typeof row === "string"
          ? [row]
          : typeof row?.capability_key === "string"
            ? [row.capability_key]
            : [],
      )
      .sort();
    const expectedCapabilityKeys = [...KITCHEN_CREW_CAPABILITIES].sort();
    if (JSON.stringify(capabilityKeys) !== JSON.stringify(expectedCapabilityKeys)) {
      throw new Error(`${staff.email} has unexpected Kitchen Crew capabilities.`);
    }
  }
  const { error: signOutError } = await client.auth.signOut({ scope: "local" });
  assertSuccess(signOutError, `Could not close verification session for ${staff.email}`);
  return { email: staff.email, userId: authData.user.id, employeeId: employee.id };
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  if (args.some((argument) => argument !== "--execute")) {
    throw new Error("Usage: node scripts/provision-opening-staff.mjs [--execute]");
  }

  const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requiredEnvironment("SUPABASE_SECRET_KEY");
  const publishableKey = requiredEnvironment("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  if (projectRef !== EXPECTED_PROJECT_REF) {
    throw new Error(`Refusing to provision unexpected Supabase project ${projectRef}.`);
  }
  if (execute && process.env.NEXT_PUBLIC_DEMO_MODE !== "false") {
    throw new Error("NEXT_PUBLIC_DEMO_MODE must be exactly false for production provisioning.");
  }

  const password = execute ? requiredEnvironment("STAFF_PASSWORD") : null;
  if (password && password.length < 8) {
    throw new Error("STAFF_PASSWORD must be at least eight characters.");
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const [
    authUsers,
    organizationResult,
    locationResult,
    roleResult,
    employeeResult,
    ownerResult,
  ] =
    await Promise.all([
      listAllAuthUsers(admin),
      admin.from("organizations").select("id, name, status").eq("id", ORGANIZATION_ID).single(),
      admin.from("locations").select("id, name, is_active").eq("id", LOCATION_ID).single(),
      admin
        .from("job_roles")
        .select("id, code, name, department, is_active")
        .eq("organization_id", ORGANIZATION_ID),
      admin
        .from("employees")
        .select("id, user_id, display_name, email, employee_number")
        .eq("organization_id", ORGANIZATION_ID),
      admin
        .from("organization_memberships")
        .select("user_id")
        .eq("organization_id", ORGANIZATION_ID)
        .eq("role", "owner")
        .eq("status", "active")
        .order("joined_at", { ascending: true })
        .limit(1)
        .single(),
    ]);
  assertSuccess(organizationResult.error, "Could not verify Le Yard organization");
  assertSuccess(locationResult.error, "Could not verify Le Yard location");
  assertSuccess(roleResult.error, "Could not inspect job roles");
  assertSuccess(employeeResult.error, "Could not inspect employees");
  assertSuccess(ownerResult.error, "Could not identify a capability audit owner");
  if (organizationResult.data.name !== "Le Yard" || organizationResult.data.status !== "active") {
    throw new Error("The target organization is not the active Le Yard tenant.");
  }
  if (locationResult.data.name !== "Le Yard" || !locationResult.data.is_active) {
    throw new Error("The target location is not the active Le Yard location.");
  }

  const authByEmail = new Map(
    authUsers.flatMap((user) => (user.email ? [[user.email.toLowerCase(), user]] : [])),
  );
  const employeesByEmail = new Map(
    (employeeResult.data ?? []).flatMap((employee) =>
      employee.email ? [[employee.email.toLowerCase(), employee]] : [],
    ),
  );
  for (const staff of existingStaff) {
    if (!authByEmail.has(staff.email) || !employeesByEmail.has(staff.email)) {
      throw new Error(`Expected existing staff account ${staff.email} is missing.`);
    }
  }
  for (const staff of newStaff) {
    if (!staff.email.endsWith(INTERNAL_EMAIL_SUFFIX)) {
      throw new Error(`Refusing non-internal staff email ${staff.email}.`);
    }
    const existingAuth = authByEmail.get(staff.email);
    const existingEmployee = employeesByEmail.get(staff.email);
    if (existingAuth && !existingEmployee) {
      throw new Error(`${staff.email} already belongs to an unrelated Auth identity.`);
    }
  }

  const planned = {
    mode: execute ? "execute" : "dry-run",
    target: { organization: organizationResult.data.name, location: locationResult.data.name },
    totals: { backOfHouse: 6, frontOfHouse: 6, newAccounts: newStaff.length },
    kitchenCrewCapabilities: KITCHEN_CREW_CAPABILITIES,
    existing: existingStaff.map(({ email, displayName, jobRoleCode }) => ({
      email,
      displayName,
      jobRoleCode,
      action: "retain account and set requested staff password",
    })),
    create: newStaff.map(({ email, displayName, employeeNumber, jobRoleCode }) => ({
      email,
      displayName,
      employeeNumber,
      jobRoleCode,
      action: authByEmail.has(email) ? "repair or verify" : "create",
    })),
  };
  if (!execute) {
    process.stdout.write(`${JSON.stringify(planned, null, 2)}\n`);
    process.stdout.write("Dry run only. Rerun with --execute and STAFF_PASSWORD after review.\n");
    return;
  }

  let kitchenRole = (roleResult.data ?? []).find((role) => role.code === "BOH_CREW");
  let createdKitchenRoleId = null;
  const createdKitchenCapabilityIds = [];
  const createdUserIds = [];
  const provisionedUsers = [];
  try {
    if (!kitchenRole) {
      const { data, error } = await admin
        .from("job_roles")
        .insert({
          organization_id: ORGANIZATION_ID,
          name: "Kitchen crew",
          code: "BOH_CREW",
          department: "Back of house",
          default_tip_points: 0,
          is_tipped: false,
          is_active: true,
        })
        .select("id, code, name, department, is_active")
        .single();
      assertSuccess(error, "Could not create least-privilege Kitchen Crew role");
      kitchenRole = data;
      createdKitchenRoleId = data.id;
    }
    const rolesByCode = new Map(
      [...(roleResult.data ?? []), kitchenRole].map((role) => [role.code, role]),
    );
    for (const code of ["BOH_CREW", "SERVER", "BARTENDER", "SUPPORT"]) {
      const role = rolesByCode.get(code);
      if (!role?.is_active) throw new Error(`Required active job role ${code} is missing.`);
    }

    const { data: existingKitchenCapabilities, error: kitchenCapabilityError } = await admin
      .from("job_role_capabilities")
      .select("capability_key")
      .eq("organization_id", ORGANIZATION_ID)
      .eq("job_role_id", kitchenRole.id)
      .eq("is_active", true);
    assertSuccess(kitchenCapabilityError, "Could not inspect Kitchen Crew capabilities");
    const existingCapabilityKeys = new Set(
      (existingKitchenCapabilities ?? []).map((capability) => capability.capability_key),
    );
    const missingCapabilityRows = KITCHEN_CREW_CAPABILITIES
      .filter((capabilityKey) => !existingCapabilityKeys.has(capabilityKey))
      .map((capabilityKey) => {
        const id = stableUuid(`boh-crew-capability:${capabilityKey}`);
        createdKitchenCapabilityIds.push(id);
        return {
          id,
          organization_id: ORGANIZATION_ID,
          job_role_id: kitchenRole.id,
          capability_key: capabilityKey,
          location_id: null,
          effective_from: new Date().toISOString().slice(0, 10),
          effective_to: null,
          is_active: true,
          created_by: ownerResult.data.user_id,
          updated_by: ownerResult.data.user_id,
        };
      });
    if (missingCapabilityRows.length) {
      const { error: capabilityInsertError } = await admin
        .from("job_role_capabilities")
        .insert(missingCapabilityRows);
      assertSuccess(capabilityInsertError, "Could not grant bounded Kitchen Crew capabilities");
    }

    for (const staff of newStaff) {
      let user = authByEmail.get(staff.email);
      if (!user) {
        const { data, error } = await admin.auth.admin.createUser({
          email: staff.email,
          password,
          email_confirm: true,
          user_metadata: { display_name: staff.displayName },
        });
        assertSuccess(error, `Could not create Auth user ${staff.email}`);
        if (!data.user) throw new Error(`Auth returned no user for ${staff.email}.`);
        user = data.user;
        createdUserIds.push(user.id);
        const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, {
          app_metadata: {
            ...user.app_metadata,
            le_yard_organization_id: ORGANIZATION_ID,
            le_yard_membership_role: "employee",
          },
        });
        assertSuccess(metadataError, `Could not bind app metadata for ${staff.email}`);
      }
      provisionedUsers.push({ ...staff, user });
    }

    const now = new Date().toISOString();
    const profileRows = provisionedUsers.map((staff) => ({
      id: staff.user.id,
      display_name: staff.displayName,
    }));
    const { error: profileError } = await admin
      .from("profiles")
      .upsert(profileRows, { onConflict: "id" });
    assertSuccess(profileError, "Could not provision staff profiles");

    const membershipRows = provisionedUsers.map((staff) => ({
      organization_id: ORGANIZATION_ID,
      user_id: staff.user.id,
      role: "employee",
      status: "active",
      joined_at: now,
    }));
    const { error: membershipError } = await admin
      .from("organization_memberships")
      .upsert(membershipRows, { onConflict: "organization_id,user_id" });
    assertSuccess(membershipError, "Could not provision organization memberships");

    const locationRows = provisionedUsers.map((staff) => ({
      organization_id: ORGANIZATION_ID,
      location_id: LOCATION_ID,
      user_id: staff.user.id,
      is_primary: true,
    }));
    const { error: locationError } = await admin
      .from("location_memberships")
      .upsert(locationRows, { onConflict: "location_id,user_id" });
    assertSuccess(locationError, "Could not provision location memberships");

    const employeeRows = provisionedUsers.map((staff) => ({
      id: employeesByEmail.get(staff.email)?.id ?? stableUuid(`employee:${staff.email}`),
      organization_id: ORGANIZATION_ID,
      user_id: staff.user.id,
      home_location_id: LOCATION_ID,
      employee_number: staff.employeeNumber,
      display_name: staff.displayName,
      email: staff.email,
      employment_status: "active",
    }));
    const { error: staffError } = await admin
      .from("employees")
      .upsert(employeeRows, { onConflict: "organization_id,user_id" });
    assertSuccess(staffError, "Could not provision employee records");

    const assignmentRows = provisionedUsers.map((staff, index) => ({
      id: stableUuid(`assignment:${staff.email}:${staff.jobRoleCode}`),
      organization_id: ORGANIZATION_ID,
      employee_id: employeeRows[index].id,
      job_role_id: rolesByCode.get(staff.jobRoleCode).id,
      location_id: LOCATION_ID,
      effective_from: new Date().toISOString().slice(0, 10),
      is_primary: true,
    }));
    const { error: assignmentError } = await admin
      .from("employee_job_roles")
      .upsert(assignmentRows, {
        onConflict: "employee_id,job_role_id,location_id,effective_from",
      });
    assertSuccess(assignmentError, "Could not provision employee job roles");
  } catch (error) {
    await removeCreatedUsers(admin, createdUserIds);
    if (createdKitchenCapabilityIds.length) {
      await admin
        .from("job_role_capabilities")
        .delete()
        .in("id", createdKitchenCapabilityIds);
    }
    if (createdKitchenRoleId) {
      await admin.from("job_roles").delete().eq("id", createdKitchenRoleId);
    }
    throw error;
  }

  for (const staff of existingStaff) {
    const user = authByEmail.get(staff.email);
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { ...user.user_metadata, display_name: staff.displayName },
    });
    assertSuccess(error, `Could not set requested credential for ${staff.email}`);
  }

  const verified = [];
  for (const staff of [...existingStaff, ...newStaff]) {
    verified.push(await verifyCredential(supabaseUrl, publishableKey, staff, password));
  }

  process.stdout.write(`${JSON.stringify({
    status: "provisioned_and_verified",
    target: planned.target,
    totals: planned.totals,
    credentialSignInsVerified: verified.length,
    roster: [...existingStaff, ...newStaff].map(({ email, displayName, employeeNumber, jobRoleCode }) => ({
      email,
      displayName,
      employeeNumber,
      jobRoleCode,
      verified: true,
    })),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
