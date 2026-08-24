-- Owner-only Codex subscription intelligence. Model output is evidence only:
-- it may create an immutable proposal, but an authenticated owner must submit
-- the matching payload fingerprint before an existing domain command executes.

create table private.intelligence_operator_authorizations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'codex_subscription'
    check (provider = 'codex_subscription'),
  can_execute_actions boolean not null default false,
  is_enabled boolean not null default true,
  authorized_by uuid references auth.users(id) on delete restrict,
  authorized_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, user_id)
);

revoke all on private.intelligence_operator_authorizations
from public, anon, authenticated;

-- The first pilot is intentionally bound to Donald's existing owner identity.
-- A second operator must be added as an explicit later rollout decision.
insert into private.intelligence_operator_authorizations (
  organization_id, user_id, can_execute_actions, authorized_by
)
select membership.organization_id, membership.user_id, true, membership.user_id
from public.organization_memberships membership
join auth.users app_user on app_user.id = membership.user_id
where membership.role = 'owner'
  and membership.status = 'active'
  and lower(app_user.email) = 'donaldlena@le-yard.local'
on conflict (organization_id, user_id) do update
set can_execute_actions = excluded.can_execute_actions,
    is_enabled = true,
    authorized_by = excluded.authorized_by,
    authorized_at = clock_timestamp();

create function public.can_use_owner_intelligence(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from private.intelligence_operator_authorizations operator_auth
    join public.organization_memberships membership
      on membership.organization_id = operator_auth.organization_id
     and membership.user_id = operator_auth.user_id
    where operator_auth.organization_id = p_organization_id
      and operator_auth.user_id = auth.uid()
      and operator_auth.is_enabled
      and membership.role = 'owner'
      and membership.status = 'active'
      and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  )
$$;

create function public.can_execute_owner_intelligence(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.can_use_owner_intelligence(p_organization_id)
    and exists (
      select 1
      from private.intelligence_operator_authorizations operator_auth
      where operator_auth.organization_id = p_organization_id
        and operator_auth.user_id = auth.uid()
        and operator_auth.is_enabled
        and operator_auth.can_execute_actions
    )
$$;

revoke all on function public.can_use_owner_intelligence(uuid)
from public, anon, authenticated;
revoke all on function public.can_execute_owner_intelligence(uuid)
from public, anon, authenticated;
grant execute on function public.can_use_owner_intelligence(uuid) to authenticated;
grant execute on function public.can_execute_owner_intelligence(uuid) to authenticated;

do $restrict_ai_records_to_authorized_owner$
declare table_name text;
begin
  foreach table_name in array array['ai_runs', 'ai_citations', 'ai_action_proposals']
  loop
    execute format('drop policy if exists ai_manager_read on public.%I', table_name);
    execute format('drop policy if exists ai_manager_write on public.%I', table_name);
  end loop;
end
$restrict_ai_records_to_authorized_owner$;

create policy ai_owner_operator_read
on public.ai_runs for select to authenticated
using (
  requested_by = auth.uid()
  and public.can_use_owner_intelligence(organization_id)
);

create policy ai_owner_operator_citation_read
on public.ai_citations for select to authenticated
using (
  public.can_use_owner_intelligence(organization_id)
  and exists (
    select 1 from public.ai_runs run
    where run.organization_id = ai_citations.organization_id
      and run.id = ai_citations.ai_run_id
      and run.requested_by = auth.uid()
  )
);

create policy ai_owner_operator_proposal_read
on public.ai_action_proposals for select to authenticated
using (
  public.can_use_owner_intelligence(organization_id)
  and exists (
    select 1 from public.ai_runs run
    where run.organization_id = ai_action_proposals.organization_id
      and run.id = ai_action_proposals.ai_run_id
      and run.requested_by = auth.uid()
  )
);

revoke insert, update, delete on public.ai_runs from authenticated;
revoke insert, update, delete on public.ai_citations from authenticated;
revoke insert, update, delete on public.ai_action_proposals from authenticated;
grant select on public.ai_runs, public.ai_citations, public.ai_action_proposals
to authenticated;

alter table public.ai_action_proposals
  add column if not exists reverted_by uuid references auth.users(id) on delete set null,
  add column if not exists reverted_at timestamptz,
  add column if not exists reversion_note text,
  add column if not exists reversion_request_id uuid,
  add constraint ai_action_proposals_reversion_evidence
    check (
      (reverted_at is null and reverted_by is null and reversion_request_id is null)
      or
      (reverted_at is not null and reverted_by is not null and reversion_request_id is not null)
    );

create function public.begin_owner_intelligence_run(
  p_request_id uuid,
  p_location_id uuid,
  p_prompt text,
  p_input_parameters jsonb default '{}'::jsonb
)
returns public.ai_runs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  run_row public.ai_runs%rowtype;
  clean_prompt text := btrim(coalesce(p_prompt, ''));
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_location_id is null
    or length(clean_prompt) not between 2 and 2000
    or jsonb_typeof(p_input_parameters) <> 'object'
    or pg_column_size(p_input_parameters) > 1000000 then
    raise exception 'A valid intelligence request is required' using errcode = '22023';
  end if;
  select * into location_row from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_use_owner_intelligence(location_row.organization_id) then
    raise exception 'Owner intelligence access is required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.ai_runs run
    where run.organization_id = location_row.organization_id
      and run.requested_by = actor_id
      and run.status = 'running'
      and run.created_at > clock_timestamp() - interval '10 minutes'
  ) then
    raise exception 'Another owner intelligence request is still running'
      using errcode = '55000';
  end if;
  if (
    select count(*) from public.ai_runs run
    where run.organization_id = location_row.organization_id
      and run.requested_by = actor_id
      and run.created_at > clock_timestamp() - interval '1 hour'
  ) >= 12 then
    raise exception 'Owner intelligence is limited to 12 requests per hour'
      using errcode = '54000';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'owner-intelligence.run.begin',
    location_row.organization_id,
    location_row.id,
    p_request_id,
    jsonb_build_object('prompt', clean_prompt, 'input', p_input_parameters)
  ) then
    select * into run_row from public.ai_runs run
    where run.id = p_request_id and run.requested_by = actor_id;
    if run_row.id is not null then return run_row; end if;
    raise exception 'Intelligence request has no result row' using errcode = '40001';
  end if;
  insert into public.ai_runs (
    id, organization_id, location_id, kind, status, prompt, model,
    input_parameters, requested_by, started_at
  ) values (
    p_request_id, location_row.organization_id, location_row.id,
    'natural_language_search', 'running', clean_prompt,
    'codex-subscription:gpt-5.6-luna', p_input_parameters, actor_id,
    clock_timestamp()
  ) returning * into run_row;
  perform private.complete_operation_request(p_request_id);
  return run_row;
end
$$;

create function public.complete_owner_intelligence_run(
  p_request_id uuid,
  p_ai_run_id uuid,
  p_output jsonb,
  p_confidence numeric,
  p_citations jsonb,
  p_proposal jsonb default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  run_row public.ai_runs%rowtype;
  citation jsonb;
  proposal_id uuid;
  canonical_change jsonb;
  confirmation_fingerprint text;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into run_row from public.ai_runs run
  where run.id = p_ai_run_id and run.requested_by = actor_id
  for update;
  if run_row.id is null or not public.can_use_owner_intelligence(run_row.organization_id) then
    raise exception 'Intelligence run not found' using errcode = 'P0002';
  end if;
  if run_row.status = 'succeeded' then
    select proposal.id into proposal_id from public.ai_action_proposals proposal
    where proposal.ai_run_id = run_row.id order by proposal.created_at limit 1;
    if proposal_id is not null then
      select encode(extensions.digest(proposal.proposed_change::text, 'sha256'), 'hex')
      into confirmation_fingerprint from public.ai_action_proposals proposal
      where proposal.id = proposal_id;
    end if;
    return jsonb_build_object(
      'runId', run_row.id, 'proposalId', proposal_id,
      'confirmationFingerprint', confirmation_fingerprint, 'replayed', true
    );
  end if;
  if run_row.status <> 'running'
    or jsonb_typeof(p_output) <> 'object'
    or p_confidence not between 0 and 1
    or jsonb_typeof(p_citations) <> 'array'
    or jsonb_array_length(p_citations) > 12
    or pg_column_size(p_output) > 200000 then
    raise exception 'Invalid intelligence result' using errcode = '22023';
  end if;
  if not private.claim_operation_request(
    p_request_id, 'owner-intelligence.run.complete', run_row.organization_id,
    run_row.location_id, run_row.id,
    jsonb_build_object(
      'runId', run_row.id, 'output', p_output, 'confidence', p_confidence,
      'citations', p_citations, 'proposal', p_proposal
    )
  ) then
    raise exception 'Completion request was replayed before the run completed'
      using errcode = '40001';
  end if;
  update public.ai_runs run set
    status = 'succeeded', output = p_output, confidence = p_confidence,
    completed_at = clock_timestamp(), error_message = null
  where run.id = run_row.id;

  for citation in select value from jsonb_array_elements(p_citations)
  loop
    if jsonb_typeof(citation) <> 'object'
      or nullif(btrim(citation ->> 'sourceTable'), '') is null
      or nullif(btrim(citation ->> 'sourceRecordId'), '') is null
      or length(coalesce(citation ->> 'sourceTable', '')) > 120
      or length(coalesce(citation ->> 'sourceRecordId', '')) > 240
      or length(coalesce(citation ->> 'label', '')) > 240
      or length(coalesce(citation ->> 'excerpt', '')) > 2000 then
      raise exception 'Invalid intelligence citation' using errcode = '22023';
    end if;
    insert into public.ai_citations (
      organization_id, ai_run_id, source_table, source_record_id,
      source_field, excerpt, relevance
    ) values (
      run_row.organization_id, run_row.id, citation ->> 'sourceTable',
      citation ->> 'sourceRecordId', nullif(btrim(citation ->> 'label'), ''),
      nullif(btrim(citation ->> 'excerpt'), ''),
      greatest(0, least(1, coalesce((citation ->> 'relevance')::numeric, 1)))
    );
  end loop;

  if p_proposal is not null then
    if jsonb_typeof(p_proposal) <> 'object'
      or p_proposal ->> 'kind' <> 'task.create'
      or length(btrim(coalesce(p_proposal ->> 'title', ''))) not between 1 and 240
      or length(coalesce(p_proposal ->> 'description', '')) > 10000
      or coalesce(p_proposal ->> 'priority', '') not in ('low', 'normal', 'high', 'urgent')
      or (p_proposal ->> 'dueAt' is not null and (p_proposal ->> 'dueAt')::timestamptz
        not between clock_timestamp() - interval '5 minutes' and clock_timestamp() + interval '90 days')
      or p_proposal ->> 'assignedEmployeeId' is not null then
      raise exception 'Invalid task proposal' using errcode = '22023';
    end if;
    canonical_change := jsonb_strip_nulls(jsonb_build_object(
      'kind', 'task.create',
      'locationId', run_row.location_id,
      'title', btrim(p_proposal ->> 'title'),
      'description', nullif(btrim(p_proposal ->> 'description'), ''),
      'priority', p_proposal ->> 'priority',
      'assignedEmployeeId', null,
      'dueAt', p_proposal ->> 'dueAt'
    ));
    proposal_id := gen_random_uuid();
    confirmation_fingerprint := encode(
      extensions.digest(canonical_change::text, 'sha256'), 'hex'
    );
    insert into public.ai_action_proposals (
      id, organization_id, location_id, ai_run_id, action_type,
      target_table, target_record_id, proposed_change, confidence
    ) values (
      proposal_id, run_row.organization_id, run_row.location_id, run_row.id,
      'other', 'tasks', null, canonical_change, p_confidence
    );
  end if;
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'runId', run_row.id, 'proposalId', proposal_id,
    'confirmationFingerprint', confirmation_fingerprint, 'replayed', false
  );
end
$$;

create function public.fail_owner_intelligence_run(
  p_request_id uuid,
  p_ai_run_id uuid,
  p_error_message text
)
returns public.ai_runs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  run_row public.ai_runs%rowtype;
  clean_error text := left(nullif(btrim(coalesce(p_error_message, '')), ''), 2000);
begin
  select * into run_row from public.ai_runs run
  where run.id = p_ai_run_id and run.requested_by = actor_id for update;
  if actor_id is null or run_row.id is null
    or not public.can_use_owner_intelligence(run_row.organization_id) then
    raise exception 'Intelligence run not found' using errcode = 'P0002';
  end if;
  if run_row.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled') then return run_row; end if;
  if clean_error is null then clean_error := 'The intelligence provider did not complete.'; end if;
  if not private.claim_operation_request(
    p_request_id, 'owner-intelligence.run.fail', run_row.organization_id,
    run_row.location_id, run_row.id,
    jsonb_build_object('runId', run_row.id, 'error', clean_error)
  ) then return run_row; end if;
  update public.ai_runs run set status = 'failed', error_message = clean_error,
    completed_at = clock_timestamp() where run.id = run_row.id returning * into run_row;
  perform private.complete_operation_request(p_request_id);
  return run_row;
end
$$;

create function public.execute_owner_intelligence_task_proposal(
  p_request_id uuid,
  p_proposal_id uuid,
  p_confirmation_fingerprint text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  proposal_row public.ai_action_proposals%rowtype;
  task_row public.tasks%rowtype;
  expected_fingerprint text;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into proposal_row from public.ai_action_proposals proposal
  where proposal.id = p_proposal_id for update;
  if proposal_row.id is null
    or not public.can_execute_owner_intelligence(proposal_row.organization_id) then
    raise exception 'Executable intelligence proposal not found' using errcode = 'P0002';
  end if;
  expected_fingerprint := encode(
    extensions.digest(proposal_row.proposed_change::text, 'sha256'), 'hex'
  );
  if p_confirmation_fingerprint is distinct from expected_fingerprint then
    raise exception 'The proposal changed after review; review it again'
      using errcode = '40001';
  end if;
  if proposal_row.action_type <> 'other' or proposal_row.target_table <> 'tasks'
    or proposal_row.proposed_change ->> 'kind' <> 'task.create' then
    raise exception 'This proposal type is not executable' using errcode = '22023';
  end if;
  if proposal_row.reverted_at is not null then
    raise exception 'A reverted proposal cannot be applied again' using errcode = '23514';
  end if;
  if proposal_row.applied_at is not null then
    select * into task_row from public.tasks task where task.id = proposal_row.id;
    return jsonb_build_object(
      'proposalId', proposal_row.id, 'taskId', task_row.id,
      'status', task_row.status, 'replayed', true
    );
  end if;
  if proposal_row.status <> 'pending' then
    raise exception 'Only pending proposals can be approved' using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id, 'owner-intelligence.task.execute', proposal_row.organization_id,
    proposal_row.location_id, proposal_row.id,
    jsonb_build_object('proposalId', proposal_row.id, 'fingerprint', expected_fingerprint)
  ) then
    raise exception 'The execution request was replayed before completion'
      using errcode = '40001';
  end if;
  task_row := public.create_task(
    proposal_row.id,
    (proposal_row.proposed_change ->> 'locationId')::uuid,
    proposal_row.proposed_change ->> 'title',
    proposal_row.proposed_change ->> 'description',
    proposal_row.proposed_change ->> 'priority',
    null,
    (proposal_row.proposed_change ->> 'dueAt')::timestamptz
  );
  update public.tasks task set source_type = 'ai_proposal', source_id = proposal_row.id
  where task.id = task_row.id returning * into task_row;
  update public.ai_action_proposals proposal set
    status = 'approved', decided_by = actor_id, decided_at = clock_timestamp(),
    decision_note = 'Confirmed in Ask Le Yard', applied_by = actor_id,
    applied_at = clock_timestamp(), target_record_id = task_row.id::text,
    updated_at = clock_timestamp()
  where proposal.id = proposal_row.id;
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'proposalId', proposal_row.id, 'taskId', task_row.id,
    'status', task_row.status, 'replayed', false
  );
end
$$;

create function public.undo_owner_intelligence_task_proposal(
  p_request_id uuid,
  p_proposal_id uuid,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  proposal_row public.ai_action_proposals%rowtype;
  task_row public.tasks%rowtype;
  transition_request_id uuid := gen_random_uuid();
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into proposal_row from public.ai_action_proposals proposal
  where proposal.id = p_proposal_id for update;
  if proposal_row.id is null
    or not public.can_execute_owner_intelligence(proposal_row.organization_id) then
    raise exception 'Applied intelligence proposal not found' using errcode = 'P0002';
  end if;
  if clean_reason is null or length(clean_reason) > 1000 then
    raise exception 'An undo reason is required' using errcode = '22023';
  end if;
  if proposal_row.reverted_at is not null then
    select * into task_row from public.tasks task where task.id = proposal_row.target_record_id::uuid;
    return jsonb_build_object(
      'proposalId', proposal_row.id, 'taskId', task_row.id,
      'status', task_row.status, 'replayed', true
    );
  end if;
  if proposal_row.applied_at is null or proposal_row.status <> 'approved'
    or proposal_row.target_table <> 'tasks' or proposal_row.target_record_id is null then
    raise exception 'Only an applied task proposal can be undone' using errcode = '23514';
  end if;
  select * into task_row from public.tasks task
  where task.id = proposal_row.target_record_id::uuid for update;
  if task_row.id is null then
    raise exception 'The created task no longer exists' using errcode = 'P0002';
  end if;
  if task_row.status = 'completed' then
    raise exception 'A completed task cannot be undone; create a corrective task instead'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id, 'owner-intelligence.task.undo', proposal_row.organization_id,
    proposal_row.location_id, proposal_row.id,
    jsonb_build_object('proposalId', proposal_row.id, 'reason', clean_reason)
  ) then
    raise exception 'The undo request was replayed before completion'
      using errcode = '40001';
  end if;
  if task_row.status <> 'cancelled' then
    task_row := public.transition_task(
      transition_request_id, task_row.id, 'cancelled', clean_reason
    );
  end if;
  update public.ai_action_proposals proposal set
    reverted_by = actor_id, reverted_at = clock_timestamp(),
    reversion_note = clean_reason, reversion_request_id = p_request_id,
    updated_at = clock_timestamp()
  where proposal.id = proposal_row.id;
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'proposalId', proposal_row.id, 'taskId', task_row.id,
    'status', task_row.status, 'replayed', false
  );
end
$$;

revoke all on function public.begin_owner_intelligence_run(uuid, uuid, text, jsonb)
from public, anon, authenticated;
revoke all on function public.complete_owner_intelligence_run(uuid, uuid, jsonb, numeric, jsonb, jsonb)
from public, anon, authenticated;
revoke all on function public.fail_owner_intelligence_run(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.execute_owner_intelligence_task_proposal(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.undo_owner_intelligence_task_proposal(uuid, uuid, text)
from public, anon, authenticated;

grant execute on function public.begin_owner_intelligence_run(uuid, uuid, text, jsonb)
to authenticated;
grant execute on function public.complete_owner_intelligence_run(uuid, uuid, jsonb, numeric, jsonb, jsonb)
to authenticated;
grant execute on function public.fail_owner_intelligence_run(uuid, uuid, text)
to authenticated;
grant execute on function public.execute_owner_intelligence_task_proposal(uuid, uuid, text)
to authenticated;
grant execute on function public.undo_owner_intelligence_task_proposal(uuid, uuid, text)
to authenticated;

comment on function public.begin_owner_intelligence_run(uuid, uuid, text, jsonb)
is 'Starts an AAL2, explicitly authorized owner intelligence run with an idempotent request ledger.';
comment on function public.execute_owner_intelligence_task_proposal(uuid, uuid, text)
is 'Executes only the reviewed task proposal whose canonical SHA-256 fingerprint matches the confirmation request.';
comment on function public.undo_owner_intelligence_task_proposal(uuid, uuid, text)
is 'Compensates an applied task-create proposal by cancelling the still-open task and preserving reversion evidence.';
