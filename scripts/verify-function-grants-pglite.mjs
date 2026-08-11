import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });

const approvedAuthenticatedFunctions = new Set([
  "accept_my_invitation",
  "acknowledge_preshift",
  "acknowledge_sop",
  "approve_le_yard_reservation_draft",
  "assign_reservation_tables",
  "administer_organization_member",
  "apply_time_entry_correction",
  "approve_closeout",
  "approve_inventory_count",
  "approve_tip_adjustment",
  "approve_tip_policy_version",
  "approve_tip_run",
  "calculate_tip_run",
  "can_access_channel",
  "can_access_location",
  "can_access_org",
  "can_access_storage_scope",
  "can_manage_guest_profile_scope",
  "can_administer_membership_target",
  "can_manage_location",
  "can_manage_org",
  "can_manage_report_scope",
  "can_manage_storage_scope",
  "can_operate_employee",
  "can_operate_org",
  "can_read_employee_management",
  "can_read_guest_note_scope",
  "can_read_guest_profile_scope",
  "can_read_management_location",
  "can_read_management_org",
  "can_read_management_storage_scope",
  "can_read_report_scope",
  "cancel_reservation",
  "cancel_time_off_request",
  "claim_open_shift",
  "complete_checklist_run",
  "configure_inventory_catalog",
  "configure_job_role_capability",
  "configure_kitchen_foundation",
  "configure_operational_inventory_catalog",
  "configure_reservation_location",
  "configure_service_shift_exception",
  "configure_retention_policy",
  "configure_tip_pool_policy",
  "configure_user_capability_override",
  "create_chat_channel",
  "create_checklist_template_version",
  "create_employee_job_assignment",
  "create_incident",
  "create_inventory_transfer",
  "create_job_role_definition",
  "create_maintenance_request",
  "create_manual_csv_import",
  "create_purchase_order",
  "create_schedule_draft",
  "create_sop_draft",
  "create_sop_version",
  "create_task",
  "current_user_id",
  "deactivate_job_role_definition",
  "decide_shift_swap",
  "decide_time_off_request",
  "delete_availability_rule",
  "effective_capabilities",
  "end_employee_job_assignment",
  "end_time_break",
  "has_any_capability",
  "has_any_location_capability",
  "has_capability",
  "has_current_location_capability",
  "has_org_role",
  "is_owner_pending_mfa",
  "is_self_employee",
  "jwt_aal",
  "mark_channel_read",
  "modify_reservation",
  "install_le_yard_reservation_draft",
  "income_operating_snapshot",
  "offer_shift_swap",
  "org_role",
  "prepare_tip_run_from_closeout",
  "provision_user_invitation",
  "publish_checklist_template",
  "publish_schedule",
  "publish_sop_version",
  "reservation_capacity_snapshot",
  "service_reservation_host_snapshot",
  "service_reservation_lifecycle_head",
  "service_reservation_shift_snapshot",
  "receive_inventory_delivery",
  "record_checklist_response",
  "record_clock_in",
  "record_clock_out",
  "record_missed_time_entry",
  "record_inventory_item_cost",
  "record_service_availability_event",
  "record_receipt_fingerprint",
  "record_tip_payroll_export",
  "remove_push_subscription",
  "reopen_shift",
  "report_filters_are_scope_safe",
  "request_report_export",
  "request_shift_swap",
  "request_time_entry_correction",
  "resolve_receipt_duplicate",
  "retry_integration_sync_job",
  "review_inventory_transfer",
  "review_receipt",
  "review_time_entry",
  "review_waste_record",
  "revoke_user_invitation",
  "revoke_service_shift_exception",
  "save_availability_rule",
  "save_employee_certification",
  "save_employee_emergency_contact",
  "save_expense_category",
  "save_manager_recipe",
  "save_manager_log_entry",
  "save_preshift",
  "save_push_subscription",
  "save_reservation",
  "save_reservation_with_guest",
  "save_schedule_template",
  "service_reservation_guest_summaries",
  "service_add_guest_note",
  "service_guest_profiles",
  "service_guest_sensitive_metrics",
  "service_guest_sensitive_notes",
  "service_guest_sensitive_profiles",
  "service_merge_guests",
  "service_record_guest_consent",
  "service_save_guest",
  "service_day_business_date",
  "service_day_provider_health",
  "save_time_off_request",
  "save_tip_pool_policy_draft",
  "save_waitlist_entry",
  "save_waitlist_entry_v2",
  "seat_waitlist_entry",
  "set_reservation_table_status",
  "search_guests",
  "search_receipts",
  "set_chat_channel_archived",
  "set_delivery_receipt_link",
  "set_expense_category_active",
  "set_expense_receipt_link",
  "set_incident_status",
  "set_maintenance_status",
  "set_notification_preference",
  "set_private_chat_channel_members",
  "shares_active_org",
  "start_checklist_run",
  "start_time_break",
  "storage_chat_path_is_authorized",
  "storage_location_id",
  "storage_object_is_terminal_evidence",
  "storage_organization_id",
  "storage_path_scope_is_valid",
  "submit_inventory_count",
  "submit_waste_record",
  "transition_reservation",
  "transition_waitlist_entry",
  "transition_task",
  "update_employee_document_metadata",
  "update_employee_job_assignment",
  "update_job_role_definition",
  "update_sop_draft",
]);

const requiredServiceFunctions = new Set([
  "add_guest_note",
  "assign_guest_tag",
  "bind_verified_checklist_photo_response",
  "bootstrap_initial_tenant",
  "complete_report_export",
  "merge_guests",
  "record_guest_consent",
  "save_guest",
  "save_guest_contact",
  "service_cancel_public_reservation",
  "service_confirm_public_reservation",
  "service_create_public_reservation",
  "service_exchange_reservation_management",
  "service_expire_reservation_deadlines",
  "service_enqueue_reservation_reminders",
  "service_finalize_employee_document",
  "service_get_managed_reservation",
  "service_claim_booking_rate_limit",
  "service_claim_reservation_message_outbox",
  "service_claim_reservation_push_deliveries",
  "service_complete_reservation_message_outbox",
  "service_begin_reservation_push_delivery",
  "service_complete_reservation_push_delivery",
  "service_connected_acceptance_marker",
  "service_modify_public_reservation",
  "service_reservation_pacing_snapshot",
  "service_begin_reservation_message_delivery",
]);

const platformBootstrap = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;
  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, email text unique,
    encrypted_password text, email_confirmed_at timestamptz,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table auth.identities (
    id uuid primary key, provider_id text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    identity_data jsonb not null default '{}'::jsonb, provider text not null,
    last_sign_in_at timestamptz, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(), unique (provider_id, provider)
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(auth.jwt() ->> 'role', ''), current_user::text)
  $$;
  create table storage.buckets (
    id text primary key, name text not null unique, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets(id) on delete cascade,
    name text not null, owner_id text, metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

try {
  await db.exec(platformBootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }

  const hardeningMigration = await readFile(
    join(
      migrationsDirectory,
      "20260808170406_public_function_grant_hardening.sql",
    ),
    "utf8",
  );
  if (
    !/alter\s+default\s+privileges[\s\S]+revoke\s+execute\s+on\s+functions\s+from\s+public/i.test(
      hardeningMigration,
    )
  ) {
    throw new Error(
      "Public function default privileges are not deny-by-default",
    );
  }

  const functions = await db.query(`
    select
      p.oid::regprocedure::text as signature,
      p.proname as name,
      p.prosecdef as security_definer,
      coalesce(array_to_string(p.proconfig, ','), '') as configuration,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
      exists (
        select 1 from pg_trigger trigger
        where trigger.tgfoid = p.oid and not trigger.tgisinternal
      ) as trigger_function
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
    order by p.proname, p.oid::regprocedure::text
  `);
  const privateGuestIdentityResolver = (
    await db.query(`
      select
        p.prosecdef as security_definer,
        coalesce(array_to_string(p.proconfig, ','), '') as configuration,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
      from pg_proc p
      where p.oid =
        'private.resolve_location_guest_identity(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)'::regprocedure
    `)
  ).rows[0];
  const privateReservationDeliveryAndLifecycleFunctions = (
    await db.query(
      `
      select
        p.proname as name,
        p.prosecdef as security_definer,
        coalesce(array_to_string(p.proconfig, ','), '') as configuration,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
      from pg_proc p
      where p.pronamespace = 'private'::regnamespace
        and p.proname = any($1::text[])
      order by p.proname
    `,
      [
        [
          "bind_reservation_message_delivery_evidence",
          "cancel_ineligible_reservation_messages",
          "cancel_reservation_messages_on_settings_change",
          "cancel_reservation_authoritative_kernel",
          "fence_reservation_message_delivery_insert",
          "modify_reservation_authoritative_kernel",
          "reservation_lifecycle_head_authoritative_kernel",
          "reservation_verified_recipient_hmac",
          "version_reservation_message_delivery_settings",
        ],
      ],
    )
  ).rows;

  if (process.env.PRINT_FUNCTION_GRANTS === "1") {
    process.stdout.write(`${JSON.stringify(functions.rows, null, 2)}\n`);
    process.exit(0);
  }

  const anonExecutable = functions.rows.filter((entry) => entry.anon_execute);
  const unsafeDefiners = functions.rows.filter((entry) => {
    if (!entry.security_definer) return false;
    const settings = entry.configuration.split(",");
    return (
      !settings.includes('search_path=""') && !settings.includes("search_path=")
    );
  });
  const triggerExecutable = functions.rows.filter(
    (entry) => entry.trigger_function && entry.authenticated_execute,
  );
  const unauthorizedAuthenticated = functions.rows.filter(
    (entry) =>
      entry.authenticated_execute &&
      !approvedAuthenticatedFunctions.has(entry.name),
  );
  const missingAuthenticated = [...approvedAuthenticatedFunctions].filter(
    (name) =>
      !functions.rows.some(
        (entry) => entry.name === name && entry.authenticated_execute,
      ),
  );
  const missingService = [...requiredServiceFunctions].filter(
    (name) =>
      !functions.rows.some(
        (entry) => entry.name === name && entry.service_execute,
      ),
  );
  const serviceExposedToAuthenticated = functions.rows.filter(
    (entry) =>
      requiredServiceFunctions.has(entry.name) && entry.authenticated_execute,
  );
  const legacyReservationClaimValidator = functions.rows.find(
    (entry) => entry.name === "service_validate_reservation_message_claim",
  );

  if (anonExecutable.length) {
    throw new Error(
      `Anonymous function execution remains: ${JSON.stringify(anonExecutable)}`,
    );
  }
  if (unsafeDefiners.length) {
    throw new Error(
      `Unsafe SECURITY DEFINER search_path: ${JSON.stringify(unsafeDefiners)}`,
    );
  }
  if (triggerExecutable.length) {
    throw new Error(
      `Trigger-only functions remain executable: ${JSON.stringify(triggerExecutable)}`,
    );
  }
  if (unauthorizedAuthenticated.length) {
    throw new Error(
      `Unapproved authenticated execution remains: ${JSON.stringify(unauthorizedAuthenticated)}`,
    );
  }
  if (missingAuthenticated.length) {
    throw new Error(
      `Approved authenticated RPC grants are missing: ${missingAuthenticated.join(", ")}`,
    );
  }
  if (missingService.length || serviceExposedToAuthenticated.length) {
    throw new Error(
      `Service-only grant boundary failed: ${JSON.stringify({ missingService, serviceExposedToAuthenticated })}`,
    );
  }
  if (legacyReservationClaimValidator) {
    throw new Error(
      `Legacy reservation claim validator remains exposed: ${JSON.stringify(legacyReservationClaimValidator)}`,
    );
  }
  if (
    !privateGuestIdentityResolver?.security_definer ||
    !privateGuestIdentityResolver.configuration.includes('search_path=""') ||
    privateGuestIdentityResolver.anon_execute ||
    privateGuestIdentityResolver.authenticated_execute ||
    privateGuestIdentityResolver.service_execute
  ) {
    throw new Error(
      `Private guest identity resolver grant boundary failed: ${JSON.stringify(privateGuestIdentityResolver)}`,
    );
  }
  if (
    privateReservationDeliveryAndLifecycleFunctions.length !== 9 ||
    privateReservationDeliveryAndLifecycleFunctions.some(
      (entry) =>
        !entry.security_definer ||
        !entry.configuration.includes('search_path=""') ||
        entry.anon_execute ||
        entry.authenticated_execute ||
        entry.service_execute,
    )
  ) {
    throw new Error(
      `Private reservation delivery/lifecycle grants failed: ${JSON.stringify(privateReservationDeliveryAndLifecycleFunctions)}`,
    );
  }
  process.stdout.write(
    `PASS ${functions.rows.length} public functions: explicit grants, safe definers, service/trigger isolation, and deny-by-default future functions\n`,
  );
} finally {
  await db.close();
}
