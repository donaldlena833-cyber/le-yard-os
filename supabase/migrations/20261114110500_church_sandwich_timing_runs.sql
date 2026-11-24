create table private.church_sandwich_timing_runs (
  organization_id uuid not null,
  location_id uuid not null,
  id uuid not null,
  recipe_key text not null check (private.church_sandwich_formula_ingredients(recipe_key) is not null),
  formula_revision integer check (formula_revision > 0),
  attempted integer not null check (attempted between 1 and 200),
  accepted integer not null check (accepted between 0 and attempted),
  crew_size integer not null check (crew_size between 1 and 12),
  prep_seconds integer check (prep_seconds between 0 and 43200),
  build_seconds integer not null check (build_seconds between 1 and 43200),
  pack_seconds integer check (pack_seconds between 0 and 43200),
  reference text not null check (length(reference) between 1 and 300),
  note text check (length(note) between 1 and 500),
  recorded_at timestamptz not null check (isfinite(recorded_at)),
  recorded_by uuid not null,
  recorded_by_name text not null check (length(recorded_by_name) between 1 and 120),
  primary key(location_id,id),
  foreign key(organization_id,location_id) references public.locations(organization_id,id),
  foreign key(location_id,recipe_key,formula_revision)
    references private.church_sandwich_formula_revisions(location_id,recipe_key,revision)
);

create index church_sandwich_timing_runs_recent_idx on private.church_sandwich_timing_runs(location_id,recorded_at desc,id);
alter table private.church_sandwich_timing_runs enable row level security;
alter table private.church_sandwich_timing_runs force row level security;
revoke all on private.church_sandwich_timing_runs from public,anon,authenticated,service_role;
create trigger church_sandwich_timing_runs_append_only
  before update or delete on private.church_sandwich_timing_runs
  for each row execute function public.prevent_ledger_mutation();

create function private.church_sandwich_timing_run_view(p_run private.church_sandwich_timing_runs)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id',p_run.id,'recipeKey',p_run.recipe_key,'formulaRevision',p_run.formula_revision,
    'attempted',p_run.attempted,'accepted',p_run.accepted,'crewSize',p_run.crew_size,
    'prepSeconds',p_run.prep_seconds,'buildSeconds',p_run.build_seconds,'packSeconds',p_run.pack_seconds,
    'reference',p_run.reference,'note',p_run.note,'recordedAt',p_run.recorded_at,'recordedByName',p_run.recorded_by_name
  )
$$;

create function public.list_church_sandwich_timing_runs(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
begin
  if organization is null or not exists (
    select 1 from unnest(array['recipe.manage','prep.manage','prep.complete']) permission(key)
    where private.user_has_capability(actor,organization,p_location_id,permission.key,business_date)
  ) then
    raise exception 'Church Street kitchen access is required' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(private.church_sandwich_timing_run_view(recent) order by recent.recorded_at desc,recent.id),'[]'::jsonb)
    from (
      select run.* from private.church_sandwich_timing_runs run
      where run.organization_id = organization and run.location_id = p_location_id
      order by run.recorded_at desc,run.id limit 30
    ) recent
  );
end
$$;

create function public.record_church_sandwich_timing_run(
  p_location_id uuid,p_request_id uuid,p_recipe_key text,p_attempted integer,p_accepted integer,p_crew_size integer,
  p_build_seconds integer,p_reference text,p_formula_revision integer default null,p_prep_seconds integer default null,
  p_pack_seconds integer default null,p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  ingredients text[] := private.church_sandwich_formula_ingredients(p_recipe_key);
  ingredient text;
  clean_reference text := btrim(p_reference);
  clean_note text := nullif(btrim(p_note),'');
  recorded private.church_sandwich_timing_runs%rowtype;
  formula private.church_sandwich_formula_revisions%rowtype;
  actor_name text;
begin
  if organization is null or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;
  if p_request_id is null or ingredients is null or coalesce(p_formula_revision,1) <= 0
    or p_attempted is null or p_attempted not between 1 and 200
    or p_accepted is null or p_accepted not between 0 and p_attempted
    or p_crew_size is null or p_crew_size not between 1 and 12
    or p_build_seconds is null or p_build_seconds not between 1 and 43200
    or coalesce(p_prep_seconds,0) not between 0 and 43200 or coalesce(p_pack_seconds,0) not between 0 and 43200
    or clean_reference is null or length(clean_reference) not between 1 and 300
    or clean_reference !~ '\S' or clean_reference ~ '[[:cntrl:]]'
    or length(clean_note) > 500 or clean_note !~ '\S' or clean_note ~ '[[:cntrl:]]' then
    raise exception 'Enter a valid measured timing run and worksheet reference' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('church-sandwich-timing:' || p_location_id::text || ':' || p_request_id::text,0));
  select * into recorded from private.church_sandwich_timing_runs run
  where run.organization_id = organization and run.location_id = p_location_id and run.id = p_request_id;
  if not found and p_formula_revision is not null then
    perform pg_advisory_xact_lock(hashtextextended('church-formula:' || p_location_id::text || ':' || p_recipe_key,0));
    -- Serialize with both formula signoff and the exact supplier label review it references.
    for ingredient in select value from unnest(ingredients) component(value) order by value collate "C" loop
      perform pg_advisory_xact_lock(hashtextextended('church-ingredient:' || p_location_id::text || ':' || ingredient,0));
    end loop;
    select * into formula from private.church_sandwich_formula_revisions history
    where history.organization_id = organization and history.location_id = p_location_id and history.recipe_key = p_recipe_key
    order by history.revision desc limit 1;
  end if;
  if private.church_square_count_organization(p_location_id) is distinct from organization or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;

  if recorded.id is not null then
    if (recorded.recorded_by,recorded.recipe_key,recorded.formula_revision,recorded.attempted,recorded.accepted,
      recorded.crew_size,recorded.prep_seconds,recorded.build_seconds,recorded.pack_seconds,recorded.reference,recorded.note)
      is distinct from (actor,p_recipe_key,p_formula_revision,p_attempted,p_accepted,p_crew_size,
        p_prep_seconds,p_build_seconds,p_pack_seconds,clean_reference,clean_note) then
      raise exception 'This timing request was already used for a different recording' using errcode = 'PT409';
    end if;
    return private.church_sandwich_timing_run_view(recorded);
  end if;

  if p_formula_revision is not null and (formula.revision is distinct from p_formula_revision
    or (private.church_sandwich_formula_view(formula,true)->>'current')::boolean is distinct from true) then
    raise exception 'The signed recipe or its supplier evidence changed. Review the current revision before recording timing.' using errcode = 'PT409';
  end if;

  select left(coalesce(nullif(btrim(profile.preferred_name),''),nullif(btrim(profile.display_name),'')),120)
  into actor_name from public.profiles profile where profile.id = actor;
  insert into private.church_sandwich_timing_runs (
    organization_id,location_id,id,recipe_key,formula_revision,attempted,accepted,crew_size,
    prep_seconds,build_seconds,pack_seconds,reference,note,recorded_at,recorded_by,recorded_by_name
  ) values (
    organization,p_location_id,p_request_id,p_recipe_key,p_formula_revision,p_attempted,p_accepted,p_crew_size,
    p_prep_seconds,p_build_seconds,p_pack_seconds,clean_reference,clean_note,clock_timestamp(),actor,coalesce(actor_name,'Recorded by staff')
  ) returning * into recorded;
  return private.church_sandwich_timing_run_view(recorded);
end
$$;

revoke all on function private.church_sandwich_timing_run_view(private.church_sandwich_timing_runs),
  public.list_church_sandwich_timing_runs(uuid),
  public.record_church_sandwich_timing_run(uuid,uuid,text,integer,integer,integer,integer,text,integer,integer,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.list_church_sandwich_timing_runs(uuid),
  public.record_church_sandwich_timing_run(uuid,uuid,text,integer,integer,integer,integer,text,integer,integer,integer,text)
  to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114110500', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
