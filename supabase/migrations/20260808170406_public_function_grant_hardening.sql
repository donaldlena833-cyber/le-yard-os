-- Version 0.2 public function execution boundary.
--
-- PostgreSQL grants EXECUTE to PUBLIC when a function is created unless the
-- creator changes the default privileges. Earlier migrations revoked most
-- workflow functions individually, but policy helpers and trigger functions
-- created later could still inherit PUBLIC execution. This migration freezes
-- the browser RPC surface without changing function behavior or RLS policy
-- semantics.

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

revoke execute on all functions in schema public from public, anon, authenticated;

do $grant_manifest$
declare
  approved_name text;
  approved_names constant text[] := array[
    'accept_my_invitation',
    'acknowledge_sop',
    'add_guest_note',
    'administer_organization_member',
    'apply_time_entry_correction',
    'approve_closeout',
    'approve_inventory_count',
    'approve_tip_adjustment',
    'approve_tip_policy_version',
    'approve_tip_run',
    'assign_guest_tag',
    'calculate_tip_run',
    'can_access_channel',
    'can_access_location',
    'can_access_org',
    'can_access_storage_scope',
    'can_administer_membership_target',
    'can_manage_location',
    'can_manage_org',
    'can_manage_report_scope',
    'can_manage_storage_scope',
    'can_operate_employee',
    'can_operate_org',
    'can_read_employee_management',
    'can_read_management_location',
    'can_read_management_org',
    'can_read_management_storage_scope',
    'can_read_report_scope',
    'cancel_time_off_request',
    'claim_open_shift',
    'complete_checklist_run',
    'configure_inventory_catalog',
    'configure_job_role_capability',
    'configure_operational_inventory_catalog',
    'configure_retention_policy',
    'configure_tip_pool_policy',
    'configure_user_capability_override',
    'create_chat_channel',
    'create_checklist_template_version',
    'create_employee_job_assignment',
    'create_incident',
    'create_inventory_transfer',
    'create_job_role_definition',
    'create_maintenance_request',
    'create_manual_csv_import',
    'create_purchase_order',
    'create_sop_draft',
    'create_sop_version',
    'create_task',
    'current_user_id',
    'deactivate_job_role_definition',
    'decide_shift_swap',
    'decide_time_off_request',
    'delete_availability_rule',
    'effective_capabilities',
    'end_employee_job_assignment',
    'end_time_break',
    'has_any_capability',
    'has_any_location_capability',
    'has_capability',
    'has_org_role',
    'is_owner_pending_mfa',
    'is_self_employee',
    'jwt_aal',
    'mark_channel_read',
    'merge_guests',
    'offer_shift_swap',
    'org_role',
    'prepare_tip_run_from_closeout',
    'provision_user_invitation',
    'publish_checklist_template',
    'publish_schedule',
    'publish_sop_version',
    'receive_inventory_delivery',
    'record_checklist_response',
    'record_clock_in',
    'record_clock_out',
    'record_guest_consent',
    'record_missed_time_entry',
    'record_receipt_fingerprint',
    'record_tip_payroll_export',
    'remove_push_subscription',
    'reopen_shift',
    'report_filters_are_scope_safe',
    'request_report_export',
    'request_shift_swap',
    'request_time_entry_correction',
    'resolve_receipt_duplicate',
    'retry_integration_sync_job',
    'review_inventory_transfer',
    'review_receipt',
    'review_time_entry',
    'review_waste_record',
    'revoke_user_invitation',
    'save_availability_rule',
    'save_employee_certification',
    'save_employee_emergency_contact',
    'save_expense_category',
    'save_guest',
    'save_guest_contact',
    'save_manager_recipe',
    'save_push_subscription',
    'save_time_off_request',
    'save_tip_pool_policy_draft',
    'search_guests',
    'search_receipts',
    'set_chat_channel_archived',
    'set_delivery_receipt_link',
    'set_expense_category_active',
    'set_expense_receipt_link',
    'set_incident_status',
    'set_maintenance_status',
    'set_notification_preference',
    'set_private_chat_channel_members',
    'shares_active_org',
    'start_checklist_run',
    'start_time_break',
    'storage_chat_path_is_authorized',
    'storage_location_id',
    'storage_object_is_terminal_evidence',
    'storage_organization_id',
    'storage_path_scope_is_valid',
    'submit_inventory_count',
    'submit_waste_record',
    'transition_task',
    'update_employee_document_metadata',
    'update_employee_job_assignment',
    'update_job_role_definition',
    'update_sop_draft'
  ];
begin
  foreach approved_name in array approved_names loop
    execute (
      select string_agg(
        format('grant execute on function %s to authenticated', procedure.oid::regprocedure),
        '; '
      )
      from pg_proc procedure
      where procedure.pronamespace = 'public'::regnamespace
        and procedure.proname = approved_name
    );
  end loop;
end
$grant_manifest$;

comment on schema public is
  'Exposed application schema. Function execution is deny-by-default; every authenticated RPC or policy-support helper is explicitly allowlisted by the latest security migration.';
