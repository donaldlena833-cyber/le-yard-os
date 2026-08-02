-- Le Yard OS: deny-by-default tenant/location security and private object storage.

create function public.can_read_management_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.has_org_role(
    p_organization_id,
    array['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role]
  )
$$;

create function public.can_operate_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.can_manage_org(p_organization_id)
    or public.has_org_role(p_organization_id, array['manager'::public.app_role])
$$;

create function public.can_read_management_location(p_organization_id uuid, p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.has_org_role(p_organization_id, array['owner'::public.app_role, 'admin'::public.app_role])
    or (
      public.has_org_role(p_organization_id, array['manager'::public.app_role])
      and public.can_access_location(p_organization_id, p_location_id)
    )
$$;

create function public.can_read_employee_management(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee_id
      and (
        public.has_org_role(e.organization_id, array['owner'::public.app_role, 'admin'::public.app_role])
        or (
          public.has_org_role(e.organization_id, array['manager'::public.app_role])
          and (
            (e.home_location_id is not null and public.can_access_location(e.organization_id, e.home_location_id))
            or exists (
              select 1 from public.employee_job_roles ej
              where ej.employee_id = e.id
                and public.can_access_location(e.organization_id, ej.location_id)
            )
          )
        )
      )
  )
$$;

create function public.can_operate_employee(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee_id
      and (
        public.can_manage_org(e.organization_id)
        or (
          public.has_org_role(e.organization_id, array['manager'::public.app_role])
          and (
            (e.home_location_id is not null and public.can_manage_location(e.organization_id, e.home_location_id))
            or exists (
              select 1 from public.employee_job_roles ej
              where ej.employee_id = e.id
                and public.can_manage_location(e.organization_id, ej.location_id)
            )
          )
        )
      )
  )
$$;

grant execute on function public.can_read_management_org(uuid) to authenticated;
grant execute on function public.can_operate_org(uuid) to authenticated;
grant execute on function public.can_read_management_location(uuid, uuid) to authenticated;
grant execute on function public.can_read_employee_management(uuid) to authenticated;
grant execute on function public.can_operate_employee(uuid) to authenticated;

-- RLS is enabled even for tables with no direct client policies. service_role remains
-- the only bypass and must never reach a browser.
do $rls$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end
$rls$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Tenant and membership foundation.
create policy tenant_read on public.organizations for select to authenticated
using (public.can_access_org(id));
create policy tenant_update on public.organizations for update to authenticated
using (public.can_manage_org(id)) with check (public.can_manage_org(id));

create policy accessible_location_read on public.locations for select to authenticated
using (public.can_access_location(organization_id, id));
create policy admin_location_insert on public.locations for insert to authenticated
with check (public.can_manage_org(organization_id));
create policy admin_location_update on public.locations for update to authenticated
using (public.can_manage_org(organization_id)) with check (public.can_manage_org(organization_id));
create policy admin_location_delete on public.locations for delete to authenticated
using (public.can_manage_org(organization_id));

create policy profile_read on public.profiles for select to authenticated
using (id = auth.uid() or public.shares_active_org(id));
create policy profile_self_insert on public.profiles for insert to authenticated
with check (id = auth.uid());
create policy profile_self_update on public.profiles for update to authenticated
using (id = auth.uid()) with check (id = auth.uid());

create policy membership_read on public.organization_memberships for select to authenticated
using (user_id = auth.uid() or public.can_access_org(organization_id));
create policy membership_admin_insert on public.organization_memberships for insert to authenticated
with check (public.can_manage_org(organization_id));
create policy membership_admin_update on public.organization_memberships for update to authenticated
using (public.can_manage_org(organization_id)) with check (public.can_manage_org(organization_id));
create policy membership_admin_delete on public.organization_memberships for delete to authenticated
using (public.can_manage_org(organization_id) and user_id <> auth.uid());

create policy location_membership_read on public.location_memberships for select to authenticated
using (user_id = auth.uid() or public.can_access_location(organization_id, location_id));
create policy location_membership_admin_insert on public.location_memberships for insert to authenticated
with check (public.can_manage_org(organization_id));
create policy location_membership_admin_update on public.location_memberships for update to authenticated
using (public.can_manage_org(organization_id)) with check (public.can_manage_org(organization_id));
create policy location_membership_admin_delete on public.location_memberships for delete to authenticated
using (public.can_manage_org(organization_id));

create policy settings_read on public.organization_settings for select to authenticated
using (public.can_access_org(organization_id));
create policy settings_admin_insert on public.organization_settings for insert to authenticated
with check (public.can_manage_org(organization_id));
create policy settings_admin_update on public.organization_settings for update to authenticated
using (public.can_manage_org(organization_id)) with check (public.can_manage_org(organization_id));

create policy invitation_admin_read on public.user_invitations for select to authenticated
using (public.can_manage_org(organization_id));
create policy invitation_admin_insert on public.user_invitations for insert to authenticated
with check (public.can_manage_org(organization_id) and invited_by = auth.uid());
create policy invitation_admin_update on public.user_invitations for update to authenticated
using (public.can_manage_org(organization_id)) with check (public.can_manage_org(organization_id));
create policy invitation_admin_delete on public.user_invitations for delete to authenticated
using (public.can_manage_org(organization_id));

create policy retention_admin_read on public.retention_policies for select to authenticated
using (public.can_manage_org(organization_id));
create policy retention_admin_insert on public.retention_policies for insert to authenticated
with check (public.can_manage_org(organization_id));
create policy retention_admin_update on public.retention_policies for update to authenticated
using (public.can_manage_org(organization_id)) with check (public.can_manage_org(organization_id));
create policy retention_admin_delete on public.retention_policies for delete to authenticated
using (public.can_manage_org(organization_id));

create policy audit_admin_read on public.audit_events for select to authenticated
using (public.can_manage_org(organization_id));

-- Employee directory and sensitive self-service records.
create policy employee_read on public.employees for select to authenticated
using (public.is_self_employee(id) or public.can_read_employee_management(id));
create policy employee_manager_insert on public.employees for insert to authenticated
with check (
  public.can_manage_org(organization_id)
  or (home_location_id is not null and public.can_manage_location(organization_id, home_location_id))
);
create policy employee_manager_update on public.employees for update to authenticated
using (public.can_operate_employee(id))
with check (
  public.can_manage_org(organization_id)
  or (home_location_id is not null and public.can_manage_location(organization_id, home_location_id))
);
create policy employee_manager_delete on public.employees for delete to authenticated
using (public.can_manage_org(organization_id));

create policy job_role_staff_read on public.job_roles for select to authenticated
using (public.can_access_org(organization_id));
create policy job_role_manager_insert on public.job_roles for insert to authenticated
with check (public.can_operate_org(organization_id));
create policy job_role_manager_update on public.job_roles for update to authenticated
using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id));
create policy job_role_manager_delete on public.job_roles for delete to authenticated
using (public.can_operate_org(organization_id));

create policy employee_job_role_staff_read on public.employee_job_roles for select to authenticated
using (public.can_access_location(organization_id, location_id));
create policy employee_job_role_manager_insert on public.employee_job_roles for insert to authenticated
with check (
  public.can_manage_location(organization_id, location_id)
  and (public.can_manage_org(organization_id) or public.can_read_employee_management(employee_id))
);
create policy employee_job_role_manager_update on public.employee_job_roles for update to authenticated
using (public.can_manage_location(organization_id, location_id) and public.can_operate_employee(employee_id))
with check (public.can_manage_location(organization_id, location_id) and public.can_operate_employee(employee_id));
create policy employee_job_role_manager_delete on public.employee_job_roles for delete to authenticated
using (public.can_manage_location(organization_id, location_id) and public.can_operate_employee(employee_id));

do $employee_self_tables$
declare t text;
begin
  foreach t in array array['employee_certifications', 'employee_emergency_contacts', 'employee_documents']
  loop
    execute format('create policy employee_self_read on public.%I for select to authenticated using (public.is_self_employee(employee_id) or public.can_read_employee_management(employee_id))', t);
    execute format('create policy manager_write on public.%I for all to authenticated using (public.can_operate_employee(employee_id)) with check (public.can_operate_employee(employee_id))', t);
  end loop;
end
$employee_self_tables$;

create policy availability_read on public.availability_rules for select to authenticated
using (public.is_self_employee(employee_id) or public.can_read_employee_management(employee_id));
create policy availability_manager_write on public.availability_rules for all to authenticated
using (public.can_operate_employee(employee_id) and (location_id is null or public.can_manage_location(organization_id, location_id)))
with check (public.can_operate_employee(employee_id) and (location_id is null or public.can_manage_location(organization_id, location_id)));
create policy availability_self_insert on public.availability_rules for insert to authenticated
with check (public.is_self_employee(employee_id) and (location_id is null or public.can_access_location(organization_id, location_id)));
create policy availability_self_update on public.availability_rules for update to authenticated
using (public.is_self_employee(employee_id))
with check (public.is_self_employee(employee_id) and (location_id is null or public.can_access_location(organization_id, location_id)));
create policy availability_self_delete on public.availability_rules for delete to authenticated
using (public.is_self_employee(employee_id));

create policy time_off_read on public.time_off_requests for select to authenticated
using (public.is_self_employee(employee_id) or public.can_read_employee_management(employee_id));
create policy time_off_manager_write on public.time_off_requests for all to authenticated
using (public.can_operate_employee(employee_id) and (location_id is null or public.can_manage_location(organization_id, location_id)))
with check (public.can_operate_employee(employee_id) and (location_id is null or public.can_manage_location(organization_id, location_id)));
create policy time_off_self_insert on public.time_off_requests for insert to authenticated
with check (
  public.is_self_employee(employee_id) and status = 'pending'
  and (location_id is null or public.can_access_location(organization_id, location_id))
);
create policy time_off_self_update on public.time_off_requests for update to authenticated
using (public.is_self_employee(employee_id) and status in ('pending', 'cancelled'))
with check (
  public.is_self_employee(employee_id) and status in ('pending', 'cancelled')
  and (location_id is null or public.can_access_location(organization_id, location_id))
);

create policy schedule_template_read on public.schedule_templates for select to authenticated
using (public.can_read_management_location(organization_id, location_id));
create policy schedule_template_write on public.schedule_templates for all to authenticated
using (public.can_manage_location(organization_id, location_id))
with check (public.can_manage_location(organization_id, location_id));

create policy schedule_read on public.schedules for select to authenticated
using (
  public.can_read_management_location(organization_id, location_id)
  or (status = 'published' and public.can_access_location(organization_id, location_id))
);
create policy schedule_write on public.schedules for all to authenticated
using (public.can_manage_location(organization_id, location_id))
with check (public.can_manage_location(organization_id, location_id));

create policy shift_read on public.shifts for select to authenticated
using (
  public.can_read_management_location(organization_id, location_id)
  or (
    public.can_access_location(organization_id, location_id)
    and exists (select 1 from public.schedules sc where sc.id = schedule_id and sc.status = 'published')
  )
);
create policy shift_write on public.shifts for all to authenticated
using (public.can_manage_location(organization_id, location_id))
with check (public.can_manage_location(organization_id, location_id));

create policy template_shift_read on public.schedule_template_shifts for select to authenticated
using (exists (
  select 1 from public.schedule_templates t
  where t.id = template_id and public.can_read_management_location(t.organization_id, t.location_id)
));
create policy template_shift_manager_write on public.schedule_template_shifts for all to authenticated
using (exists (
  select 1 from public.schedule_templates t
  where t.id = template_id and public.can_manage_location(t.organization_id, t.location_id)
))
with check (exists (
  select 1 from public.schedule_templates t
  where t.id = template_id and public.can_manage_location(t.organization_id, t.location_id)
));

create policy shift_ack_read on public.shift_acknowledgements for select to authenticated
using (public.is_self_employee(employee_id) or public.can_read_management_org(organization_id));
create policy shift_ack_self_insert on public.shift_acknowledgements for insert to authenticated
with check (
  public.is_self_employee(employee_id)
  and exists (select 1 from public.shifts s where s.id = shift_id and s.employee_id = employee_id)
);
create policy shift_ack_self_delete on public.shift_acknowledgements for delete to authenticated
using (public.is_self_employee(employee_id));

create policy swap_staff_read on public.shift_swap_requests for select to authenticated
using (public.can_access_location(organization_id, location_id));
create policy swap_self_insert on public.shift_swap_requests for insert to authenticated
with check (public.is_self_employee(requested_by_employee_id) and status = 'pending');
create policy swap_self_update on public.shift_swap_requests for update to authenticated
using (public.is_self_employee(requested_by_employee_id) and status in ('pending', 'cancelled'))
with check (public.is_self_employee(requested_by_employee_id) and status in ('pending', 'cancelled'));
create policy swap_manager_write on public.shift_swap_requests for all to authenticated
using (public.can_manage_location(organization_id, location_id))
with check (public.can_manage_location(organization_id, location_id));

create policy swap_offer_read on public.shift_swap_offers for select to authenticated
using (exists (
  select 1 from public.shift_swap_requests r
  where r.id = swap_request_id and public.can_access_location(r.organization_id, r.location_id)
));
create policy swap_offer_self_insert on public.shift_swap_offers for insert to authenticated
with check (public.is_self_employee(offered_by_employee_id) and status = 'pending');
create policy swap_offer_self_update on public.shift_swap_offers for update to authenticated
using (public.is_self_employee(offered_by_employee_id) and status in ('pending', 'cancelled'))
with check (public.is_self_employee(offered_by_employee_id) and status in ('pending', 'cancelled'));
create policy swap_offer_manager_write on public.shift_swap_offers for all to authenticated
using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id));

-- Chat visibility is derived from channel kind and explicit channel membership.
create policy channel_read on public.chat_channels for select to authenticated
using (public.can_access_channel(id));
create policy channel_manager_insert on public.chat_channels for insert to authenticated
with check (public.can_operate_org(organization_id) and created_by = auth.uid());
create policy channel_manager_update on public.chat_channels for update to authenticated
using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id));
create policy channel_manager_delete on public.chat_channels for delete to authenticated
using (public.can_manage_org(organization_id));

create policy channel_member_read on public.chat_channel_members for select to authenticated
using (public.can_access_channel(channel_id));
create policy channel_member_manager_write on public.chat_channel_members for all to authenticated
using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id));

create policy message_read on public.chat_messages for select to authenticated
using (public.can_access_channel(channel_id));
create policy message_author_insert on public.chat_messages for insert to authenticated
with check (
  author_id = auth.uid() and public.can_access_channel(channel_id)
  and (not is_announcement or public.can_read_management_org(organization_id))
);
create policy message_author_update on public.chat_messages for update to authenticated
using (author_id = auth.uid() and public.can_access_channel(channel_id))
with check (
  author_id = auth.uid() and public.can_access_channel(channel_id)
  and (not is_announcement or public.can_read_management_org(organization_id))
);
create policy message_author_delete on public.chat_messages for delete to authenticated
using (author_id = auth.uid() and public.can_access_channel(channel_id));

create policy attachment_read on public.chat_attachments for select to authenticated
using (exists (select 1 from public.chat_messages m where m.id = message_id and public.can_access_channel(m.channel_id)));
create policy attachment_author_insert on public.chat_attachments for insert to authenticated
with check (uploaded_by = auth.uid() and exists (
  select 1 from public.chat_messages m where m.id = message_id and m.author_id = auth.uid() and public.can_access_channel(m.channel_id)
));
create policy attachment_author_delete on public.chat_attachments for delete to authenticated
using (uploaded_by = auth.uid());

create policy reaction_read on public.chat_reactions for select to authenticated
using (exists (select 1 from public.chat_messages m where m.id = message_id and public.can_access_channel(m.channel_id)));
create policy reaction_self_insert on public.chat_reactions for insert to authenticated
with check (user_id = auth.uid() and exists (select 1 from public.chat_messages m where m.id = message_id and public.can_access_channel(m.channel_id)));
create policy reaction_self_delete on public.chat_reactions for delete to authenticated
using (user_id = auth.uid());

create policy read_receipt_read on public.chat_read_receipts for select to authenticated
using (user_id = auth.uid() or public.can_access_channel(channel_id));
create policy read_receipt_self_insert on public.chat_read_receipts for insert to authenticated
with check (user_id = auth.uid() and public.can_access_channel(channel_id));
create policy read_receipt_self_update on public.chat_read_receipts for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid() and public.can_access_channel(channel_id));
create policy read_receipt_self_delete on public.chat_read_receipts for delete to authenticated
using (user_id = auth.uid());

create policy announcement_ack_read on public.announcement_acknowledgements for select to authenticated
using (user_id = auth.uid() or exists (select 1 from public.chat_messages m where m.id = message_id and public.can_access_channel(m.channel_id)));
create policy announcement_ack_self_insert on public.announcement_acknowledgements for insert to authenticated
with check (user_id = auth.uid() and exists (
  select 1 from public.chat_messages m where m.id = message_id and m.is_announcement and public.can_access_channel(m.channel_id)
));
create policy announcement_ack_self_delete on public.announcement_acknowledgements for delete to authenticated
using (user_id = auth.uid());

-- Time clock: employees own their punches; assigned management can review/correct.
create policy time_entry_read on public.time_entries for select to authenticated
using (public.is_self_employee(employee_id) or public.can_read_management_location(organization_id, location_id));
create policy time_entry_self_insert on public.time_entries for insert to authenticated
with check (
  public.is_self_employee(employee_id)
  and public.can_access_location(organization_id, location_id)
  and source = 'employee' and status = 'open'
);
create policy time_entry_self_update on public.time_entries for update to authenticated
using (public.is_self_employee(employee_id) and status in ('open', 'submitted'))
with check (
  public.is_self_employee(employee_id)
  and public.can_access_location(organization_id, location_id)
  and source = 'employee' and status in ('open', 'submitted')
);
create policy time_entry_manager_write on public.time_entries for all to authenticated
using (public.can_manage_location(organization_id, location_id))
with check (public.can_manage_location(organization_id, location_id));

create policy break_read on public.time_breaks for select to authenticated
using (exists (
  select 1 from public.time_entries e where e.id = time_entry_id
    and (public.is_self_employee(e.employee_id) or public.can_read_management_location(e.organization_id, e.location_id))
));
create policy break_self_insert on public.time_breaks for insert to authenticated
with check (source = 'employee' and exists (
  select 1 from public.time_entries e where e.id = time_entry_id and public.is_self_employee(e.employee_id) and e.status = 'open'
));
create policy break_self_update on public.time_breaks for update to authenticated
using (source = 'employee' and exists (
  select 1 from public.time_entries e where e.id = time_entry_id and public.is_self_employee(e.employee_id) and e.status = 'open'
)) with check (source = 'employee');
create policy break_manager_write on public.time_breaks for all to authenticated
using (exists (select 1 from public.time_entries e where e.id = time_entry_id and public.can_manage_location(e.organization_id, e.location_id)))
with check (exists (select 1 from public.time_entries e where e.id = time_entry_id and public.can_manage_location(e.organization_id, e.location_id)));

create policy correction_read on public.time_entry_corrections for select to authenticated
using (requested_by = auth.uid() or public.can_read_management_location(organization_id, location_id));
create policy correction_self_insert on public.time_entry_corrections for insert to authenticated
with check (requested_by = auth.uid() and status = 'pending' and exists (
  select 1 from public.time_entries e where e.id = time_entry_id and public.is_self_employee(e.employee_id)
));
create policy correction_self_update on public.time_entry_corrections for update to authenticated
using (requested_by = auth.uid() and status in ('pending', 'cancelled'))
with check (requested_by = auth.uid() and status in ('pending', 'cancelled') and decided_by is null);
create policy correction_manager_write on public.time_entry_corrections for all to authenticated
using (public.can_manage_location(organization_id, location_id))
with check (public.can_manage_location(organization_id, location_id));

-- Location-management domain tables.
do $manager_location_tables$
declare t text;
begin
  foreach t in array array[
    'shift_closeouts', 'receipts', 'expenses', 'purchase_orders', 'deliveries',
    'inventory_par_levels', 'inventory_counts', 'inventory_transactions', 'waste_records',
    'cogs_periods', 'guest_visits', 'reservations'
  ]
  loop
    execute format('create policy manager_location_read on public.%I for select to authenticated using (public.can_read_management_location(organization_id, location_id))', t);
    execute format('create policy manager_location_insert on public.%I for insert to authenticated with check (public.can_manage_location(organization_id, location_id))', t);
    execute format('create policy manager_location_update on public.%I for update to authenticated using (public.can_manage_location(organization_id, location_id)) with check (public.can_manage_location(organization_id, location_id))', t);
    execute format('create policy manager_location_delete on public.%I for delete to authenticated using (public.can_manage_location(organization_id, location_id))', t);
  end loop;
end
$manager_location_tables$;

-- Tip policies can be organization-wide or location-specific.
do $tip_policy_tables$
declare t text;
begin
  foreach t in array array['tip_pool_policies']
  loop
    execute format('create policy tip_policy_read on public.%I for select to authenticated using ((location_id is null and public.can_read_management_org(organization_id)) or public.can_read_management_location(organization_id, location_id))', t);
    execute format('create policy tip_policy_insert on public.%I for insert to authenticated with check ((location_id is null and public.can_operate_org(organization_id)) or public.can_manage_location(organization_id, location_id))', t);
    execute format('create policy tip_policy_update on public.%I for update to authenticated using ((location_id is null and public.can_operate_org(organization_id)) or public.can_manage_location(organization_id, location_id)) with check ((location_id is null and public.can_operate_org(organization_id)) or public.can_manage_location(organization_id, location_id))', t);
    execute format('create policy tip_policy_delete on public.%I for delete to authenticated using ((location_id is null and public.can_operate_org(organization_id)) or public.can_manage_location(organization_id, location_id))', t);
  end loop;
end
$tip_policy_tables$;

create policy tip_version_read on public.tip_pool_policy_versions for select to authenticated
using (public.can_read_management_org(organization_id));
create policy tip_version_write on public.tip_pool_policy_versions for all to authenticated
using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id));
create policy tip_rule_read on public.tip_pool_eligibility_rules for select to authenticated
using (public.can_read_management_org(organization_id));
create policy tip_rule_write on public.tip_pool_eligibility_rules for all to authenticated
using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id));

create policy tip_run_read on public.tip_runs for select to authenticated
using (public.can_read_management_location(organization_id, location_id));
create policy tip_run_write on public.tip_runs for all to authenticated
using (public.can_manage_location(organization_id, location_id)) with check (public.can_manage_location(organization_id, location_id));

do $tip_run_children$
declare t text;
begin
  foreach t in array array['tip_sources', 'tip_run_participants', 'tip_adjustments', 'tip_allocations']
  loop
    execute format('create policy tip_child_manager_read on public.%I for select to authenticated using (exists (select 1 from public.tip_runs r where r.id = tip_run_id and public.can_read_management_location(r.organization_id, r.location_id)))', t);
    execute format('create policy tip_child_manager_write on public.%I for all to authenticated using (exists (select 1 from public.tip_runs r where r.id = tip_run_id and public.can_manage_location(r.organization_id, r.location_id))) with check (exists (select 1 from public.tip_runs r where r.id = tip_run_id and public.can_manage_location(r.organization_id, r.location_id)))', t);
  end loop;
end
$tip_run_children$;
create policy tip_allocation_self_read on public.tip_allocations for select to authenticated
using (public.is_self_employee(employee_id));

create policy payroll_admin_read on public.payroll_exports for select to authenticated
using (public.can_manage_org(organization_id));
create policy payroll_admin_write on public.payroll_exports for all to authenticated
using (public.can_manage_org(organization_id)) with check (public.can_manage_org(organization_id));

-- Parent-derived finance/inventory access.
do $receipt_children$
declare t text;
begin
  foreach t in array array['receipt_files', 'receipt_ocr_runs', 'receipt_extractions', 'receipt_duplicate_matches']
  loop
    execute format('create policy receipt_child_read on public.%I for select to authenticated using (exists (select 1 from public.receipts r where r.id = receipt_id and public.can_read_management_location(r.organization_id, r.location_id)))', t);
    execute format('create policy receipt_child_write on public.%I for all to authenticated using (exists (select 1 from public.receipts r where r.id = receipt_id and public.can_manage_location(r.organization_id, r.location_id))) with check (exists (select 1 from public.receipts r where r.id = receipt_id and public.can_manage_location(r.organization_id, r.location_id)))', t);
  end loop;
end
$receipt_children$;

create policy closeout_attachment_read on public.closeout_attachments for select to authenticated
using (exists (select 1 from public.shift_closeouts c where c.id = closeout_id and public.can_read_management_location(c.organization_id, c.location_id)));
create policy closeout_attachment_write on public.closeout_attachments for all to authenticated
using (exists (select 1 from public.shift_closeouts c where c.id = closeout_id and public.can_manage_location(c.organization_id, c.location_id)))
with check (exists (select 1 from public.shift_closeouts c where c.id = closeout_id and public.can_manage_location(c.organization_id, c.location_id)));

do $inventory_org_tables$
declare t text;
begin
  foreach t in array array[
    'vendors', 'expense_categories', 'measurement_units', 'unit_conversions',
    'inventory_categories', 'inventory_items', 'vendor_items', 'item_price_history',
    'recipes', 'recipe_ingredients'
  ]
  loop
    execute format('create policy inventory_manager_read on public.%I for select to authenticated using (public.can_read_management_org(organization_id))', t);
    execute format('create policy inventory_manager_write on public.%I for all to authenticated using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id))', t);
  end loop;
end
$inventory_org_tables$;

create policy po_line_read on public.purchase_order_lines for select to authenticated
using (exists (select 1 from public.purchase_orders p where p.id = purchase_order_id and public.can_read_management_location(p.organization_id, p.location_id)));
create policy po_line_write on public.purchase_order_lines for all to authenticated
using (exists (select 1 from public.purchase_orders p where p.id = purchase_order_id and public.can_manage_location(p.organization_id, p.location_id)))
with check (exists (select 1 from public.purchase_orders p where p.id = purchase_order_id and public.can_manage_location(p.organization_id, p.location_id)));
create policy delivery_line_read on public.delivery_lines for select to authenticated
using (exists (select 1 from public.deliveries d where d.id = delivery_id and public.can_read_management_location(d.organization_id, d.location_id)));
create policy delivery_line_write on public.delivery_lines for all to authenticated
using (exists (select 1 from public.deliveries d where d.id = delivery_id and public.can_manage_location(d.organization_id, d.location_id)))
with check (exists (select 1 from public.deliveries d where d.id = delivery_id and public.can_manage_location(d.organization_id, d.location_id)));
create policy count_line_read on public.inventory_count_lines for select to authenticated
using (exists (select 1 from public.inventory_counts c where c.id = inventory_count_id and public.can_read_management_location(c.organization_id, c.location_id)));
create policy count_line_write on public.inventory_count_lines for all to authenticated
using (exists (select 1 from public.inventory_counts c where c.id = inventory_count_id and public.can_manage_location(c.organization_id, c.location_id)))
with check (exists (select 1 from public.inventory_counts c where c.id = inventory_count_id and public.can_manage_location(c.organization_id, c.location_id)));

create policy transfer_read on public.inventory_transfers for select to authenticated
using (
  public.can_read_management_location(organization_id, from_location_id)
  or public.can_read_management_location(organization_id, to_location_id)
);
create policy transfer_write on public.inventory_transfers for all to authenticated
using (
  public.can_manage_location(organization_id, from_location_id)
  and public.can_manage_location(organization_id, to_location_id)
) with check (
  public.can_manage_location(organization_id, from_location_id)
  and public.can_manage_location(organization_id, to_location_id)
);
create policy transfer_line_read on public.inventory_transfer_lines for select to authenticated
using (exists (
  select 1 from public.inventory_transfers t where t.id = transfer_id
  and (public.can_read_management_location(t.organization_id, t.from_location_id) or public.can_read_management_location(t.organization_id, t.to_location_id))
));
create policy transfer_line_write on public.inventory_transfer_lines for all to authenticated
using (exists (
  select 1 from public.inventory_transfers t where t.id = transfer_id
  and public.can_manage_location(t.organization_id, t.from_location_id) and public.can_manage_location(t.organization_id, t.to_location_id)
)) with check (exists (
  select 1 from public.inventory_transfers t where t.id = transfer_id
  and public.can_manage_location(t.organization_id, t.from_location_id) and public.can_manage_location(t.organization_id, t.to_location_id)
));

-- Unified guest CRM is management-only and tenant-wide by design.
do $crm_tables$
declare t text;
begin
  foreach t in array array[
    'guests', 'guest_locations', 'guest_contacts', 'guest_tags', 'guest_tag_assignments',
    'guest_notes', 'guest_consents', 'guest_merge_events'
  ]
  loop
    execute format('create policy crm_manager_read on public.%I for select to authenticated using (public.can_read_management_org(organization_id))', t);
    execute format('create policy crm_manager_write on public.%I for all to authenticated using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id))', t);
  end loop;
end
$crm_tables$;

-- Tasks, checklists, SOPs, maintenance, and incidents.
create policy task_read on public.tasks for select to authenticated
using ((location_id is null and public.can_access_org(organization_id)) or public.can_access_location(organization_id, location_id));
create policy task_manager_write on public.tasks for all to authenticated
using ((location_id is null and public.can_operate_org(organization_id)) or public.can_manage_location(organization_id, location_id))
with check ((location_id is null and public.can_operate_org(organization_id)) or public.can_manage_location(organization_id, location_id));
create policy task_assignee_update on public.tasks for update to authenticated
using (public.is_self_employee(assigned_employee_id))
with check (public.is_self_employee(assigned_employee_id));

create policy checklist_template_read on public.checklist_templates for select to authenticated
using ((location_id is null and public.can_access_org(organization_id)) or public.can_access_location(organization_id, location_id));
create policy checklist_template_manager_write on public.checklist_templates for all to authenticated
using ((location_id is null and public.can_operate_org(organization_id)) or public.can_manage_location(organization_id, location_id))
with check ((location_id is null and public.can_operate_org(organization_id)) or public.can_manage_location(organization_id, location_id));
create policy checklist_item_read on public.checklist_template_items for select to authenticated
using (exists (
  select 1 from public.checklist_templates t where t.id = template_id
  and ((t.location_id is null and public.can_access_org(t.organization_id)) or public.can_access_location(t.organization_id, t.location_id))
));
create policy checklist_item_manager_write on public.checklist_template_items for all to authenticated
using (exists (select 1 from public.checklist_templates t where t.id = template_id and public.can_operate_org(t.organization_id)))
with check (exists (select 1 from public.checklist_templates t where t.id = template_id and public.can_operate_org(t.organization_id)));
create policy checklist_run_read on public.checklist_runs for select to authenticated
using (public.can_access_location(organization_id, location_id));
create policy checklist_run_manager_write on public.checklist_runs for all to authenticated
using (public.can_manage_location(organization_id, location_id)) with check (public.can_manage_location(organization_id, location_id));
create policy checklist_run_assignee_update on public.checklist_runs for update to authenticated
using (public.is_self_employee(assigned_employee_id)) with check (public.is_self_employee(assigned_employee_id));
create policy checklist_response_read on public.checklist_responses for select to authenticated
using (exists (select 1 from public.checklist_runs r where r.id = checklist_run_id and public.can_access_location(r.organization_id, r.location_id)));
create policy checklist_response_staff_insert on public.checklist_responses for insert to authenticated
with check (responded_by = auth.uid() and exists (select 1 from public.checklist_runs r where r.id = checklist_run_id and public.can_access_location(r.organization_id, r.location_id)));
create policy checklist_response_owner_update on public.checklist_responses for update to authenticated
using (responded_by = auth.uid()) with check (responded_by = auth.uid());
create policy checklist_response_manager_write on public.checklist_responses for all to authenticated
using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id));

create policy sop_read on public.sop_documents for select to authenticated
using (is_published and ((location_id is null and public.can_access_org(organization_id)) or public.can_access_location(organization_id, location_id)) or public.can_read_management_org(organization_id));
create policy sop_manager_write on public.sop_documents for all to authenticated
using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id));
create policy sop_version_read on public.sop_versions for select to authenticated
using (exists (select 1 from public.sop_documents d where d.id = sop_document_id and (
  (d.is_published and ((d.location_id is null and public.can_access_org(d.organization_id)) or public.can_access_location(d.organization_id, d.location_id)))
  or public.can_read_management_org(d.organization_id)
)));
create policy sop_version_manager_write on public.sop_versions for all to authenticated
using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id));
create policy sop_ack_read on public.sop_acknowledgements for select to authenticated
using (public.is_self_employee(employee_id) or public.can_read_management_org(organization_id));
create policy sop_ack_self_insert on public.sop_acknowledgements for insert to authenticated
with check (public.is_self_employee(employee_id));

create policy maintenance_staff_read on public.maintenance_requests for select to authenticated
using (public.can_access_location(organization_id, location_id));
create policy maintenance_staff_insert on public.maintenance_requests for insert to authenticated
with check (reported_by = auth.uid() and public.can_access_location(organization_id, location_id));
create policy maintenance_manager_write on public.maintenance_requests for all to authenticated
using (public.can_manage_location(organization_id, location_id)) with check (public.can_manage_location(organization_id, location_id));

create policy incident_read on public.incidents for select to authenticated
using (reported_by = auth.uid() or public.can_read_management_location(organization_id, location_id));
create policy incident_staff_insert on public.incidents for insert to authenticated
with check (reported_by = auth.uid() and public.can_access_location(organization_id, location_id));
create policy incident_manager_write on public.incidents for all to authenticated
using (public.can_manage_location(organization_id, location_id)) with check (public.can_manage_location(organization_id, location_id));
create policy incident_attachment_read on public.incident_attachments for select to authenticated
using (exists (select 1 from public.incidents i where i.id = incident_id and (i.reported_by = auth.uid() or public.can_read_management_location(i.organization_id, i.location_id))));
create policy incident_attachment_insert on public.incident_attachments for insert to authenticated
with check (uploaded_by = auth.uid() and exists (select 1 from public.incidents i where i.id = incident_id and (i.reported_by = auth.uid() or public.can_manage_location(i.organization_id, i.location_id))));
create policy incident_attachment_manager_delete on public.incident_attachments for delete to authenticated
using (public.can_operate_org(organization_id));

-- Reports, integration adapters, and imports.
do $report_tables$
declare t text;
begin
  foreach t in array array['saved_reports', 'report_runs', 'export_jobs']
  loop
    execute format('create policy report_manager_read on public.%I for select to authenticated using (public.can_read_management_org(organization_id))', t);
    execute format('create policy report_manager_write on public.%I for all to authenticated using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id))', t);
  end loop;
end
$report_tables$;

do $admin_integration_tables$
declare t text;
begin
  foreach t in array array[
    'integration_connections', 'integration_sync_jobs', 'integration_sync_records',
    'import_jobs', 'import_rows', 'integration_events'
  ]
  loop
    execute format('create policy integration_admin_read on public.%I for select to authenticated using (public.can_manage_org(organization_id))', t);
    execute format('create policy integration_admin_write on public.%I for all to authenticated using (public.can_manage_org(organization_id)) with check (public.can_manage_org(organization_id))', t);
  end loop;
end
$admin_integration_tables$;

-- AI records are evidence-bound and only management can access them.
do $ai_tables$
declare t text;
begin
  foreach t in array array['ai_runs', 'ai_citations', 'ai_action_proposals']
  loop
    execute format('create policy ai_manager_read on public.%I for select to authenticated using (public.can_read_management_org(organization_id))', t);
    execute format('create policy ai_manager_write on public.%I for all to authenticated using (public.can_operate_org(organization_id)) with check (public.can_operate_org(organization_id))', t);
  end loop;
end
$ai_tables$;

-- Per-user notification state. Server processes may insert through service_role.
create policy notification_self_read on public.notifications for select to authenticated
using (user_id = auth.uid() and public.can_access_org(organization_id));
create policy notification_self_update on public.notifications for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_manager_insert on public.notifications for insert to authenticated
with check (public.can_operate_org(organization_id));

create policy notification_preference_self on public.notification_preferences for all to authenticated
using (user_id = auth.uid() and public.can_access_org(organization_id))
with check (user_id = auth.uid() and public.can_access_org(organization_id));
create policy push_subscription_self on public.push_subscriptions for all to authenticated
using (user_id = auth.uid() and public.can_access_org(organization_id))
with check (user_id = auth.uid() and public.can_access_org(organization_id));

create policy error_manager_read on public.application_errors for select to authenticated
using (organization_id is not null and public.can_read_management_org(organization_id));
create policy error_manager_update on public.application_errors for update to authenticated
using (organization_id is not null and public.can_operate_org(organization_id))
with check (organization_id is not null and public.can_operate_org(organization_id));
create policy backup_admin_read on public.backup_runs for select to authenticated
using (organization_id is not null and public.can_manage_org(organization_id));
create policy data_export_admin_read on public.data_export_requests for select to authenticated
using (public.can_manage_org(organization_id));
create policy data_export_admin_write on public.data_export_requests for all to authenticated
using (public.can_manage_org(organization_id)) with check (public.can_manage_org(organization_id));

-- Object paths are always {organization_uuid}/{location_uuid|global}/...
create function public.storage_organization_id(p_name text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 1)::uuid
    else null
  end
$$;

create function public.storage_location_id(p_name text)
returns uuid
language sql immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then split_part(p_name, '/', 2)::uuid
    else null
  end
$$;

grant execute on function public.storage_organization_id(text) to authenticated;
grant execute on function public.storage_location_id(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-avatars', 'profile-avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('employee-documents', 'employee-documents', false, 26214400, null),
  ('chat-attachments', 'chat-attachments', false, 26214400, null),
  ('receipts', 'receipts', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('closeouts', 'closeouts', false, 26214400, null),
  ('inventory', 'inventory', false, 52428800, null),
  ('sops', 'sops', false, 52428800, null),
  ('incidents', 'incidents', false, 52428800, null),
  ('reports', 'reports', false, 52428800, null),
  ('imports', 'imports', false, 104857600, null),
  ('checklists', 'checklists', false, 26214400, null)
on conflict (id) do update set public = false;

create policy storage_avatar_read on storage.objects for select to authenticated
using (bucket_id = 'profile-avatars' and public.can_access_org(public.storage_organization_id(name)));
create policy storage_avatar_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and public.can_access_org(public.storage_organization_id(name))
  and split_part(name, '/', 3) like auth.uid()::text || '.%'
);
create policy storage_avatar_update on storage.objects for update to authenticated
using (bucket_id = 'profile-avatars' and split_part(name, '/', 3) like auth.uid()::text || '.%')
with check (bucket_id = 'profile-avatars' and split_part(name, '/', 3) like auth.uid()::text || '.%');
create policy storage_avatar_delete on storage.objects for delete to authenticated
using (bucket_id = 'profile-avatars' and split_part(name, '/', 3) like auth.uid()::text || '.%');

create policy storage_chat_read on storage.objects for select to authenticated
using (
  bucket_id = 'chat-attachments'
  and exists (select 1 from public.chat_attachments a where a.storage_path = name and public.can_access_org(a.organization_id))
);
create policy storage_chat_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-attachments'
  and public.can_access_org(public.storage_organization_id(name))
  and (public.storage_location_id(name) is null or public.can_access_location(public.storage_organization_id(name), public.storage_location_id(name)))
);
create policy storage_chat_delete on storage.objects for delete to authenticated
using (bucket_id = 'chat-attachments' and owner_id = auth.uid()::text);

create policy storage_employee_document_read on storage.objects for select to authenticated
using (
  bucket_id = 'employee-documents'
  and exists (
    select 1 from public.employee_documents d
    where d.storage_path = name and (public.is_self_employee(d.employee_id) or public.can_read_management_org(d.organization_id))
  )
);

create policy storage_staff_sop_read on storage.objects for select to authenticated
using (
  bucket_id = 'sops'
  and public.can_access_org(public.storage_organization_id(name))
  and (public.storage_location_id(name) is null or public.can_access_location(public.storage_organization_id(name), public.storage_location_id(name)))
);

create policy storage_manager_read on storage.objects for select to authenticated
using (
  bucket_id in ('receipts', 'closeouts', 'inventory', 'incidents', 'reports', 'imports', 'checklists')
  and public.can_read_management_org(public.storage_organization_id(name))
  and (public.storage_location_id(name) is null or public.can_read_management_location(public.storage_organization_id(name), public.storage_location_id(name)))
);
create policy storage_manager_insert on storage.objects for insert to authenticated
with check (
  bucket_id in ('employee-documents', 'receipts', 'closeouts', 'inventory', 'sops', 'incidents', 'reports', 'imports', 'checklists')
  and public.can_operate_org(public.storage_organization_id(name))
  and (public.storage_location_id(name) is null or public.can_manage_location(public.storage_organization_id(name), public.storage_location_id(name)))
);
create policy storage_manager_update on storage.objects for update to authenticated
using (
  bucket_id in ('employee-documents', 'receipts', 'closeouts', 'inventory', 'sops', 'incidents', 'reports', 'imports', 'checklists')
  and public.can_operate_org(public.storage_organization_id(name))
) with check (
  bucket_id in ('employee-documents', 'receipts', 'closeouts', 'inventory', 'sops', 'incidents', 'reports', 'imports', 'checklists')
  and public.can_operate_org(public.storage_organization_id(name))
);
create policy storage_manager_delete on storage.objects for delete to authenticated
using (
  bucket_id in ('employee-documents', 'receipts', 'closeouts', 'inventory', 'sops', 'incidents', 'reports', 'imports', 'checklists')
  and public.can_operate_org(public.storage_organization_id(name))
);

comment on schema private is 'Not exposed by the API. Only server/database roles may handle credential ciphertext.';
