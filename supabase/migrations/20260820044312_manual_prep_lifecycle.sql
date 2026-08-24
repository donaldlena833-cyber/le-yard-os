-- Manual prep is deliberately human-planned in the launch version. Forecasting
-- and automatic ordering remain out of scope until the underlying evidence is
-- connected and rehearsed.

create table public.prep_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  business_date date not null,
  service_period text not null check (service_period in ('prep', 'lunch', 'dinner', 'all_day')),
  station text not null check (length(btrim(station)) between 1 and 80),
  recipe_id uuid,
  output_inventory_item_id uuid,
  target_quantity numeric(16,4) not null check (target_quantity > 0),
  target_unit_id uuid not null,
  due_at timestamptz not null,
  assignee_user_id uuid references auth.users(id) on delete set null,
  state text not null default 'draft'
    check (state in ('draft', 'published', 'in_progress', 'completed', 'corrected', 'cancelled')),
  actual_yield numeric(16,4) check (actual_yield is null or actual_yield > 0),
  note text check (note is null or length(note) <= 2000),
  completion_note text check (completion_note is null or length(completion_note) <= 2000),
  stock_override boolean not null default false,
  stock_warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(stock_warnings) = 'array'),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  corrected_by uuid references auth.users(id) on delete set null,
  corrected_at timestamptz,
  correction_note text check (correction_note is null or length(correction_note) <= 2000),
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, recipe_id)
    references public.recipes(organization_id, id) on delete restrict,
  foreign key (organization_id, output_inventory_item_id)
    references public.inventory_items(organization_id, id) on delete restrict,
  foreign key (organization_id, target_unit_id)
    references public.measurement_units(organization_id, id) on delete restrict,
  check (recipe_id is not null or output_inventory_item_id is not null),
  check ((state in ('published', 'in_progress', 'completed', 'corrected') and published_at is not null)
    or state in ('draft', 'cancelled')),
  check ((state in ('completed', 'corrected') and completed_at is not null and actual_yield is not null)
    or state not in ('completed', 'corrected'))
);

create index prep_tasks_location_day_idx
  on public.prep_tasks(location_id, business_date, due_at, state);
create index prep_tasks_assignee_idx
  on public.prep_tasks(assignee_user_id, business_date)
  where assignee_user_id is not null;

create table private.prep_command_requests (
  request_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.prep_tasks(id) on delete cascade,
  command text not null check (command in ('save', 'publish', 'start', 'complete', 'correct')),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.prep_tasks enable row level security;
alter table public.prep_tasks force row level security;

create policy prep_tasks_read on public.prep_tasks
for select to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array['prep.manage', 'prep.complete']
  )
);

revoke all on table public.prep_tasks from public, anon, authenticated;
grant select on table public.prep_tasks to authenticated;
revoke all on table private.prep_command_requests from public, anon, authenticated;

create function private.prep_completion_lines(
  p_task_id uuid,
  p_actual_yield numeric
)
returns jsonb
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  with task as (
    select prep.*
    from public.prep_tasks prep
    where prep.id = p_task_id
  ), ingredient_lines as (
    select
      ingredient.inventory_item_id,
      item.name as item_name,
      ingredient.unit_id,
      unit.symbol as unit_symbol,
      round((ingredient.quantity / (1 - ingredient.waste_factor))
        * (p_actual_yield / recipe.yield_quantity), 6) as quantity,
      coalesce(on_hand.quantity_on_hand, 0) as on_hand,
      'consume'::text as movement
    from task
    join public.recipes recipe on recipe.id = task.recipe_id
    join public.recipe_ingredients ingredient on ingredient.recipe_id = recipe.id
    join public.inventory_items item on item.id = ingredient.inventory_item_id
      and item.organization_id = task.organization_id
      and item.base_unit_id = ingredient.unit_id
      and item.is_active
      and item.track_inventory
    join public.measurement_units unit on unit.id = ingredient.unit_id
    left join public.inventory_on_hand on_hand
      on on_hand.organization_id = task.organization_id
      and on_hand.location_id = task.location_id
      and on_hand.inventory_item_id = ingredient.inventory_item_id
  ), output_line as (
    select
      item.id as inventory_item_id,
      item.name as item_name,
      item.base_unit_id as unit_id,
      unit.symbol as unit_symbol,
      p_actual_yield as quantity,
      coalesce(on_hand.quantity_on_hand, 0) as on_hand,
      'produce'::text as movement
    from task
    join public.inventory_items item
      on item.id = task.output_inventory_item_id
      and item.organization_id = task.organization_id
      and item.base_unit_id = task.target_unit_id
      and item.is_active
      and item.track_inventory
    join public.measurement_units unit on unit.id = item.base_unit_id
    left join public.inventory_on_hand on_hand
      on on_hand.organization_id = task.organization_id
      and on_hand.location_id = task.location_id
      and on_hand.inventory_item_id = item.id
  ), lines as (
    select * from ingredient_lines
    union all
    select * from output_line
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'inventory_item_id', inventory_item_id,
    'item_name', item_name,
    'unit_id', unit_id,
    'unit_symbol', unit_symbol,
    'quantity', quantity,
    'on_hand', on_hand,
    'movement', movement,
    'insufficient', movement = 'consume' and on_hand < quantity
  ) order by movement, item_name), '[]'::jsonb)
  from lines
$$;

create function public.save_prep_task(
  p_request_id uuid,
  p_task_id uuid,
  p_location_id uuid,
  p_business_date date,
  p_service_period text,
  p_station text,
  p_recipe_id uuid,
  p_output_inventory_item_id uuid,
  p_target_quantity numeric,
  p_target_unit_id uuid,
  p_due_at timestamptz,
  p_assignee_user_id uuid,
  p_note text,
  p_expected_version integer default null
)
returns public.prep_tasks
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  existing_request private.prep_command_requests%rowtype;
  task_row public.prep_tasks%rowtype;
  payload jsonb;
  clean_station text := btrim(p_station);
  clean_note text := nullif(btrim(p_note), '');
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_request_id is null or p_task_id is null or p_business_date is null
    or p_service_period not in ('prep', 'lunch', 'dinner', 'all_day')
    or length(clean_station) not between 1 and 80
    or p_target_quantity <= 0 or p_due_at is null
    or (clean_note is not null and length(clean_note) > 2000)
    or (p_recipe_id is null and p_output_inventory_item_id is null) then
    raise exception 'Invalid prep task payload' using errcode = '22023';
  end if;

  select * into location_row from public.locations location
  where location.id = p_location_id and location.is_active for update;
  if location_row.id is null or not public.has_capability(
    location_row.organization_id, location_row.id, 'prep.manage'
  ) then raise exception 'Not authorized to manage prep at this location' using errcode = '42501'; end if;

  if not exists (select 1 from public.measurement_units unit
    where unit.organization_id = location_row.organization_id and unit.id = p_target_unit_id and unit.is_active)
    or (p_recipe_id is not null and not exists (select 1 from public.recipes recipe
      where recipe.organization_id = location_row.organization_id and recipe.id = p_recipe_id and recipe.is_active))
    or (p_output_inventory_item_id is not null and not exists (select 1 from public.inventory_items item
      where item.organization_id = location_row.organization_id and item.id = p_output_inventory_item_id
        and item.base_unit_id = p_target_unit_id and item.is_active and item.track_inventory)) then
    raise exception 'Prep task references must be active and use the output base unit' using errcode = '23514';
  end if;
  if p_assignee_user_id is not null and not exists (
    select 1 from public.organization_memberships membership
    join public.location_memberships location_membership
      on location_membership.organization_id = membership.organization_id
      and location_membership.user_id = membership.user_id
    where membership.organization_id = location_row.organization_id
      and membership.user_id = p_assignee_user_id and membership.status = 'active'
      and location_membership.location_id = location_row.id
  ) then raise exception 'Assignee must be active at this location' using errcode = '23514'; end if;

  payload := jsonb_build_object('task_id', p_task_id, 'location_id', p_location_id,
    'business_date', p_business_date, 'service_period', p_service_period, 'station', clean_station,
    'recipe_id', p_recipe_id, 'output_inventory_item_id', p_output_inventory_item_id,
    'target_quantity', p_target_quantity, 'target_unit_id', p_target_unit_id, 'due_at', p_due_at,
    'assignee_user_id', p_assignee_user_id, 'note', clean_note, 'expected_version', p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended('prep-command:' || p_request_id::text, 0));
  select * into existing_request from private.prep_command_requests request where request.request_id = p_request_id;
  if existing_request.request_id is not null then
    if existing_request.command <> 'save' or existing_request.request_payload <> payload then
      raise exception 'Prep request id was reused' using errcode = '23505';
    end if;
    select * into task_row from public.prep_tasks task where task.id = existing_request.task_id;
    return task_row;
  end if;

  select * into task_row from public.prep_tasks task where task.id = p_task_id for update;
  if task_row.id is null then
    if p_expected_version is not null then raise exception 'Prep task changed; refresh before saving' using errcode = '40001'; end if;
    insert into public.prep_tasks (id, organization_id, location_id, business_date, service_period,
      station, recipe_id, output_inventory_item_id, target_quantity, target_unit_id, due_at,
      assignee_user_id, note, created_by)
    values (p_task_id, location_row.organization_id, location_row.id, p_business_date,
      p_service_period, clean_station, p_recipe_id, p_output_inventory_item_id,
      p_target_quantity, p_target_unit_id, p_due_at, p_assignee_user_id, clean_note, actor_id)
    returning * into task_row;
  else
    if task_row.organization_id <> location_row.organization_id or task_row.location_id <> location_row.id
      or task_row.state <> 'draft' or task_row.version <> p_expected_version then
      raise exception 'Only the current draft can be edited; refresh before saving' using errcode = '40001';
    end if;
    update public.prep_tasks set business_date = p_business_date, service_period = p_service_period,
      station = clean_station, recipe_id = p_recipe_id, output_inventory_item_id = p_output_inventory_item_id,
      target_quantity = p_target_quantity, target_unit_id = p_target_unit_id, due_at = p_due_at,
      assignee_user_id = p_assignee_user_id, note = clean_note, version = version + 1,
      updated_at = clock_timestamp()
    where id = task_row.id returning * into task_row;
  end if;
  insert into private.prep_command_requests values (
    p_request_id, location_row.organization_id, task_row.id, 'save', payload, actor_id, clock_timestamp()
  );
  insert into public.audit_events (organization_id, location_id, actor_id, action, table_name,
    record_id, new_record, request_id) values (location_row.organization_id, location_row.id,
    actor_id, 'prep.task.saved', 'prep_tasks', task_row.id::text, to_jsonb(task_row), p_request_id::text);
  return task_row;
end
$$;

create function public.transition_prep_task(
  p_request_id uuid,
  p_task_id uuid,
  p_expected_version integer,
  p_command text
)
returns public.prep_tasks
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  task_row public.prep_tasks%rowtype;
  existing_request private.prep_command_requests%rowtype;
  payload jsonb := jsonb_build_object('task_id', p_task_id, 'expected_version', p_expected_version, 'command', p_command);
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_command not in ('publish', 'start') then raise exception 'Invalid prep transition' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('prep-command:' || p_request_id::text, 0));
  select * into existing_request from private.prep_command_requests request where request.request_id = p_request_id;
  if existing_request.request_id is not null then
    if existing_request.command <> p_command or existing_request.request_payload <> payload then
      raise exception 'Prep request id was reused' using errcode = '23505'; end if;
    select * into task_row from public.prep_tasks task where task.id = existing_request.task_id;
    return task_row;
  end if;
  select * into task_row from public.prep_tasks task where task.id = p_task_id for update;
  if task_row.id is null or task_row.version <> p_expected_version then
    raise exception 'Prep task changed; refresh before continuing' using errcode = '40001'; end if;
  if p_command = 'publish' then
    if task_row.state <> 'draft' or not public.has_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
      raise exception 'Not authorized to publish this prep task' using errcode = '42501'; end if;
    update public.prep_tasks set state = 'published', published_by = actor_id,
      published_at = clock_timestamp(), version = version + 1, updated_at = clock_timestamp()
    where id = task_row.id returning * into task_row;
  else
    if task_row.state <> 'published' or not public.has_capability(task_row.organization_id, task_row.location_id, 'prep.complete') then
      raise exception 'Not authorized to start this prep task' using errcode = '42501'; end if;
    if task_row.assignee_user_id is not null and task_row.assignee_user_id <> actor_id
      and not public.has_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
      raise exception 'This prep task is assigned to another teammate' using errcode = '42501'; end if;
    update public.prep_tasks set state = 'in_progress', started_by = actor_id,
      started_at = clock_timestamp(), version = version + 1, updated_at = clock_timestamp()
    where id = task_row.id returning * into task_row;
  end if;
  insert into private.prep_command_requests values (
    p_request_id, task_row.organization_id, task_row.id, p_command, payload, actor_id, clock_timestamp()
  );
  insert into public.audit_events (organization_id, location_id, actor_id, action, table_name,
    record_id, new_record, request_id) values (task_row.organization_id, task_row.location_id,
    actor_id, 'prep.task.' || p_command, 'prep_tasks', task_row.id::text, to_jsonb(task_row), p_request_id::text);
  return task_row;
end
$$;

create function public.preview_prep_completion(
  p_task_id uuid,
  p_actual_yield numeric
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare task_row public.prep_tasks%rowtype; lines jsonb;
begin
  if auth.uid() is null or p_actual_yield <= 0 then raise exception 'Invalid completion preview' using errcode = '22023'; end if;
  select * into task_row from public.prep_tasks task where task.id = p_task_id;
  if task_row.id is null or task_row.state not in ('published', 'in_progress')
    or not public.has_any_capability(task_row.organization_id, task_row.location_id, array['prep.manage', 'prep.complete']) then
    raise exception 'Not authorized to preview this prep completion' using errcode = '42501'; end if;
  lines := private.prep_completion_lines(task_row.id, p_actual_yield);
  if task_row.recipe_id is not null and not exists (
    select 1 from jsonb_array_elements(lines) line where line ->> 'movement' = 'consume'
  ) then raise exception 'Recipe ingredients must use active item base units before prep can post' using errcode = '23514'; end if;
  return jsonb_build_object('task_id', task_row.id, 'version', task_row.version,
    'actual_yield', p_actual_yield, 'movements', lines,
    'has_shortage', exists(select 1 from jsonb_array_elements(lines) line where (line ->> 'insufficient')::boolean));
end
$$;

create function public.complete_prep_task(
  p_request_id uuid,
  p_task_id uuid,
  p_expected_version integer,
  p_actual_yield numeric,
  p_override_insufficient boolean,
  p_completion_note text default null
)
returns public.prep_tasks
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid(); task_row public.prep_tasks%rowtype;
  existing_request private.prep_command_requests%rowtype; lines jsonb; line jsonb;
  warnings jsonb; payload jsonb; clean_note text := nullif(btrim(p_completion_note), '');
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_request_id is null or p_actual_yield <= 0 or (clean_note is not null and length(clean_note) > 2000) then
    raise exception 'Invalid prep completion' using errcode = '22023'; end if;
  payload := jsonb_build_object('task_id', p_task_id, 'expected_version', p_expected_version,
    'actual_yield', p_actual_yield, 'override_insufficient', coalesce(p_override_insufficient, false),
    'completion_note', clean_note);
  perform pg_advisory_xact_lock(hashtextextended('prep-command:' || p_request_id::text, 0));
  select * into existing_request from private.prep_command_requests request where request.request_id = p_request_id;
  if existing_request.request_id is not null then
    if existing_request.command <> 'complete' or existing_request.request_payload <> payload then
      raise exception 'Prep request id was reused' using errcode = '23505'; end if;
    select * into task_row from public.prep_tasks task where task.id = existing_request.task_id;
    return task_row;
  end if;
  select * into task_row from public.prep_tasks task where task.id = p_task_id for update;
  if task_row.id is null or task_row.version <> p_expected_version or task_row.state not in ('published', 'in_progress') then
    raise exception 'Prep task changed; refresh before completing' using errcode = '40001'; end if;
  if not public.has_capability(task_row.organization_id, task_row.location_id, 'prep.complete') then
    raise exception 'Not authorized to complete prep at this location' using errcode = '42501'; end if;
  if task_row.assignee_user_id is not null and task_row.assignee_user_id <> actor_id
    and not public.has_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
    raise exception 'This prep task is assigned to another teammate' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-ledger:' || task_row.organization_id::text || ':' || task_row.location_id::text || ':' || item.id::text, 0
  )) from public.inventory_items item where item.organization_id = task_row.organization_id
    and (item.id = task_row.output_inventory_item_id or item.id in (
      select ingredient.inventory_item_id from public.recipe_ingredients ingredient where ingredient.recipe_id = task_row.recipe_id
    )) order by item.id;
  lines := private.prep_completion_lines(task_row.id, p_actual_yield);
  if task_row.recipe_id is not null and not exists (
    select 1 from jsonb_array_elements(lines) candidate where candidate ->> 'movement' = 'consume'
  ) then raise exception 'Recipe ingredients must use active item base units before prep can post' using errcode = '23514'; end if;
  select coalesce(jsonb_agg(candidate), '[]'::jsonb) into warnings
  from jsonb_array_elements(lines) candidate where (candidate ->> 'insufficient')::boolean;
  if jsonb_array_length(warnings) > 0 and not coalesce(p_override_insufficient, false) then
    raise exception 'Insufficient posted stock; review the warning before overriding' using errcode = '23514'; end if;

  insert into private.prep_command_requests values (
    p_request_id, task_row.organization_id, task_row.id, 'complete', payload, actor_id, clock_timestamp()
  );
  for line in select * from jsonb_array_elements(lines) loop
    insert into public.inventory_transactions (organization_id, location_id, inventory_item_id,
      unit_id, transaction_kind, quantity_delta, occurred_at, reference_type, reference_id,
      reason, created_by, approved_by, approved_at)
    values (task_row.organization_id, task_row.location_id, (line ->> 'inventory_item_id')::uuid,
      (line ->> 'unit_id')::uuid,
      case when line ->> 'movement' = 'consume' then 'recipe_usage'::public.inventory_transaction_kind
        else 'manual_adjustment'::public.inventory_transaction_kind end,
      case when line ->> 'movement' = 'consume' then -(line ->> 'quantity')::numeric
        else (line ->> 'quantity')::numeric end,
      clock_timestamp(), 'prep_completion', task_row.id,
      case when line ->> 'movement' = 'consume' then 'Prep ingredient consumption' else 'Prep finished batch' end,
      actor_id, actor_id, clock_timestamp());
  end loop;
  update public.prep_tasks set state = 'completed', actual_yield = p_actual_yield,
    completion_note = clean_note, stock_override = coalesce(p_override_insufficient, false),
    stock_warnings = warnings, completed_by = actor_id, completed_at = clock_timestamp(),
    version = version + 1, updated_at = clock_timestamp()
  where id = task_row.id returning * into task_row;
  insert into public.audit_events (organization_id, location_id, actor_id, action, table_name,
    record_id, new_record, request_id, metadata) values (task_row.organization_id, task_row.location_id,
    actor_id, 'prep.task.completed', 'prep_tasks', task_row.id::text, to_jsonb(task_row),
    p_request_id::text, jsonb_build_object('movements', lines, 'stock_warnings', warnings));
  return task_row;
end
$$;

create function public.correct_prep_completion(
  p_request_id uuid,
  p_task_id uuid,
  p_expected_version integer,
  p_correction_note text
)
returns public.prep_tasks
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid(); task_row public.prep_tasks%rowtype;
  existing_request private.prep_command_requests%rowtype;
  payload jsonb; clean_note text := nullif(btrim(p_correction_note), '');
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_request_id is null or clean_note is null or length(clean_note) > 2000 then
    raise exception 'A correction reason is required' using errcode = '22023'; end if;
  payload := jsonb_build_object('task_id', p_task_id, 'expected_version', p_expected_version, 'correction_note', clean_note);
  perform pg_advisory_xact_lock(hashtextextended('prep-command:' || p_request_id::text, 0));
  select * into existing_request from private.prep_command_requests request where request.request_id = p_request_id;
  if existing_request.request_id is not null then
    if existing_request.command <> 'correct' or existing_request.request_payload <> payload then
      raise exception 'Prep request id was reused' using errcode = '23505'; end if;
    select * into task_row from public.prep_tasks task where task.id = existing_request.task_id;
    return task_row;
  end if;
  select * into task_row from public.prep_tasks task where task.id = p_task_id for update;
  if task_row.id is null or task_row.version <> p_expected_version or task_row.state <> 'completed' then
    raise exception 'Only the current completed prep task can be corrected' using errcode = '40001'; end if;
  if not public.has_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
    raise exception 'Not authorized to correct prep at this location' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-ledger:' || task_row.organization_id::text || ':' || task_row.location_id::text || ':' || movement.inventory_item_id::text, 0
  )) from public.inventory_transactions movement where movement.reference_type = 'prep_completion'
    and movement.reference_id = task_row.id order by movement.inventory_item_id;
  insert into private.prep_command_requests values (
    p_request_id, task_row.organization_id, task_row.id, 'correct', payload, actor_id, clock_timestamp()
  );
  insert into public.inventory_transactions (organization_id, location_id, inventory_item_id, unit_id,
    transaction_kind, quantity_delta, occurred_at, reference_type, reference_id, reason,
    created_by, approved_by, approved_at)
  select movement.organization_id, movement.location_id, movement.inventory_item_id, movement.unit_id,
    'manual_adjustment'::public.inventory_transaction_kind, -movement.quantity_delta,
    clock_timestamp(), 'prep_correction', task_row.id, clean_note, actor_id, actor_id, clock_timestamp()
  from public.inventory_transactions movement
  where movement.reference_type = 'prep_completion' and movement.reference_id = task_row.id;
  if not found then raise exception 'Prep completion movements are missing' using errcode = '23514'; end if;
  update public.prep_tasks set state = 'corrected', corrected_by = actor_id,
    corrected_at = clock_timestamp(), correction_note = clean_note,
    version = version + 1, updated_at = clock_timestamp()
  where id = task_row.id returning * into task_row;
  insert into public.audit_events (organization_id, location_id, actor_id, action, table_name,
    record_id, new_record, request_id) values (task_row.organization_id, task_row.location_id,
    actor_id, 'prep.task.corrected', 'prep_tasks', task_row.id::text, to_jsonb(task_row), p_request_id::text);
  return task_row;
end
$$;

-- Extend the existing ledger evidence trigger so browser sessions still cannot
-- forge prep movements outside the two actor-bound command functions above.
create or replace function public.guard_inventory_transaction_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  trusted_actor boolean := auth.uid() is null or coalesce(auth.role(), '') = 'service_role';
  count_row public.inventory_counts%rowtype;
  item_row public.inventory_items%rowtype;
  delivery_row public.deliveries%rowtype;
  delivery_line public.delivery_lines%rowtype;
  waste_row public.waste_records%rowtype;
  transfer_row public.inventory_transfers%rowtype;
  transfer_line public.inventory_transfer_lines%rowtype;
  prep_row public.prep_tasks%rowtype;
  prep_request private.prep_command_requests%rowtype;
  recipe_row public.recipes%rowtype;
  ingredient_row public.recipe_ingredients%rowtype;
  expected_quantity numeric;
  expected_cost bigint;
begin
  select * into item_row from public.inventory_items item where item.id = new.inventory_item_id;
  if item_row.id is null or item_row.organization_id <> new.organization_id
    or item_row.base_unit_id <> new.unit_id then
    raise exception 'Inventory ledger quantities must use the item base unit' using errcode = '23514';
  end if;
  if trusted_actor then return new; end if;

  if new.transaction_kind = 'count_adjustment' and new.reference_type = 'inventory_count'
    and new.reference_id is not null then
    select * into count_row from public.inventory_counts candidate where candidate.id = new.reference_id;
    if count_row.id is null or count_row.organization_id <> new.organization_id
      or count_row.location_id <> new.location_id or count_row.status <> 'pending'
      or count_row.counted_by <> new.created_by or new.approved_by is distinct from auth.uid()
      or new.approved_at is null or not exists (
        select 1 from private.inventory_count_approval_requests request
        where request.inventory_count_id = count_row.id and request.actor_id = auth.uid()
          and request.approve and request.completed_at is null
      ) then raise exception 'Inventory count adjustment evidence is invalid' using errcode = '42501'; end if;
    return new;
  end if;

  if new.transaction_kind = 'purchase' and new.reference_type = 'delivery'
    and new.reference_id is not null then
    select * into delivery_row from public.deliveries delivery where delivery.id = new.reference_id;
    select * into delivery_line from public.delivery_lines line
      where line.delivery_id = new.reference_id and line.inventory_item_id = new.inventory_item_id;
    if delivery_row.id is null or delivery_line.id is null
      or delivery_row.organization_id <> new.organization_id or delivery_row.location_id <> new.location_id
      or delivery_row.received_by <> auth.uid() or new.created_by <> auth.uid()
      or new.approved_by <> auth.uid() or new.approved_at is null or not exists (
        select 1 from private.operation_requests request
        where request.operation_kind = 'inventory.delivery_receive'
          and request.record_id = delivery_row.id and request.actor_id = auth.uid()
          and request.completed_at is null
      ) then raise exception 'Delivery inventory evidence is invalid' using errcode = '42501'; end if;
    expected_quantity := private.inventory_base_quantity(delivery_row.organization_id,
      delivery_line.inventory_item_id, delivery_line.unit_id, delivery_line.accepted_quantity);
    expected_cost := private.inventory_base_unit_cost(delivery_row.organization_id,
      delivery_line.inventory_item_id, delivery_line.unit_id, delivery_line.unit_price_cents);
    if new.quantity_delta is distinct from expected_quantity
      or new.unit_cost_cents is distinct from expected_cost
      or new.occurred_at is distinct from delivery_row.delivered_at then
      raise exception 'Delivery ledger quantity or cost is not canonical' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.transaction_kind = 'waste' and new.reference_type = 'waste_record'
    and new.reference_id is not null then
    select * into waste_row from public.waste_records waste where waste.id = new.reference_id;
    expected_quantity := private.inventory_base_quantity(waste_row.organization_id,
      waste_row.inventory_item_id, waste_row.unit_id, waste_row.quantity);
    expected_cost := case when waste_row.estimated_cost_cents is null then null
      else round(waste_row.estimated_cost_cents / expected_quantity)::bigint end;
    if waste_row.id is null or waste_row.organization_id <> new.organization_id
      or waste_row.location_id <> new.location_id or waste_row.status <> 'pending'
      or waste_row.recorded_by <> new.created_by or new.approved_by is distinct from auth.uid()
      or new.approved_at is null or new.quantity_delta is distinct from -expected_quantity
      or new.unit_cost_cents is distinct from expected_cost
      or new.occurred_at is distinct from waste_row.occurred_at or not exists (
        select 1 from private.operation_requests request
        where request.operation_kind = 'inventory.waste_review'
          and request.record_id = waste_row.id and request.actor_id = auth.uid()
          and request.completed_at is null
      ) then raise exception 'Waste inventory evidence is invalid' using errcode = '42501'; end if;
    return new;
  end if;

  if new.transaction_kind in ('transfer_in', 'transfer_out')
    and new.reference_type = 'inventory_transfer' and new.reference_id is not null then
    select * into transfer_row from public.inventory_transfers transfer where transfer.id = new.reference_id;
    select * into transfer_line from public.inventory_transfer_lines line
      where line.transfer_id = new.reference_id and line.inventory_item_id = new.inventory_item_id;
    if transfer_row.id is null or transfer_line.id is null
      or transfer_row.organization_id <> new.organization_id or transfer_row.status <> 'draft'
      or transfer_row.created_by <> new.created_by or new.approved_by is distinct from auth.uid()
      or new.approved_at is null or not exists (
        select 1 from private.operation_requests request
        where request.operation_kind = 'inventory.transfer_review'
          and request.record_id = transfer_row.id and request.actor_id = auth.uid()
          and request.completed_at is null
      ) then raise exception 'Transfer inventory evidence is invalid' using errcode = '42501'; end if;
    expected_quantity := private.inventory_base_quantity(transfer_row.organization_id,
      transfer_line.inventory_item_id, transfer_line.unit_id,
      case when new.transaction_kind = 'transfer_out' then transfer_line.sent_quantity
        else transfer_line.received_quantity end);
    if (new.transaction_kind = 'transfer_out' and (
        new.location_id <> transfer_row.from_location_id or new.quantity_delta is distinct from -expected_quantity
      )) or (new.transaction_kind = 'transfer_in' and (
        new.location_id <> transfer_row.to_location_id or new.quantity_delta is distinct from expected_quantity
      )) then raise exception 'Transfer ledger quantity or location is not canonical' using errcode = '23514'; end if;
    return new;
  end if;

  if new.reference_type = 'prep_completion' and new.reference_id is not null
    and new.transaction_kind in ('recipe_usage', 'manual_adjustment') then
    select * into prep_row from public.prep_tasks prep where prep.id = new.reference_id;
    select * into prep_request from private.prep_command_requests request
      where request.task_id = new.reference_id and request.command = 'complete'
        and request.created_by = auth.uid() order by request.created_at desc limit 1;
    if prep_row.id is null or prep_request.request_id is null
      or prep_row.organization_id <> new.organization_id or prep_row.location_id <> new.location_id
      or prep_row.state not in ('published', 'in_progress') or new.created_by <> auth.uid()
      or new.approved_by is distinct from auth.uid() or new.approved_at is null then
      raise exception 'Prep completion inventory evidence is invalid' using errcode = '42501';
    end if;
    if new.transaction_kind = 'recipe_usage' then
      select * into recipe_row from public.recipes recipe where recipe.id = prep_row.recipe_id;
      select * into ingredient_row from public.recipe_ingredients ingredient
        where ingredient.recipe_id = prep_row.recipe_id
          and ingredient.inventory_item_id = new.inventory_item_id;
      expected_quantity := round((ingredient_row.quantity / (1 - ingredient_row.waste_factor))
        * (((prep_request.request_payload ->> 'actual_yield')::numeric) / recipe_row.yield_quantity), 6);
      if ingredient_row.id is null or new.quantity_delta is distinct from -expected_quantity then
        raise exception 'Prep ingredient movement is not canonical' using errcode = '23514'; end if;
    else
      expected_quantity := (prep_request.request_payload ->> 'actual_yield')::numeric;
      if prep_row.output_inventory_item_id is null
        or prep_row.output_inventory_item_id <> new.inventory_item_id
        or new.quantity_delta is distinct from expected_quantity then
        raise exception 'Prep finished-batch movement is not canonical' using errcode = '23514'; end if;
    end if;
    return new;
  end if;

  if new.reference_type = 'prep_correction' and new.reference_id is not null
    and new.transaction_kind = 'manual_adjustment' then
    select * into prep_row from public.prep_tasks prep where prep.id = new.reference_id;
    select * into prep_request from private.prep_command_requests request
      where request.task_id = new.reference_id and request.command = 'correct'
        and request.created_by = auth.uid() order by request.created_at desc limit 1;
    if prep_row.id is null or prep_request.request_id is null or prep_row.state <> 'completed'
      or prep_row.organization_id <> new.organization_id or prep_row.location_id <> new.location_id
      or new.created_by <> auth.uid() or new.approved_by is distinct from auth.uid()
      or new.approved_at is null or not exists (
        select 1 from public.inventory_transactions original
        where original.reference_type = 'prep_completion' and original.reference_id = prep_row.id
          and original.inventory_item_id = new.inventory_item_id and original.unit_id = new.unit_id
          and original.quantity_delta = -new.quantity_delta
      ) then raise exception 'Prep correction inventory evidence is invalid' using errcode = '42501'; end if;
    return new;
  end if;

  raise exception 'Inventory ledger rows must be created by an authorized workflow' using errcode = '42501';
end
$$;

revoke all on function private.prep_completion_lines(uuid, numeric) from public, anon, authenticated;
revoke all on function public.save_prep_task(uuid, uuid, uuid, date, text, text, uuid, uuid, numeric, uuid, timestamptz, uuid, text, integer) from public, anon;
revoke all on function public.transition_prep_task(uuid, uuid, integer, text) from public, anon;
revoke all on function public.preview_prep_completion(uuid, numeric) from public, anon;
revoke all on function public.complete_prep_task(uuid, uuid, integer, numeric, boolean, text) from public, anon;
revoke all on function public.correct_prep_completion(uuid, uuid, integer, text) from public, anon;
grant execute on function public.save_prep_task(uuid, uuid, uuid, date, text, text, uuid, uuid, numeric, uuid, timestamptz, uuid, text, integer) to authenticated;
grant execute on function public.transition_prep_task(uuid, uuid, integer, text) to authenticated;
grant execute on function public.preview_prep_completion(uuid, numeric) to authenticated;
grant execute on function public.complete_prep_task(uuid, uuid, integer, numeric, boolean, text) to authenticated;
grant execute on function public.correct_prep_completion(uuid, uuid, integer, text) to authenticated;

comment on table public.prep_tasks is
  'Location-scoped manual prep plans with explicit publish, inventory-posting completion, and compensating correction.';
