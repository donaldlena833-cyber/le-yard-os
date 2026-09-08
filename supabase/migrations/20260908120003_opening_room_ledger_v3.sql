-- Opening Room v3. Installs a compatible contract; does not convert any live workspace.
-- Conversion happens once, on the first reconciled v3 save, preserving the v2 revision.
begin;

create function private.startup_workspace_v3_violations(p_data jsonb, p_organization_id uuid)
returns text[] language plpgsql stable set search_path = '' as $$
declare
  projected jsonb := p_data - 'activity';
  violations text[] := '{}';
  items jsonb := '[]'; tasks jsonb := '[]'; events jsonb := '[]';
  item jsonb; entry jsonb; original jsonb; task jsonb; event jsonb; entries jsonb;
  collection text; amount numeric; paid numeric; committed numeric; seen text[]; target text;
begin
  if p_data->'version' is distinct from '3'::jsonb then return array['schema_version']; end if;
  if jsonb_typeof(p_data->'budgetItems') <> 'array' or jsonb_typeof(p_data->'tasks') <> 'array' or jsonb_typeof(p_data->'events') <> 'array' then return array['collections_shape']; end if;
  target := p_data->>'targetOpeningDate';
  if not private.startup_iso_date_is_valid(target) then violations := array_append(violations,'opening_date'); end if;
  if (select count(*) from jsonb_array_elements(p_data->'events') e where e->>'kind'='opening') <> 1
    or not exists(select 1 from jsonb_array_elements(p_data->'events') e where e->>'kind'='opening' and e->>'date'=target)
    or not exists(select 1 from jsonb_array_elements(p_data->'milestones') m where m->>'id'='opening' and m->>'date'=target)
    then violations := array_append(violations,'opening_dates_disagree'); end if;
  for task in select value from jsonb_array_elements(p_data->'tasks') loop
    if task ? 'startDate' and not private.startup_iso_date_is_valid(task->>'startDate') then violations := array_append(violations,'start_date'); end if;
    if task ? 'archived' and jsonb_typeof(task->'archived') <> 'boolean' then violations := array_append(violations,'archived_shape'); end if;
    if task ? 'checklist' then
      if jsonb_typeof(task->'checklist') <> 'array' or jsonb_array_length(task->'checklist') > 1000 then return array['checklist_shape']; end if;
      seen := '{}';
      for entry in select value from jsonb_array_elements(task->'checklist') loop
        if not private.startup_json_object_matches(entry,array['id','title','done','dueDate'],array['id','title','done','dueDate'])
          or not private.startup_json_text_is_valid(entry->'id',200,true) or not private.startup_json_text_is_valid(entry->'title',20000)
          or jsonb_typeof(entry->'done') is distinct from 'boolean' or not private.startup_iso_date_is_valid(entry->>'dueDate') or entry->>'id'=any(seen)
          then violations := array_append(violations,'checklist_entry'); end if;
        seen := array_append(seen,entry->>'id');
      end loop;
    end if;
    tasks := tasks || jsonb_build_array(task - array['startDate','archived','checklist']);
  end loop;
  for event in select value from jsonb_array_elements(p_data->'events') loop
    if event ? 'workItemId' and not exists(select 1 from jsonb_array_elements(p_data->'tasks') t where t->>'id'=event->>'workItemId') then violations := array_append(violations,'event_work_link'); end if;
    if event ? 'owner' and not private.startup_json_text_is_valid(event->'owner',20000) then violations := array_append(violations,'event_owner'); end if;
    if event ? 'time' and (jsonb_typeof(event->'time') <> 'string' or event->>'time' !~ '^$|^([01][0-9]|2[0-3]):[0-5][0-9]$') then violations := array_append(violations,'event_time'); end if;
    if event ? 'durationMinutes' and (jsonb_typeof(event->'durationMinutes') <> 'number' or (event->>'durationMinutes')::numeric not between 1 and 1440 or (event->>'durationMinutes')::numeric <> trunc((event->>'durationMinutes')::numeric)) then violations := array_append(violations,'event_duration'); end if;
    event := event - array['workItemId','owner','time','durationMinutes'];
    if event->>'kind'='delivery' then event := jsonb_set(event,'{kind}','"meeting"'); end if;
    if event->>'kind'='opening' then event := jsonb_set(event,'{date}','"2026-12-01"'); end if;
    events := events || jsonb_build_array(event);
  end loop;
  for item in select value from jsonb_array_elements(p_data->'budgetItems') loop
    if jsonb_typeof(item->'budgetSet') is distinct from 'boolean' then violations := array_append(violations,'budget_set'); end if;
    if item ? 'workItemId' and not exists(select 1 from jsonb_array_elements(p_data->'tasks') t where t->>'id'=item->>'workItemId') then violations := array_append(violations,'expense_work_link'); end if;
    if item->>'flexibility'='non-negotiable' and (item->>'planned')::numeric < coalesce((item->>'minimumAmount')::numeric,0) then violations := array_append(violations,'protected_minimum'); end if;
    if (item->>'planned')::numeric*100 <> trunc((item->>'planned')::numeric*100) then violations := array_append(violations,'budget_precision'); end if;
    paid := 0; committed := 0;
    foreach collection in array array['commitments','payments','schedules'] loop
      entries := item->collection;
      if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) > 10000 then return array['ledger_array']; end if;
      seen := '{}';
      for entry in select value from jsonb_array_elements(entries) loop
        if not private.startup_json_text_is_valid(entry->'id',200,true) or entry->>'id'=any(seen) then violations := array_append(violations,'ledger_id'); end if;
        seen := array_append(seen,entry->>'id');
        if jsonb_typeof(entry->'amountCents') is distinct from 'number' then return array['amount_cents']; end if;
        amount := (entry->>'amountCents')::numeric;
        if amount < 0 or amount > 100000000000 or amount <> trunc(amount) or (collection <> 'commitments' and amount=0) then violations := array_append(violations,'amount_cents'); end if;
        if not private.startup_iso_date_is_valid(entry->>'date') or (coalesce(entry->>'date','')='' and coalesce(entry->>'legacy','false') <> 'true') then violations := array_append(violations,'ledger_date'); end if;
        if collection='schedules' then
          if not private.startup_json_object_matches(entry,array['id','title','amountCents','date'],array['id','title','amountCents','date']) or not private.startup_json_text_is_valid(entry->'title',20000) then violations := array_append(violations,'schedule_shape'); end if;
        else
          if not private.startup_json_object_matches(entry,array['id','amountCents','date','recordedAt','actor','note'],case when collection='payments' then array['id','amountCents','date','recordedAt','actor','note','legacy','kind','reversesId','scheduleId','method','payer','reference'] else array['id','amountCents','date','recordedAt','actor','note','legacy'] end)
            or not private.startup_timestamp_is_valid(entry->>'recordedAt') or not private.startup_json_text_is_valid(entry->'actor',20000) or not private.startup_json_text_is_valid(entry->'note',20000)
            or (entry ? 'legacy' and jsonb_typeof(entry->'legacy') <> 'boolean') then violations := array_append(violations,'ledger_entry_shape'); end if;
        end if;
        if collection='commitments' then committed := amount; end if;
        if collection='payments' then
          if entry->>'kind' not in ('payment','refund','reversal') or not (entry ? 'kind') then violations := array_append(violations,'payment_kind'); end if;
          if (entry ? 'method' and not private.startup_json_text_is_valid(entry->'method',20000)) or (entry ? 'payer' and not private.startup_json_text_is_valid(entry->'payer',20000)) or (entry ? 'reference' and not private.startup_json_text_is_valid(entry->'reference',20000)) then violations := array_append(violations,'payment_details'); end if;
          if entry ? 'scheduleId' and not exists(select 1 from jsonb_array_elements(item->'schedules') s where s->>'id'=entry->>'scheduleId') then violations := array_append(violations,'schedule_link'); end if;
          if entry->>'kind'='reversal' then
            select p into original from jsonb_array_elements(item->'payments') p where p->>'id'=entry->>'reversesId';
            if original is null or original->>'kind'='reversal' or original->'amountCents' <> entry->'amountCents' or original->'scheduleId' is distinct from entry->'scheduleId'
              or (select count(*) from jsonb_array_elements(item->'payments') p where p->>'reversesId'=entry->>'reversesId') <> 1 then violations := array_append(violations,'invalid_reversal'); end if;
            paid := paid + case when original->>'kind'='refund' then amount else -amount end;
          else
            if entry ? 'reversesId' then violations := array_append(violations,'invalid_reversal'); end if;
            paid := paid + case when entry->>'kind'='refund' then -amount else amount end;
          end if;
        end if;
      end loop;
    end loop;
    if paid < 0 or (item->>'paid')::numeric*100 <> paid or (item->>'committed')::numeric*100 <> committed then violations := array_append(violations,'ledger_totals'); end if;
    if item->>'budgetRole'='operating-reserve' and (paid<>0 or committed<>0) then violations := array_append(violations,'reserve_not_expense'); end if;
    -- Reuse all established v2 shape, dependency, reserve and tenant validation.
    -- The projection only removes superseded money ordering and fixed opening-date rules.
    item := item - array['workItemId','budgetSet','commitments','payments','schedules','legacyBreakdown','status','subcategories'];
    item := jsonb_set(item,'{planned}',to_jsonb(greatest((item->>'planned')::numeric,committed/100,paid/100)));
    item := jsonb_set(item,'{committed}',to_jsonb(greatest(committed/100,paid/100)));
    items := items || jsonb_build_array(item);
  end loop;
  projected := projected || jsonb_build_object('version',2,'targetOpeningDate','2026-12-01','budgetItems',items,'tasks',tasks,'events',events);
  projected := jsonb_set(projected,'{milestones}',(select coalesce(jsonb_agg(case when m->>'id'='opening' then jsonb_set(m,'{date}','"2026-12-01"') else m end),'[]') from jsonb_array_elements(projected->'milestones') m));
  projected := jsonb_set(projected,'{facts}',(select coalesce(jsonb_agg(case when f->>'id'='opening-date' then jsonb_set(f,'{value}','"December 1, 2026"') else f end),'[]') from jsonb_array_elements(projected->'facts') f));
  if p_data ? 'activity' then
    if jsonb_typeof(p_data->'activity') <> 'array' or jsonb_array_length(p_data->'activity') > 100000 then return array['activity_shape']; end if;
    seen := '{}';
    for entry in select value from jsonb_array_elements(p_data->'activity') loop
      if not private.startup_json_object_matches(entry,array['id','recordId','text','actor','recordedAt'],array['id','recordId','text','actor','recordedAt'])
        or not private.startup_json_text_is_valid(entry->'id',200,true) or not private.startup_json_text_is_valid(entry->'recordId',200,true)
        or not private.startup_json_text_is_valid(entry->'text',20000) or not private.startup_json_text_is_valid(entry->'actor',20000)
        or not private.startup_timestamp_is_valid(entry->>'recordedAt') or entry->>'id'=any(seen) then violations := array_append(violations,'activity_entry'); end if;
      seen := array_append(seen,entry->>'id');
    end loop;
  end if;
  return violations || private.startup_workspace_contract_violations(projected,p_organization_id);
exception when others then return array['invalid_v3_shape'];
end $$;
revoke all on function private.startup_workspace_v3_violations(jsonb,uuid) from public,anon,authenticated;

alter table public.startup_workspaces drop constraint startup_workspaces_v2_contract_ck;
alter table public.startup_workspaces add constraint startup_workspaces_versioned_contract_ck check (
  case when data->>'version'='3' then cardinality(private.startup_workspace_v3_violations(data,organization_id))=0
  else cardinality(private.startup_workspace_contract_violations(data,organization_id))=0 end
);

create function private.startup_prevent_downgrade() returns trigger language plpgsql set search_path='' as $$
begin
  if old.data->>'version'='3' and new.data->>'version' <> '3' then raise exception 'Opening Room was upgraded. Reload before saving.' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function private.startup_prevent_downgrade() from public,anon,authenticated;
create trigger startup_prevent_downgrade before update on public.startup_workspaces for each row execute function private.startup_prevent_downgrade();

create table private.startup_save_operations (
 workspace_id text not null references public.startup_workspaces(id), operation_id uuid not null,
 actor_id uuid not null, request_data jsonb not null, revision bigint not null,
 primary key(workspace_id,operation_id)
);
alter table private.startup_save_operations enable row level security;
revoke all on private.startup_save_operations from public,anon,authenticated;

create function public.save_startup_workspace_v3(p_workspace_id text,p_expected_revision bigint,p_data jsonb,p_operation_id uuid)
returns table(outcome text,revision bigint,data jsonb,updated_at timestamptz)
language plpgsql security definer set search_path='' set row_security=off as $$
declare
 actor_id uuid := auth.uid(); actor_label text; saved public.startup_workspaces%rowtype;
 op private.startup_save_operations%rowtype; candidate jsonb := p_data; items jsonb := '[]';
 item jsonb; old_item jsonb; entries jsonb; entry jsonb; old_entry jsonb; collection text;
 issues text[]; stamp text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 legacy_amount numeric;
begin
 if octet_length(p_data::text)>10485760 then raise exception 'Workspace exceeds the 10 MB limit' using errcode='22023'; end if;
 if actor_id is null then raise exception 'Owner or Admin access is required' using errcode='42501'; end if;
 select * into saved from public.startup_workspaces w where w.id=p_workspace_id for update;
 if saved.id is null or not public.can_manage_org(saved.organization_id) then raise exception 'Opening Room workspace is unavailable' using errcode='42501'; end if;
 if p_operation_id is null or p_expected_revision < 1 or p_expected_revision is null then raise exception 'A valid save operation is required' using errcode='22023'; end if;
 select * into op from private.startup_save_operations s where s.workspace_id=p_workspace_id and s.operation_id=p_operation_id;
 if found then
   if op.actor_id<>actor_id or op.request_data<>p_data then raise exception 'Save operation was reused with different data' using errcode='22023'; end if;
   return query select 'saved'::text,saved.revision,saved.data,saved.updated_at; return;
 end if;
 if saved.revision<>p_expected_revision then return query select 'conflict'::text,saved.revision,saved.data,saved.updated_at; return; end if;
 issues := private.startup_workspace_v3_violations(candidate,saved.organization_id);
 if cardinality(issues)>0 then raise exception 'Opening Room data failed validation' using errcode='23514',detail=array_to_string(issues,','); end if;
 select coalesce(p.display_name,actor_id::text) into actor_label from public.profiles p where p.id=actor_id;
 actor_label := coalesce(actor_label,actor_id::text);
 -- A first v3 write must carry every original cost and its exact opening balances.
 if saved.data->>'version'='2' then
   for old_item in select value from jsonb_array_elements(saved.data->'budgetItems') loop
     select e into item from jsonb_array_elements(candidate->'budgetItems') e where e->>'id'=old_item->>'id';
     if item is null or item->'planned' <> old_item->'planned' or item->'committed' <> old_item->'committed' or item->'paid' <> old_item->'paid' then
       raise exception 'Reconcile and save the legacy conversion before editing money' using errcode='23514';
     end if;
   end loop;
 end if;
 for item in select value from jsonb_array_elements(candidate->'budgetItems') loop
   select e into old_item from jsonb_array_elements(saved.data->'budgetItems') e where e->>'id'=item->>'id';
   foreach collection in array array['commitments','payments'] loop
     entries := '[]';
     if saved.data->>'version'='3' and old_item is not null then
       for old_entry in select value from jsonb_array_elements(coalesce(old_item->collection,'[]')) loop
         if not exists(select 1 from jsonb_array_elements(item->collection) e where e=old_entry) then raise exception 'Posted money history cannot be changed or removed; record a correction' using errcode='23514'; end if;
       end loop;
       if collection='commitments' and exists(select 1 from jsonb_array_elements(old_item->collection) with ordinality e(value,n) where item->collection->(e.n::int-1)<>e.value) then raise exception 'Price history cannot be reordered' using errcode='23514'; end if;
     end if;
     for entry in select value from jsonb_array_elements(item->collection) loop
       if exists(select 1 from jsonb_array_elements(coalesce(old_item->collection,'[]')) e where e=entry) then
         entries := entries || jsonb_build_array(entry);
       elsif coalesce(entry->>'legacy','false')='true' then
         legacy_amount := coalesce((old_item->>case when collection='payments' then 'paid' else 'committed' end)::numeric,0)*100;
         if saved.data->>'version'<>'2' or jsonb_array_length(item->collection)<>1 or entry->>'date'<>'' or (entry->>'amountCents')::numeric<>legacy_amount or legacy_amount<=0
           or (collection='payments' and entry->>'kind'<>'payment') then raise exception 'Invalid legacy balance' using errcode='23514'; end if;
         entries := entries || jsonb_build_array(entry || jsonb_build_object('actor','Legacy import','recordedAt',stamp));
       else
         entries := entries || jsonb_build_array(entry || jsonb_build_object('actor',actor_label,'recordedAt',stamp));
       end if;
     end loop;
     item := jsonb_set(item,array[collection],entries);
   end loop;
   items := items || jsonb_build_array(item);
 end loop;
 if saved.data->>'version'='3' and exists(select 1 from jsonb_array_elements(saved.data->'budgetItems') old where not exists(select 1 from jsonb_array_elements(candidate->'budgetItems') e where e->>'id'=old->>'id')) then raise exception 'Archive work instead of deleting expense history' using errcode='23514'; end if;
 candidate := jsonb_set(candidate,'{budgetItems}',items);
 entries := '[]';
 for old_entry in select value from jsonb_array_elements(coalesce(saved.data->'activity','[]')) loop
   if not exists(select 1 from jsonb_array_elements(coalesce(candidate->'activity','[]')) e where e=old_entry) then raise exception 'Activity history cannot be removed' using errcode='23514'; end if;
 end loop;
 for entry in select value from jsonb_array_elements(coalesce(candidate->'activity','[]')) loop
   entries := entries || jsonb_build_array(case when exists(select 1 from jsonb_array_elements(coalesce(saved.data->'activity','[]')) e where e=entry) then entry else entry || jsonb_build_object('actor',actor_label,'recordedAt',stamp) end);
 end loop;
 candidate := candidate || jsonb_build_object('activity',entries,'updatedAt',stamp);
 update public.startup_workspaces w set data=candidate,revision=w.revision+1,updated_at=clock_timestamp() where w.id=saved.id returning * into saved;
 insert into public.startup_workspace_revisions(workspace_id,organization_id,revision,data,actor_id,created_at) values(saved.id,saved.organization_id,saved.revision,saved.data,actor_id,saved.updated_at);
 insert into private.startup_save_operations values(saved.id,p_operation_id,actor_id,p_data,saved.revision);
 return query select 'saved'::text,saved.revision,saved.data,saved.updated_at;
end $$;
revoke all on function public.save_startup_workspace_v3(text,bigint,jsonb,uuid) from public,anon;
grant execute on function public.save_startup_workspace_v3(text,bigint,jsonb,uuid) to authenticated;
update private.runtime_schema_contract_expected expected
set migration_head = '20260908120003',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
commit;
