-- Cache auth.uid() once per statement in the 40 policies identified by the
-- Supabase auth_rls_initplan advisor. This is a performance-only rewrite: the
-- policy commands, roles, predicates, and authorization outcomes are unchanged.

do $$
declare
  target_policies constant text[] := array[
    'ai_action_proposals.ai_owner_operator_proposal_read',
    'ai_citations.ai_owner_operator_citation_read',
    'ai_runs.ai_owner_operator_read',
    'announcement_acknowledgements.announcement_ack_read',
    'announcement_acknowledgements.announcement_ack_self_delete',
    'announcement_acknowledgements.announcement_ack_self_insert',
    'chat_attachments.attachment_author_delete',
    'chat_attachments.attachment_author_insert',
    'chat_channels.channel_manager_insert',
    'chat_messages.message_author_delete',
    'chat_messages.message_author_insert',
    'chat_messages.message_author_update',
    'chat_reactions.reaction_self_delete',
    'chat_reactions.reaction_self_insert',
    'chat_read_receipts.read_receipt_read',
    'chat_read_receipts.read_receipt_self_delete',
    'chat_read_receipts.read_receipt_self_insert',
    'chat_read_receipts.read_receipt_self_update',
    'checklist_responses.checklist_response_owner_update',
    'checklist_responses.checklist_response_staff_insert',
    'incident_attachments.incident_attachment_insert',
    'incident_attachments.incident_attachment_read',
    'incidents.incident_read',
    'incidents.incident_staff_insert',
    'location_memberships.location_membership_read',
    'maintenance_requests.maintenance_staff_insert',
    'notification_preferences.notification_preference_self',
    'notifications.notification_self_read',
    'notifications.notification_self_update',
    'organization_memberships.membership_admin_delete',
    'organization_memberships.membership_read',
    'preshift_acknowledgements.preshift_acknowledgement_read',
    'profiles.profile_read',
    'profiles.profile_self_insert',
    'profiles.profile_self_update',
    'push_subscriptions.push_subscription_self',
    'time_entry_corrections.correction_read',
    'time_entry_corrections.correction_self_insert',
    'time_entry_corrections.correction_self_update',
    'user_invitations.invitation_admin_insert'
  ];
  policy_record record;
  rewritten_qual text;
  rewritten_check text;
  matched_count integer := 0;
begin
  for policy_record in
    select tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (tablename || '.' || policyname) = any(target_policies)
    order by tablename, policyname
  loop
    matched_count := matched_count + 1;

    -- Preserve expressions already using the cached form while replacing each
    -- remaining per-row auth.uid() call.
    rewritten_qual := replace(
      replace(
        replace(coalesce(policy_record.qual, ''), '( SELECT auth.uid() AS uid)', '__CACHED_AUTH_UID__'),
        'auth.uid()',
        '( SELECT auth.uid() AS uid)'
      ),
      '__CACHED_AUTH_UID__',
      '( SELECT auth.uid() AS uid)'
    );
    rewritten_check := replace(
      replace(
        replace(coalesce(policy_record.with_check, ''), '( SELECT auth.uid() AS uid)', '__CACHED_AUTH_UID__'),
        'auth.uid()',
        '( SELECT auth.uid() AS uid)'
      ),
      '__CACHED_AUTH_UID__',
      '( SELECT auth.uid() AS uid)'
    );

    if policy_record.qual is not null and policy_record.with_check is not null then
      execute format(
        'alter policy %I on public.%I using (%s) with check (%s)',
        policy_record.policyname,
        policy_record.tablename,
        rewritten_qual,
        rewritten_check
      );
    elsif policy_record.qual is not null then
      execute format(
        'alter policy %I on public.%I using (%s)',
        policy_record.policyname,
        policy_record.tablename,
        rewritten_qual
      );
    elsif policy_record.with_check is not null then
      execute format(
        'alter policy %I on public.%I with check (%s)',
        policy_record.policyname,
        policy_record.tablename,
        rewritten_check
      );
    else
      raise exception 'Target policy %.% has no predicate',
        policy_record.tablename,
        policy_record.policyname;
    end if;
  end loop;

  if matched_count <> cardinality(target_policies) then
    raise exception 'Expected % target RLS policies, found %',
      cardinality(target_policies),
      matched_count;
  end if;
end
$$;
