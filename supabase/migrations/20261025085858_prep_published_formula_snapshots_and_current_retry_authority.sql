-- Freeze reviewed prep formulas at publication. No historical task is
-- backfilled: legacy active tasks require an explicit manager review action.
-- Saved commands retain current scope and original-actor identity; completed
-- movements and compensating corrections remain historical.
DO $reviewed$ BEGIN
  IF(SELECT md5(prosrc)FROM pg_proc WHERE oid='private.prep_completion_lines(uuid,numeric)'::regprocedure)IS DISTINCT FROM '8c9f85b5daeca208ffb15073539e992c'THEN RAISE EXCEPTION 'Reviewed prep definition drifted: private.prep_completion_lines';END IF;
  IF(SELECT md5(prosrc)FROM pg_proc WHERE oid='complete_prep_task(uuid,uuid,integer,numeric,boolean,text)'::regprocedure)IS DISTINCT FROM '5c104918acde7a04c9e628fdaf4ae933'THEN RAISE EXCEPTION 'Reviewed prep definition drifted: public.complete_prep_task';END IF;
  IF(SELECT md5(prosrc)FROM pg_proc WHERE oid='correct_prep_completion(uuid,uuid,integer,text)'::regprocedure)IS DISTINCT FROM 'de2870d9fea0c3d88e41cdbc91dffaf8'THEN RAISE EXCEPTION 'Reviewed prep definition drifted: public.correct_prep_completion';END IF;
  IF(SELECT md5(prosrc)FROM pg_proc WHERE oid='guard_inventory_transaction_evidence()'::regprocedure)IS DISTINCT FROM '4fced1864a42ab9ae6e6f622684473ec'THEN RAISE EXCEPTION 'Reviewed prep definition drifted: public.guard_inventory_transaction_evidence';END IF;
  IF(SELECT md5(prosrc)FROM pg_proc WHERE oid='preview_prep_completion(uuid,numeric)'::regprocedure)IS DISTINCT FROM 'e83bbcc0080769f1b2ede3a6effc1ca7'THEN RAISE EXCEPTION 'Reviewed prep definition drifted: public.preview_prep_completion';END IF;
  IF(SELECT md5(prosrc)FROM pg_proc WHERE oid='save_prep_task(uuid,uuid,uuid,date,text,text,uuid,uuid,numeric,uuid,timestamp with time zone,uuid,text,integer)'::regprocedure)IS DISTINCT FROM '310dda8602c3ef61f6e72f9ccf9d5643'THEN RAISE EXCEPTION 'Reviewed prep definition drifted: public.save_prep_task';END IF;
  IF(SELECT md5(prosrc)FROM pg_proc WHERE oid='transition_prep_task(uuid,uuid,integer,text)'::regprocedure)IS DISTINCT FROM 'fdc945e2b50b6d980df897b6f7ed8d6d'THEN RAISE EXCEPTION 'Reviewed prep definition drifted: public.transition_prep_task';END IF;
END $reviewed$;

ALTER TABLE public.prep_tasks
  ADD COLUMN formula_snapshot jsonb,
  ADD COLUMN formula_captured_at timestamptz,
  ADD COLUMN formula_captured_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN formula_recipe_name text,
  ADD COLUMN formula_recipe_version integer CHECK(formula_recipe_version IS NULL OR formula_recipe_version>0),
  ADD COLUMN formula_target_symbol text,
  ADD CONSTRAINT prep_formula_capture_evidence CHECK(
    (formula_snapshot IS NULL AND formula_captured_at IS NULL AND formula_captured_by IS NULL
      AND formula_recipe_name IS NULL AND formula_recipe_version IS NULL AND formula_target_symbol IS NULL)
    OR (formula_snapshot IS NOT NULL AND jsonb_typeof(formula_snapshot)='object' AND formula_captured_at IS NOT NULL
      AND formula_captured_by IS NOT NULL AND formula_target_symbol IS NOT NULL)
  );
ALTER TABLE private.prep_command_requests DROP CONSTRAINT prep_command_requests_command_check;
ALTER TABLE private.prep_command_requests ADD CONSTRAINT prep_command_requests_command_check
  CHECK(command IN('save','publish','start','complete','correct','bind_formula'));

-- Existing tasks are intentionally not backfilled with an invented historical
-- recipe. Their original fields, records and completed movements remain intact.
CREATE FUNCTION private.capture_prep_formula(p_task_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET row_security=off
AS $capture$
DECLARE
  task_row public.prep_tasks%rowtype;
  recipe_row public.recipes%rowtype;
  ingredient_row public.recipe_ingredients%rowtype;
  item_row public.inventory_items%rowtype;
  source_unit public.measurement_units%rowtype;
  base_unit public.measurement_units%rowtype;
  target_unit public.measurement_units%rowtype;
  recipe_version public.inventory_recipe_versions%rowtype;
  recipe_evidence jsonb;
  source_ingredients jsonb;
  formula_lines jsonb := '[]'::jsonb;
  recipe_yield_in_target numeric;
  normalized_quantity numeric;
  ingredient_conversion numeric;
  yield_conversion numeric;
BEGIN
  SELECT * INTO task_row FROM public.prep_tasks WHERE id=p_task_id;
  IF task_row.id IS NULL THEN RAISE EXCEPTION 'Prep task is unavailable' USING ERRCODE='23514'; END IF;
  IF task_row.target_quantity IS NULL OR task_row.target_quantity<=0 OR task_row.target_quantity::text IN('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'The prep target must be finite and positive' USING ERRCODE='23514'; END IF;
  -- The conversion catalog is administration-only. This short publication
  -- barrier also excludes a new preferred item-specific conversion phantom.
  LOCK TABLE public.unit_conversions IN SHARE MODE;
  SELECT * INTO target_unit FROM public.measurement_units
  WHERE organization_id=task_row.organization_id AND id=task_row.target_unit_id AND is_active FOR SHARE;
  IF target_unit.id IS NULL THEN RAISE EXCEPTION 'The target unit is unavailable' USING ERRCODE='23514'; END IF;
  IF task_row.recipe_id IS NOT NULL THEN
    SELECT * INTO recipe_row FROM public.recipes
    WHERE organization_id=task_row.organization_id AND id=task_row.recipe_id AND is_active FOR SHARE;
    IF recipe_row.id IS NULL OR recipe_row.yield_quantity<=0
      OR recipe_row.yield_quantity::text IN('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'The current recipe must be active with a finite positive yield' USING ERRCODE='23514';
    END IF;
    PERFORM ingredient.id FROM public.recipe_ingredients ingredient
    WHERE ingredient.organization_id=task_row.organization_id AND ingredient.recipe_id=recipe_row.id
    ORDER BY ingredient.id FOR SHARE;
    IF NOT EXISTS(SELECT 1 FROM public.recipe_ingredients ingredient WHERE ingredient.recipe_id=recipe_row.id) THEN
      RAISE EXCEPTION 'A recipe must have ingredient evidence before publication' USING ERRCODE='23514';
    END IF;
  END IF;
  PERFORM item.id FROM public.inventory_items item
  WHERE item.organization_id=task_row.organization_id AND(item.id=task_row.output_inventory_item_id
    OR item.id IN(SELECT ingredient.inventory_item_id FROM public.recipe_ingredients ingredient WHERE ingredient.recipe_id=task_row.recipe_id))
  ORDER BY item.id FOR SHARE;
  PERFORM unit.id FROM public.measurement_units unit
  WHERE unit.organization_id=task_row.organization_id AND(unit.id=recipe_row.yield_unit_id OR unit.id=task_row.target_unit_id
    OR unit.id IN(SELECT ingredient.unit_id FROM public.recipe_ingredients ingredient WHERE ingredient.recipe_id=task_row.recipe_id)
    OR unit.id IN(SELECT item.base_unit_id FROM public.inventory_items item WHERE item.organization_id=task_row.organization_id
      AND(item.id=task_row.output_inventory_item_id OR item.id IN(SELECT ingredient.inventory_item_id FROM public.recipe_ingredients ingredient WHERE ingredient.recipe_id=task_row.recipe_id))))
  ORDER BY unit.id FOR SHARE;
  IF task_row.recipe_id IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.measurement_units unit WHERE unit.organization_id=task_row.organization_id AND unit.id=recipe_row.yield_unit_id AND unit.is_active) THEN
      RAISE EXCEPTION 'The recipe yield unit is unavailable' USING ERRCODE='23514';
    END IF;
    yield_conversion := private.inventory_conversion_multiplier(task_row.organization_id,task_row.output_inventory_item_id,recipe_row.yield_unit_id,task_row.target_unit_id);
    recipe_yield_in_target := recipe_row.yield_quantity * yield_conversion;
    IF recipe_yield_in_target<=0 OR recipe_yield_in_target::text IN('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'The recipe yield conversion must be finite and positive' USING ERRCODE='23514';
    END IF;
    FOR ingredient_row IN SELECT * FROM public.recipe_ingredients WHERE recipe_id=recipe_row.id ORDER BY inventory_item_id LOOP
      SELECT * INTO item_row FROM public.inventory_items WHERE organization_id=task_row.organization_id
        AND id=ingredient_row.inventory_item_id AND is_active AND track_inventory;
      SELECT * INTO source_unit FROM public.measurement_units WHERE organization_id=task_row.organization_id AND id=ingredient_row.unit_id AND is_active;
      SELECT * INTO base_unit FROM public.measurement_units WHERE organization_id=task_row.organization_id AND id=item_row.base_unit_id AND is_active;
      IF item_row.id IS NULL OR source_unit.id IS NULL OR base_unit.id IS NULL
        OR ingredient_row.quantity<=0 OR ingredient_row.quantity::text IN('NaN','Infinity','-Infinity')
        OR ingredient_row.waste_factor<0 OR ingredient_row.waste_factor>=1
        OR ingredient_row.waste_factor::text IN('NaN','Infinity','-Infinity') THEN
        RAISE EXCEPTION 'Every recipe ingredient must have an active tracked item, unit and finite quantity' USING ERRCODE='23514';
      END IF;
      ingredient_conversion := private.inventory_conversion_multiplier(task_row.organization_id,item_row.id,ingredient_row.unit_id,item_row.base_unit_id);
      normalized_quantity := (ingredient_row.quantity/(1-ingredient_row.waste_factor))*ingredient_conversion;
      IF normalized_quantity<=0 OR normalized_quantity::text IN('NaN','Infinity','-Infinity') THEN
        RAISE EXCEPTION 'Every recipe ingredient conversion must be finite and positive' USING ERRCODE='23514';
      END IF;
      formula_lines := formula_lines || jsonb_build_array(jsonb_build_object(
        'inventory_item_id',item_row.id,'item_name',item_row.name,'unit_id',base_unit.id,'unit_symbol',base_unit.symbol,
        'source_unit_id',ingredient_row.unit_id,'conversion_factor',ingredient_conversion,
        'movement','consume','quantity_per_recipe',normalized_quantity,'normalizing_yield',recipe_yield_in_target));
    END LOOP;
    SELECT jsonb_agg(jsonb_build_object('inventoryItemId',ingredient.inventory_item_id,'unitId',ingredient.unit_id,
      'quantity',ingredient.quantity,'wasteFactor',ingredient.waste_factor)ORDER BY ingredient.inventory_item_id)
      INTO source_ingredients FROM public.recipe_ingredients ingredient WHERE ingredient.recipe_id=recipe_row.id;
    recipe_evidence := jsonb_build_object('name',recipe_row.name,'yieldQuantity',recipe_row.yield_quantity,
      'yieldUnitId',recipe_row.yield_unit_id,'menuPriceCents',recipe_row.menu_price_cents,'isActive',recipe_row.is_active,'ingredients',source_ingredients);
    -- A direct legacy SQL recipe may have no matching immutable catalog
    -- version. Capture its actual content, but do not invent a version label.
    SELECT * INTO recipe_version FROM public.inventory_recipe_versions version
      WHERE version.organization_id=task_row.organization_id AND version.recipe_id=recipe_row.id AND version.snapshot=recipe_evidence
      ORDER BY version.version_number DESC LIMIT 1;
  END IF;
  IF task_row.output_inventory_item_id IS NOT NULL THEN
    SELECT * INTO item_row FROM public.inventory_items WHERE organization_id=task_row.organization_id
      AND id=task_row.output_inventory_item_id AND is_active AND track_inventory AND base_unit_id=task_row.target_unit_id;
    IF item_row.id IS NULL THEN RAISE EXCEPTION 'The output must use its active tracked base unit' USING ERRCODE='23514'; END IF;
    formula_lines := formula_lines || jsonb_build_array(jsonb_build_object('inventory_item_id',item_row.id,'item_name',item_row.name,
      'unit_id',target_unit.id,'unit_symbol',target_unit.symbol,'movement','produce','quantity_per_recipe',1,'normalizing_yield',1));
  END IF;
  IF jsonb_array_length(formula_lines)=0 THEN RAISE EXCEPTION 'The plan has no inventory formula' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('schema_version',1,'source_task_version',task_row.version,'recipe_id',recipe_row.id,
    'recipe_name',recipe_row.name,'recipe_version_id',recipe_version.id,'recipe_version_number',recipe_version.version_number,
    'recipe_yield_conversion',yield_conversion,'recipe_evidence',recipe_evidence-'menuPriceCents','target_unit_id',target_unit.id,'target_unit_symbol',target_unit.symbol,'lines',formula_lines);
END
$capture$;
REVOKE ALL ON FUNCTION private.capture_prep_formula(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.prep_completion_lines(p_task_id uuid,p_actual_yield numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET row_security=off
AS $lines$
DECLARE task_row public.prep_tasks%rowtype; frozen_line jsonb; item_row public.inventory_items%rowtype;
  unit_row public.measurement_units%rowtype; movement_quantity numeric; available_quantity numeric; result jsonb:='[]'::jsonb;
BEGIN
  IF p_actual_yield IS NULL OR p_actual_yield<=0 OR p_actual_yield>=1000000000000 OR scale(p_actual_yield)>4
    OR p_actual_yield::text IN('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'Actual yield must be finite, positive and at most four decimals' USING ERRCODE='22023';
  END IF;
  SELECT * INTO task_row FROM public.prep_tasks WHERE id=p_task_id;
  IF task_row.formula_snapshot IS NULL THEN
    RAISE EXCEPTION 'A manager must review and capture the formula for this existing task before completion' USING ERRCODE='23514';
  END IF;
  IF task_row.formula_snapshot->>'schema_version' IS DISTINCT FROM '1'
    OR jsonb_typeof(task_row.formula_snapshot->'lines') IS DISTINCT FROM 'array'
    OR jsonb_array_length(task_row.formula_snapshot->'lines')=0 THEN
    RAISE EXCEPTION 'The captured prep formula is unavailable' USING ERRCODE='23514';
  END IF;
  FOR frozen_line IN SELECT value FROM jsonb_array_elements(task_row.formula_snapshot->'lines') LOOP
    SELECT * INTO item_row FROM public.inventory_items WHERE organization_id=task_row.organization_id
      AND id=(frozen_line->>'inventory_item_id')::uuid AND base_unit_id=(frozen_line->>'unit_id')::uuid AND is_active AND track_inventory;
    SELECT * INTO unit_row FROM public.measurement_units WHERE organization_id=task_row.organization_id
      AND id=(frozen_line->>'unit_id')::uuid AND is_active;
    IF item_row.id IS NULL OR unit_row.id IS NULL THEN
      RAISE EXCEPTION 'Every captured ingredient and output must still use an active tracked item and base unit' USING ERRCODE='23514';
    END IF;
    movement_quantity := round((frozen_line->>'quantity_per_recipe')::numeric
      * p_actual_yield/(frozen_line->>'normalizing_yield')::numeric,6);
    IF movement_quantity<=0 OR movement_quantity::text IN('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'A captured movement is outside supported inventory precision' USING ERRCODE='23514';
    END IF;
    SELECT coalesce(on_hand.quantity_on_hand,0)INTO available_quantity FROM public.inventory_on_hand on_hand
      WHERE on_hand.organization_id=task_row.organization_id AND on_hand.location_id=task_row.location_id AND on_hand.inventory_item_id=item_row.id;
    available_quantity := coalesce(available_quantity,0);
    result := result || jsonb_build_array(jsonb_build_object('inventory_item_id',item_row.id,'item_name',frozen_line->>'item_name',
      'unit_id',unit_row.id,'unit_symbol',frozen_line->>'unit_symbol','quantity',movement_quantity,'on_hand',available_quantity,
      'movement',frozen_line->>'movement','insufficient',frozen_line->>'movement'='consume'AND available_quantity<movement_quantity));
  END LOOP;
  RETURN(SELECT jsonb_agg(line ORDER BY line->>'movement',line->>'item_name')FROM jsonb_array_elements(result)line);
END
$lines$;

-- All accepted inventory postings advance one private location/item revision.
-- Advisory locks serialize normal operations; this real row write also rejects
-- a repeatable-read posting whose stock snapshot predates another writer.
-- No quantities or historical movements are copied/backfilled into this table.
CREATE TABLE private.inventory_ledger_scopes (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision>0),
  PRIMARY KEY(organization_id,location_id,inventory_item_id)
);
ALTER TABLE private.inventory_ledger_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.inventory_ledger_scopes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.inventory_ledger_scopes FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.advance_inventory_ledger_scope()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET row_security=off
AS $scope$
BEGIN
  INSERT INTO private.inventory_ledger_scopes AS scope(organization_id,location_id,inventory_item_id,revision)
  VALUES(NEW.organization_id,NEW.location_id,NEW.inventory_item_id,1)
  ON CONFLICT(organization_id,location_id,inventory_item_id) DO UPDATE SET revision=scope.revision+1;
  RETURN NEW;
END
$scope$;
REVOKE ALL ON FUNCTION private.advance_inventory_ledger_scope() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER inventory_ledger_scope_revision AFTER INSERT ON public.inventory_transactions
FOR EACH ROW EXECUTE FUNCTION private.advance_inventory_ledger_scope();


CREATE OR REPLACE FUNCTION public.complete_prep_task(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_actual_yield numeric, p_override_insufficient boolean, p_completion_note text DEFAULT NULL::text)
 RETURNS prep_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid := auth.uid(); task_row public.prep_tasks%rowtype;
  existing_request private.prep_command_requests%rowtype; lines jsonb; line jsonb;
  warnings jsonb; payload jsonb; clean_note text := nullif(btrim(p_completion_note), '');
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_request_id is null or p_task_id is null or p_expected_version is null or p_expected_version<=0
    or p_actual_yield is null or p_actual_yield<=0 or p_actual_yield>=1000000000000 or scale(p_actual_yield)>4
    or p_actual_yield::text in('NaN','Infinity','-Infinity') or (clean_note is not null and length(clean_note) > 2000) then
    raise exception 'Invalid prep completion' using errcode = '22023'; end if;
  payload := jsonb_build_object('task_id', p_task_id, 'expected_version', p_expected_version,
    'actual_yield', p_actual_yield, 'override_insufficient', coalesce(p_override_insufficient, false),
    'completion_note', clean_note);
  select * into task_row from public.prep_tasks task where task.id=p_task_id;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.complete') then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
  if task_row.assignee_user_id is not null and task_row.assignee_user_id<>actor_id
    and not public.has_current_location_capability(task_row.organization_id,task_row.location_id,'prep.manage') then
    raise exception 'This prep task is assigned to another teammate' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prep-command:' || p_request_id::text, 0));
  select * into task_row from public.prep_tasks task where task.id=p_task_id;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.complete') then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
  if task_row.assignee_user_id is not null and task_row.assignee_user_id<>actor_id
    and not public.has_current_location_capability(task_row.organization_id,task_row.location_id,'prep.manage') then
    raise exception 'This prep task is assigned to another teammate' using errcode='42501';
  end if;

  select * into existing_request from private.prep_command_requests request where request.request_id = p_request_id;
  if existing_request.request_id is not null then
    if existing_request.created_by is distinct from actor_id or existing_request.command <> 'complete' or existing_request.request_payload <> payload then
      raise exception 'Prep request id was reused' using errcode = '23505'; end if;
    select * into task_row from public.prep_tasks task where task.id = existing_request.task_id;
    return task_row;
  end if;
  select * into task_row from public.prep_tasks task where task.id = p_task_id for update;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.complete') then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
  if task_row.assignee_user_id is not null and task_row.assignee_user_id<>actor_id
    and not public.has_current_location_capability(task_row.organization_id,task_row.location_id,'prep.manage') then
    raise exception 'This prep task is assigned to another teammate' using errcode='42501';
  end if;

  if task_row.id is null or task_row.version <> p_expected_version or task_row.state not in ('published', 'in_progress') then
    raise exception 'Prep task changed; refresh before completing' using errcode = 'PT409'; end if;
  if not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.complete') then
    raise exception 'Not authorized to complete prep at this location' using errcode = '42501'; end if;
  if task_row.assignee_user_id is not null and task_row.assignee_user_id <> actor_id
    and not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
    raise exception 'This prep task is assigned to another teammate' using errcode = '42501'; end if;

  if task_row.formula_snapshot is null then raise exception 'A manager must review the existing formula before completion'using errcode='23514';end if;
  perform pg_advisory_xact_lock(hashtextextended('inventory-ledger:'||task_row.organization_id::text||':'||task_row.location_id::text||':'||item_id::text,0))
  from(select distinct(frozen_component->>'inventory_item_id')::uuid item_id from jsonb_array_elements(task_row.formula_snapshot->'lines')frozen_component)items order by item_id;
  perform item.id from public.inventory_items item where item.organization_id=task_row.organization_id
    and item.id in(select(frozen_component->>'inventory_item_id')::uuid from jsonb_array_elements(task_row.formula_snapshot->'lines')frozen_component)
    order by item.id for share;
  perform unit.id from public.measurement_units unit where unit.organization_id=task_row.organization_id
    and unit.id in(select(frozen_component->>'unit_id')::uuid from jsonb_array_elements(task_row.formula_snapshot->'lines')frozen_component)
    order by unit.id for share;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.complete') then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
  if task_row.assignee_user_id is not null and task_row.assignee_user_id<>actor_id
    and not public.has_current_location_capability(task_row.organization_id,task_row.location_id,'prep.manage') then
    raise exception 'This prep task is assigned to another teammate' using errcode='42501';
  end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.correct_prep_completion(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_correction_note text)
 RETURNS prep_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid := auth.uid(); task_row public.prep_tasks%rowtype;
  existing_request private.prep_command_requests%rowtype;
  payload jsonb; clean_note text := nullif(btrim(p_correction_note), '');
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  if p_request_id is null or p_task_id is null or p_expected_version is null or p_expected_version<=0 or clean_note is null or length(clean_note) > 2000 then
    raise exception 'A correction reason is required' using errcode = '22023'; end if;
  payload := jsonb_build_object('task_id', p_task_id, 'expected_version', p_expected_version, 'correction_note', clean_note);
  select * into task_row from public.prep_tasks task where task.id=p_task_id;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prep-command:' || p_request_id::text, 0));
  select * into task_row from public.prep_tasks task where task.id=p_task_id;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;

  select * into existing_request from private.prep_command_requests request where request.request_id = p_request_id;
  if existing_request.request_id is not null then
    if existing_request.created_by is distinct from actor_id or existing_request.command <> 'correct' or existing_request.request_payload <> payload then
      raise exception 'Prep request id was reused' using errcode = '23505'; end if;
    select * into task_row from public.prep_tasks task where task.id = existing_request.task_id;
    return task_row;
  end if;
  select * into task_row from public.prep_tasks task where task.id = p_task_id for update;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;

  if task_row.id is null or task_row.version <> p_expected_version or task_row.state <> 'completed' then
    raise exception 'Only the current completed prep task can be corrected' using errcode = 'PT409'; end if;
  if not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
    raise exception 'Not authorized to correct prep at this location' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-ledger:' || task_row.organization_id::text || ':' || task_row.location_id::text || ':' || movement.inventory_item_id::text, 0
  )) from public.inventory_transactions movement where movement.reference_type = 'prep_completion'
    and movement.reference_id = task_row.id order by movement.inventory_item_id;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.guard_inventory_transaction_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
  prep_formula_line jsonb;
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
    select candidate into prep_formula_line from jsonb_array_elements(private.prep_completion_lines(
      prep_row.id,(prep_request.request_payload->>'actual_yield')::numeric))candidate
      where candidate->>'inventory_item_id'=new.inventory_item_id::text
        and candidate->>'unit_id'=new.unit_id::text
        and candidate->>'movement'=case when new.transaction_kind='recipe_usage'then 'consume'else 'produce'end;
    expected_quantity:=(prep_formula_line->>'quantity')::numeric;
    if prep_formula_line is null or new.quantity_delta is distinct from(
      case when new.transaction_kind='recipe_usage'then -expected_quantity else expected_quantity end)then
      raise exception 'Prep movement does not match the captured formula and base unit'using errcode='23514';end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.preview_prep_completion(p_task_id uuid, p_actual_yield numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare task_row public.prep_tasks%rowtype; lines jsonb;
begin
  if auth.uid() is null or p_task_id is null or p_actual_yield is null or p_actual_yield<=0
    or p_actual_yield>=1000000000000 or scale(p_actual_yield)>4 or p_actual_yield::text in('NaN','Infinity','-Infinity') then raise exception 'Invalid completion preview' using errcode = '22023'; end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.save_prep_task(p_request_id uuid, p_task_id uuid, p_location_id uuid, p_business_date date, p_service_period text, p_station text, p_recipe_id uuid, p_output_inventory_item_id uuid, p_target_quantity numeric, p_target_unit_id uuid, p_due_at timestamp with time zone, p_assignee_user_id uuid, p_note text, p_expected_version integer DEFAULT NULL::integer)
 RETURNS prep_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
    or p_target_quantity is null or p_target_quantity<=0 or p_target_quantity>=1000000000000
    or scale(p_target_quantity)>4 or p_target_quantity::text in('NaN','Infinity','-Infinity') or p_due_at is null
    or (clean_note is not null and length(clean_note) > 2000)
    or (p_recipe_id is null and p_output_inventory_item_id is null) then
    raise exception 'Invalid prep task payload' using errcode = '22023';
  end if;

  select * into location_row from public.locations location
  where location.id = p_location_id and location.is_active for update;
  if location_row.id is null or not public.has_current_location_capability(
    location_row.organization_id, location_row.id, 'prep.manage'
  ) then raise exception 'Not authorized to manage prep at this location' using errcode = '42501'; end if;

  payload := jsonb_build_object('task_id', p_task_id, 'location_id', p_location_id,
    'business_date', p_business_date, 'service_period', p_service_period, 'station', clean_station,
    'recipe_id', p_recipe_id, 'output_inventory_item_id', p_output_inventory_item_id,
    'target_quantity', p_target_quantity, 'target_unit_id', p_target_unit_id, 'due_at', p_due_at,
    'assignee_user_id', p_assignee_user_id, 'note', clean_note, 'expected_version', p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended('prep-command:' || p_request_id::text, 0));
  if not public.can_access_location(location_row.organization_id,location_row.id)or not public.has_current_location_capability(location_row.organization_id,location_row.id,'prep.manage')then raise exception 'Current prep authority is required'using errcode='42501';end if;
  select * into existing_request from private.prep_command_requests request where request.request_id = p_request_id;
  if existing_request.request_id is not null then
    if existing_request.created_by is distinct from actor_id or existing_request.command <> 'save' or existing_request.request_payload <> payload then
      raise exception 'Prep request id was reused' using errcode = '23505';
    end if;
    select * into task_row from public.prep_tasks task where task.id = existing_request.task_id;
    return task_row;
  end if;

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

  select * into task_row from public.prep_tasks task where task.id = p_task_id for update;
  if not public.has_current_location_capability(location_row.organization_id,location_row.id,'prep.manage')then raise exception 'Current prep authority is required'using errcode='42501';end if;
  if task_row.id is null then
    if p_expected_version is not null then raise exception 'Prep task changed; refresh before saving' using errcode = 'PT409'; end if;
    insert into public.prep_tasks (id, organization_id, location_id, business_date, service_period,
      station, recipe_id, output_inventory_item_id, target_quantity, target_unit_id, due_at,
      assignee_user_id, note, created_by)
    values (p_task_id, location_row.organization_id, location_row.id, p_business_date,
      p_service_period, clean_station, p_recipe_id, p_output_inventory_item_id,
      p_target_quantity, p_target_unit_id, p_due_at, p_assignee_user_id, clean_note, actor_id)
    returning * into task_row;
  else
    if task_row.organization_id <> location_row.organization_id or task_row.location_id <> location_row.id
      or task_row.state <> 'draft' or p_expected_version is null or task_row.version <> p_expected_version then
      raise exception 'Only the current draft can be edited; refresh before saving' using errcode = 'PT409';
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
$function$
;

CREATE OR REPLACE FUNCTION public.transition_prep_task(p_request_id uuid, p_task_id uuid, p_expected_version integer, p_command text)
 RETURNS prep_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid:=auth.uid();task_row public.prep_tasks%rowtype;
  existing_request private.prep_command_requests%rowtype;captured jsonb;
  payload jsonb:=jsonb_build_object('task_id',p_task_id,'expected_version',p_expected_version,'command',p_command);
begin
  if actor_id is null then raise exception 'Authentication is required' using errcode='42501';end if;
  if p_request_id is null or p_task_id is null or p_expected_version is null or p_expected_version<=0
    or p_command is null or p_command not in('publish','start','bind_formula') then
    raise exception 'A valid prep transition and current version are required' using errcode='22023';end if;
  select * into task_row from public.prep_tasks where id=p_task_id;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, case when p_command in('publish','bind_formula')then 'prep.manage'else 'prep.complete'end) then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
  if p_command='start'and task_row.assignee_user_id is not null and task_row.assignee_user_id<>actor_id
    and not public.has_current_location_capability(task_row.organization_id,task_row.location_id,'prep.manage')then
    raise exception 'This prep task is assigned to another teammate'using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('prep-command:'||p_request_id::text,0));
  select * into task_row from public.prep_tasks where id=p_task_id;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, case when p_command in('publish','bind_formula')then 'prep.manage'else 'prep.complete'end) then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
  if p_command='start'and task_row.assignee_user_id is not null and task_row.assignee_user_id<>actor_id
    and not public.has_current_location_capability(task_row.organization_id,task_row.location_id,'prep.manage')then
    raise exception 'This prep task is assigned to another teammate'using errcode='42501';end if;
  select * into existing_request from private.prep_command_requests where request_id=p_request_id;
  if existing_request.request_id is not null then
    if existing_request.created_by is distinct from actor_id or existing_request.command<>p_command
      or existing_request.request_payload<>payload then raise exception 'Prep request id was reused'using errcode='23505';end if;
    return task_row;
  end if;
  select * into task_row from public.prep_tasks where id=p_task_id for update;
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, case when p_command in('publish','bind_formula')then 'prep.manage'else 'prep.complete'end) then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
  if p_command='start'and task_row.assignee_user_id is not null and task_row.assignee_user_id<>actor_id
    and not public.has_current_location_capability(task_row.organization_id,task_row.location_id,'prep.manage')then
    raise exception 'This prep task is assigned to another teammate'using errcode='42501';end if;
  if task_row.version<>p_expected_version then raise exception 'Prep task changed; refresh before continuing'using errcode='PT409';end if;
  if p_command='publish' then
    if task_row.state<>'draft'then raise exception 'Only a draft can be published'using errcode='23514';end if;
    captured:=private.capture_prep_formula(task_row.id);
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
    update public.prep_tasks set state='published',published_by=actor_id,published_at=clock_timestamp(),
      formula_snapshot=captured,formula_captured_at=clock_timestamp(),formula_captured_by=actor_id,
      formula_recipe_name=captured->>'recipe_name',formula_recipe_version=(captured->>'recipe_version_number')::integer,
      formula_target_symbol=captured->>'target_unit_symbol',version=version+1,updated_at=clock_timestamp()
      where id=task_row.id returning * into task_row;
  elsif p_command='bind_formula'then
    if task_row.state not in('published','in_progress')or task_row.formula_snapshot is not null then
      raise exception 'Only an unbound existing published task needs formula review'using errcode='23514';end if;
    captured:=private.capture_prep_formula(task_row.id);
  if task_row.id is null or not public.can_access_location(task_row.organization_id, task_row.location_id)
    or not public.has_current_location_capability(task_row.organization_id, task_row.location_id, 'prep.manage') then
    raise exception 'Current prep authority is required' using errcode='42501';
  end if;
    update public.prep_tasks set formula_snapshot=captured,formula_captured_at=clock_timestamp(),formula_captured_by=actor_id,
      formula_recipe_name=captured->>'recipe_name',formula_recipe_version=(captured->>'recipe_version_number')::integer,
      formula_target_symbol=captured->>'target_unit_symbol',version=version+1,updated_at=clock_timestamp()
      where id=task_row.id returning * into task_row;
  else
    if task_row.state<>'published'then raise exception 'Only a published task can be started'using errcode='23514';end if;
    if task_row.formula_snapshot is null then raise exception 'A manager must review the existing formula before starting'using errcode='23514';end if;
    if task_row.assignee_user_id is not null and task_row.assignee_user_id<>actor_id
      and not public.has_current_location_capability(task_row.organization_id,task_row.location_id,'prep.manage')then
      raise exception 'This prep task is assigned to another teammate'using errcode='42501';end if;
    update public.prep_tasks set state='in_progress',started_by=actor_id,started_at=clock_timestamp(),
      version=version+1,updated_at=clock_timestamp()where id=task_row.id returning * into task_row;
  end if;
  insert into private.prep_command_requests values(p_request_id,task_row.organization_id,task_row.id,p_command,payload,actor_id,clock_timestamp());
  insert into public.audit_events(organization_id,location_id,actor_id,action,table_name,record_id,new_record,request_id)
    values(task_row.organization_id,task_row.location_id,actor_id,'prep.task.'||p_command,'prep_tasks',task_row.id::text,to_jsonb(task_row),p_request_id::text);
  return task_row;
end
$function$
;

UPDATE private.runtime_schema_contract_expected expected SET migration_head='20261025085858',table_fingerprint=s.value->>'tableFingerprint',function_fingerprint=s.value->>'functionFingerprint',access_fingerprint=s.value->>'accessFingerprint',captured_at=clock_timestamp()FROM(SELECT private.compute_runtime_schema_fingerprints()value)s WHERE expected.contract_version='runtime-schema-v2';
