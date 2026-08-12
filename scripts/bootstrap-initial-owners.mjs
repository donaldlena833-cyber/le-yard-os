import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const PLACEHOLDER = /(replace|example|your\s|todo|tbd|placeholder)/i;

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function validCurrency(value) {
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: value }).format(1);
    return true;
  } catch {
    return false;
  }
}

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .refine((value) => !value.endsWith(".invalid") && !PLACEHOLDER.test(value), {
    message: "Use a verified production owner email.",
  });

const bootstrapConfigSchema = z.object({
  organization: z.object({
    name: z.string().trim().min(1).max(120).refine((value) => !PLACEHOLDER.test(value)),
    slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).refine((value) => !PLACEHOLDER.test(value)),
    timezone: z.string().trim().refine(validTimeZone, "Use an IANA timezone."),
    currencyCode: z.string().trim().regex(/^[A-Z]{3}$/).refine(validCurrency, "Use an ISO 4217 currency code."),
  }),
  locations: z.array(z.object({
    name: z.string().trim().min(1).max(120).refine((value) => !PLACEHOLDER.test(value)),
    code: z.string().trim().regex(/^[A-Z0-9_-]{2,20}$/),
    timezone: z.string().trim().refine(validTimeZone, "Use an IANA timezone."),
    phone: z.string().trim().min(7).max(40).nullable().optional(),
    address: z.object({
      line1: z.string().trim().min(1),
      line2: z.string().trim().nullable().optional(),
      city: z.string().trim().min(1),
      region: z.string().trim().min(1),
      postalCode: z.string().trim().min(1),
      country: z.string().trim().length(2).transform((value) => value.toUpperCase()),
    }).refine((address) => !Object.values(address).some((value) => typeof value === "string" && PLACEHOLDER.test(value)), {
      message: "Replace every address placeholder.",
    }),
  })).min(1).max(100).superRefine((locations, context) => {
    const codes = new Set();
    locations.forEach((location, index) => {
      if (codes.has(location.code)) {
        context.addIssue({ code: "custom", path: [index, "code"], message: "Location codes must be unique." });
      }
      codes.add(location.code);
    });
  }),
});

function stableUuid(seed, label) {
  const bytes = createHash("sha256").update(`${label}\u001f${seed}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function productionHttpsOrigin(name, value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`${name} must be a canonical HTTPS origin.`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.startsWith("127.")) {
    throw new Error(`${name} must not be a local origin.`);
  }
  return parsed.origin;
}

function callbackUrl(appUrl, organizationId) {
  const callback = new URL("/auth/callback", appUrl);
  callback.searchParams.set("next", `/invite?organization=${organizationId}`);
  return callback.toString();
}

async function listAllAuthUsers(admin) {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not inspect Auth users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
  throw new Error("Auth user inspection exceeded the safe bootstrap bound.");
}

async function main() {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf("--config");
  const execute = args.includes("--execute");
  const allowed = new Set(["--config", "--execute"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--config") {
      index += 1;
      continue;
    }
    if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
  }
  if (configIndex < 0 || !args[configIndex + 1]) {
    throw new Error("Usage: npm run bootstrap:owners -- --config <approved.json> [--execute]");
  }

  const configPath = resolve(process.cwd(), args[configIndex + 1]);
  const rawConfig = JSON.parse(await readFile(configPath, "utf8"));
  const config = bootstrapConfigSchema.parse(rawConfig);
  const ownerOneEmail = emailSchema.parse(requiredEnvironment("OWNER_1_EMAIL"));
  const ownerTwoEmail = emailSchema.parse(requiredEnvironment("OWNER_2_EMAIL"));
  const ownerOneDisplayName = requiredEnvironment("OWNER_1_DISPLAY_NAME");
  const ownerTwoDisplayName = requiredEnvironment("OWNER_2_DISPLAY_NAME");
  if (ownerOneEmail === ownerTwoEmail) throw new Error("Owner 1 and Owner 2 must use distinct emails.");

  const canonicalConfig = JSON.stringify(config);
  const seed = createHash("sha256")
    .update(`${canonicalConfig}\u001f${ownerOneEmail}\u001f${ownerTwoEmail}`)
    .digest("hex");
  const requestId = stableUuid(seed, "bootstrap-request");
  const organizationId = stableUuid(seed, "organization");
  const ownerOneEmployeeId = stableUuid(seed, "owner-one-employee");
  const ownerTwoEmployeeId = stableUuid(seed, "owner-two-employee");
  const locations = config.locations.map((location, index) => ({
    id: stableUuid(seed, `location-${index}-${location.code}`),
    ...location,
    phone: location.phone ?? null,
  }));
  const confirmationHash = createHash("sha256")
    .update(`${seed}\u001f${requestId}\u001f${organizationId}`)
    .digest("hex")
    .slice(0, 20);
  const requiredConfirmation = `bootstrap:${confirmationHash}`;

  const plan = {
    mode: execute ? "execute" : "dry-run",
    requestId,
    organizationId,
    organization: config.organization,
    locations,
    owners: [
      { displayName: ownerOneDisplayName, email: ownerOneEmail, role: "owner" },
      { displayName: ownerTwoDisplayName, email: ownerTwoEmail, role: "owner" },
    ],
    confirmation: requiredConfirmation,
  };

  if (!execute) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.stdout.write("Dry run only. Review every value, then set LE_YARD_BOOTSTRAP_CONFIRM to the confirmation above and rerun with --execute.\n");
    return;
  }

  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "false") {
    throw new Error("NEXT_PUBLIC_DEMO_MODE must be exactly false for owner bootstrap.");
  }
  if (process.env.LE_YARD_BOOTSTRAP_CONFIRM !== requiredConfirmation) {
    throw new Error("LE_YARD_BOOTSTRAP_CONFIRM does not match this exact approved bootstrap plan.");
  }

  const appUrl = productionHttpsOrigin("NEXT_PUBLIC_APP_URL", requiredEnvironment("NEXT_PUBLIC_APP_URL"));
  const supabaseUrl = productionHttpsOrigin("NEXT_PUBLIC_SUPABASE_URL", requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"));
  const secretKey = requiredEnvironment("SUPABASE_SECRET_KEY");
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const [{ data: existingOrganization, error: organizationError }, authUsers] = await Promise.all([
    admin.from("organizations").select("id, name, slug").eq("id", organizationId).maybeSingle(),
    listAllAuthUsers(admin),
  ]);
  if (organizationError) throw new Error(`Could not inspect bootstrap state: ${organizationError.message}`);

  const ownerSpecs = [
    { key: "owner-one", displayName: ownerOneDisplayName, email: ownerOneEmail, employeeId: ownerOneEmployeeId },
    { key: "owner-two", displayName: ownerTwoDisplayName, email: ownerTwoEmail, employeeId: ownerTwoEmployeeId },
  ];
  const existingByEmail = new Map(authUsers.map((user) => [user.email?.toLowerCase(), user]));

  if (existingOrganization) {
    if (existingOrganization.name !== config.organization.name || existingOrganization.slug !== config.organization.slug) {
      throw new Error("The deterministic organization id already belongs to different tenant details.");
    }
    const existingOwners = ownerSpecs.map((owner) => existingByEmail.get(owner.email));
    if (existingOwners.some((user) => !user)) {
      throw new Error("The tenant exists but both expected Owner Auth identities are not present. Stop for manual review.");
    }
    const { data: memberships, error: membershipError } = await admin
      .from("organization_memberships")
      .select("user_id, role, status")
      .eq("organization_id", organizationId)
      .in("user_id", existingOwners.map((user) => user.id));
    if (membershipError || memberships?.length !== 2 || memberships.some((membership) => membership.role !== "owner")) {
      throw new Error("The tenant exists but its two Owner memberships do not match the approved plan.");
    }
    process.stdout.write(`${JSON.stringify({ status: "already_bootstrapped", organizationId, owners: memberships }, null, 2)}\n`);
    return;
  }

  const createdUserIds = [];
  const ownerUsers = [];
  try {
    for (const owner of ownerSpecs) {
      let user = existingByEmail.get(owner.email);
      if (user) {
        const metadata = user.app_metadata ?? {};
        if (metadata.pending_organization_id !== organizationId
          || metadata.pending_role !== "owner"
          || metadata.bootstrap_request_id !== requestId) {
          throw new Error(`${owner.displayName}'s email already belongs to an Auth identity outside this bootstrap plan.`);
        }
      } else {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(owner.email, {
          data: {
            display_name: owner.displayName,
            requested_role: "owner",
            organization_id: organizationId,
            bootstrap_request_id: requestId,
          },
          redirectTo: callbackUrl(appUrl, organizationId),
        });
        if (error || !data.user) {
          throw new Error(`Could not send ${owner.displayName}'s Owner invitation: ${error?.message ?? "unknown Auth error"}`);
        }
        user = data.user;
        createdUserIds.push(user.id);
        const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, {
          app_metadata: {
            ...user.app_metadata,
            pending_organization_id: organizationId,
            pending_role: "owner",
            bootstrap_request_id: requestId,
          },
        });
        if (metadataError) throw new Error(`Could not bind ${owner.displayName}'s invitation metadata.`);
      }
      ownerUsers.push({ ...owner, user });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const tokenHash = (label) => createHmac("sha256", secretKey)
      .update(`${requestId}\u001f${label}`)
      .digest("hex");
    const ownerOne = ownerUsers.find((owner) => owner.key === "owner-one");
    const ownerTwo = ownerUsers.find((owner) => owner.key === "owner-two");
    const { data: bootstrappedOrganizationId, error: bootstrapError } = await admin.rpc("bootstrap_initial_tenant", {
      p_request_id: requestId,
      p_organization_id: organizationId,
      p_organization_name: config.organization.name,
      p_organization_slug: config.organization.slug,
      p_timezone: config.organization.timezone,
      p_currency_code: config.organization.currencyCode,
      p_locations: locations,
      p_donald_user_id: ownerOne.user.id,
      p_donald_email: ownerOne.email,
      p_donald_display_name: ownerOne.displayName,
      p_donald_employee_id: ownerOne.employeeId,
      p_donald_token_hash: tokenHash("owner-one"),
      p_maris_user_id: ownerTwo.user.id,
      p_maris_email: ownerTwo.email,
      p_maris_display_name: ownerTwo.displayName,
      p_maris_employee_id: ownerTwo.employeeId,
      p_maris_token_hash: tokenHash("owner-two"),
      p_expires_at: expiresAt,
    });
    if (bootstrapError || bootstrappedOrganizationId !== organizationId) {
      throw new Error(`Database bootstrap failed: ${bootstrapError?.message ?? "unexpected organization result"}`);
    }

    process.stdout.write(`${JSON.stringify({
      status: "invitations_sent",
      organizationId,
      ownerUserIds: ownerUsers.map((owner) => ({ displayName: owner.displayName, userId: owner.user.id })),
      expiresAt,
      next: "Each owner must use their own one-time email link, set their own password, and enroll MFA.",
    }, null, 2)}\n`);
  } catch (error) {
    const cleanupFailures = [];
    for (const userId of createdUserIds) {
      const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
      if (cleanupError) cleanupFailures.push(userId);
    }
    if (cleanupFailures.length > 0) {
      throw new Error(`${error instanceof Error ? error.message : String(error)} Cleanup also failed for newly-created Auth user ids: ${cleanupFailures.join(", ")}. Stop for manual review.`);
    }
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
