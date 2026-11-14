create table private.church_sandwich_register_checks (
  organization_id uuid not null,
  location_id uuid not null,
  id uuid not null,
  check_sequence bigint generated always as identity,
  recipe_key text not null,
  formula_revision integer not null,
  square_item_id text not null check (square_item_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  square_catalog_version text not null check (square_catalog_version ~ '^[1-9][0-9]{0,18}$'),
  outcome text not null check (outcome in ('matched','mismatch','unavailable')),
  device text not null check (length(device) between 1 and 120),
  reference text not null check (length(reference) between 1 and 300),
  recorded_at timestamptz not null check (isfinite(recorded_at)),
  recorded_by uuid not null,
  recorded_by_name text not null check (length(recorded_by_name) between 1 and 120),
  primary key(location_id,id),
  foreign key(organization_id,location_id) references public.locations(organization_id,id),
  foreign key(location_id,recipe_key,formula_revision)
    references private.church_sandwich_formula_revisions(location_id,recipe_key,revision)
);

create index church_sandwich_register_checks_latest_idx
  on private.church_sandwich_register_checks(location_id,recipe_key,check_sequence desc);
alter table private.church_sandwich_register_checks enable row level security;
alter table private.church_sandwich_register_checks force row level security;
revoke all on private.church_sandwich_register_checks from public,anon,authenticated,service_role;
create trigger church_sandwich_register_checks_append_only
  before update or delete on private.church_sandwich_register_checks
  for each row execute function public.prevent_ledger_mutation();

create function private.church_sandwich_register_check_view(p_check private.church_sandwich_register_checks)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id',p_check.id,'recipeKey',p_check.recipe_key,'formulaRevision',p_check.formula_revision,
    'squareItemId',p_check.square_item_id,'squareCatalogVersion',p_check.square_catalog_version,
    'outcome',p_check.outcome,'device',p_check.device,'reference',p_check.reference,
    'recordedAt',p_check.recorded_at,'recordedByName',p_check.recorded_by_name
  )
$$;

create function public.list_church_sandwich_register_checks(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
begin
  if organization is null or not private.user_has_capability(auth.uid(),organization,p_location_id,'recipe.manage',business_date) then
    raise exception 'Church Street recipe management access is required' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(private.church_sandwich_register_check_view(latest) order by latest.recipe_key),'[]'::jsonb)
    from (
      select distinct on (check_record.recipe_key) check_record.*
      from private.church_sandwich_register_checks check_record
      where check_record.organization_id = organization and check_record.location_id = p_location_id
      order by check_record.recipe_key,check_record.check_sequence desc
    ) latest
  );
end
$$;

create function public.get_church_sandwich_register_check_receipt(
  p_actor_id uuid,p_location_id uuid,p_request_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  recorded private.church_sandwich_register_checks%rowtype;
begin
  if organization is null or not private.user_has_capability(p_actor_id,organization,p_location_id,'recipe.manage',business_date) then
    raise exception 'Church Street recipe management access is required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'A register check request ID is required' using errcode = '22023';
  end if;

  select * into recorded from private.church_sandwich_register_checks check_record
  where check_record.organization_id = organization and check_record.location_id = p_location_id and check_record.id = p_request_id;
  if not found then
    return null;
  end if;
  if recorded.recorded_by is distinct from p_actor_id then
    raise exception 'This register check request was already used for a different recording' using errcode = 'PT409';
  end if;
  return private.church_sandwich_register_check_view(recorded);
end
$$;

-- The server checks the exact live Square item and catalog version before calling this service-only RPC.
-- The outcome records what a manager observed on the register.
create function public.record_church_sandwich_register_check(
  p_actor_id uuid,p_location_id uuid,p_request_id uuid,p_recipe_key text,p_formula_revision integer,
  p_square_item_id text,p_square_catalog_version text,p_outcome text,p_device text,p_reference text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  ingredients text[] := private.church_sandwich_formula_ingredients(p_recipe_key);
  ingredient text;
  clean_device text := btrim(p_device);
  clean_reference text := btrim(p_reference);
  recorded private.church_sandwich_register_checks%rowtype;
  formula private.church_sandwich_formula_revisions%rowtype;
  actor_name text;
begin
  if organization is null or not private.user_has_capability(p_actor_id,organization,p_location_id,'recipe.manage',business_date) then
    raise exception 'Church Street recipe management access is required' using errcode = '42501';
  end if;
  if p_request_id is null or ingredients is null or p_formula_revision is null or p_formula_revision < 1
    or p_square_item_id is null or p_square_item_id !~ '^[A-Za-z0-9_-]{1,100}$'
    or p_square_catalog_version is null or p_square_catalog_version !~ '^[1-9][0-9]{0,18}$'
    or p_outcome is null or p_outcome not in ('matched','mismatch','unavailable')
    or clean_device is null or length(clean_device) not between 1 and 120
    or clean_device !~ '\S' or clean_device ~ '[[:cntrl:]]'
    or clean_reference is null or length(clean_reference) not between 1 and 300
    or clean_reference !~ '\S' or clean_reference ~ '[[:cntrl:]]' then
    raise exception 'Enter a valid register observation, device and evidence reference' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'church-sandwich-register-check:' || p_location_id::text || ':' || p_request_id::text,0));
  select * into recorded from private.church_sandwich_register_checks check_record
  where check_record.organization_id = organization and check_record.location_id = p_location_id and check_record.id = p_request_id;

  if recorded.id is null then
    perform pg_advisory_xact_lock(hashtextextended('church-formula:' || p_location_id::text || ':' || p_recipe_key,0));
    -- Use the same ingredient lock keys and order as formula sign-off.
    for ingredient in select value from unnest(ingredients) component(value) order by value collate "C" loop
      perform pg_advisory_xact_lock(hashtextextended('church-ingredient:' || p_location_id::text || ':' || ingredient,0));
    end loop;
    select * into formula from private.church_sandwich_formula_revisions history
    where history.organization_id = organization and history.location_id = p_location_id and history.recipe_key = p_recipe_key
    order by history.revision desc limit 1;
  end if;

  business_date := (clock_timestamp() at time zone 'America/New_York')::date;
  if private.church_square_count_organization(p_location_id) is distinct from organization
    or not private.user_has_capability(p_actor_id,organization,p_location_id,'recipe.manage',business_date) then
    raise exception 'Church Street recipe management access is required' using errcode = '42501';
  end if;
  if recorded.id is not null then
    if (recorded.recorded_by,recorded.recipe_key,recorded.formula_revision,recorded.square_item_id,
      recorded.square_catalog_version,recorded.outcome,recorded.device,recorded.reference)
      is distinct from (p_actor_id,p_recipe_key,p_formula_revision,p_square_item_id,
        p_square_catalog_version,p_outcome,clean_device,clean_reference) then
      raise exception 'This register check request was already used for a different recording' using errcode = 'PT409';
    end if;
    return private.church_sandwich_register_check_view(recorded);
  end if;

  if formula.revision is distinct from p_formula_revision
    or (private.church_sandwich_formula_view(formula,true)->>'current')::boolean is distinct from true then
    raise exception 'The signed recipe or its supplier evidence changed. Review the current revision before recording a register check.' using errcode = 'PT409';
  end if;

  select left(coalesce(nullif(btrim(profile.preferred_name),''),nullif(btrim(profile.display_name),'')),120)
  into actor_name from public.profiles profile where profile.id = p_actor_id;
  insert into private.church_sandwich_register_checks (
    organization_id,location_id,id,recipe_key,formula_revision,square_item_id,square_catalog_version,
    outcome,device,reference,recorded_at,recorded_by,recorded_by_name
  ) values (
    organization,p_location_id,p_request_id,p_recipe_key,p_formula_revision,p_square_item_id,p_square_catalog_version,
    p_outcome,clean_device,clean_reference,clock_timestamp(),p_actor_id,coalesce(actor_name,'Recorded by staff')
  ) returning * into recorded;
  return private.church_sandwich_register_check_view(recorded);
end
$$;

revoke all on function private.church_sandwich_register_check_view(private.church_sandwich_register_checks),
  public.list_church_sandwich_register_checks(uuid),
  public.get_church_sandwich_register_check_receipt(uuid,uuid,uuid),
  public.record_church_sandwich_register_check(uuid,uuid,uuid,text,integer,text,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.list_church_sandwich_register_checks(uuid) to authenticated;
grant execute on function public.get_church_sandwich_register_check_receipt(uuid,uuid,uuid),
  public.record_church_sandwich_register_check(uuid,uuid,uuid,text,integer,text,text,text,text,text)
  to service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114145633', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
