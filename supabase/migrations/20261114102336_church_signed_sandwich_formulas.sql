create function private.church_sandwich_formula_ingredients(p_recipe_key text)
returns text[] language sql immutable set search_path = ''
as $$
  select case p_recipe_key
    when 'parisien' then array['10-inch baguette','French-style ham','cultured butter']
    when 'verger' then array['10-inch baguette','Brie','apple','walnuts','honey']
    when 'bellecour' then array['10-inch baguette','Brie','roasted red peppers','cornichons','Dijon']
    when 'bleu' then array['10-inch baguette','Danish blue cheese','apple','arugula','honey','pistachios']
    when 'rustique' then array['10-inch baguette','Coppa','roasted red peppers','cornichons','Dijon','arugula']
    when 'figaro' then array['10-inch baguette','Prosciutto','Brie','fig preserves','arugula']
  end
$$;

create table private.church_sandwich_formula_revisions (
  organization_id uuid not null,
  location_id uuid not null,
  recipe_key text not null check (private.church_sandwich_formula_ingredients(recipe_key) is not null),
  revision integer not null check (revision >= 1),
  request_id uuid not null,
  measurements jsonb not null check (jsonb_typeof(measurements) = 'object'),
  supplier_evidence jsonb not null check (jsonb_typeof(supplier_evidence) = 'object'),
  review_reference text not null check (length(review_reference) between 1 and 300),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null,
  reviewer_name text not null check (length(reviewer_name) between 1 and 120),
  primary key(location_id,recipe_key,revision),
  unique(location_id,request_id),
  foreign key(organization_id,location_id) references public.locations(organization_id,id)
);

alter table private.church_sandwich_formula_revisions enable row level security;
alter table private.church_sandwich_formula_revisions force row level security;
revoke all on private.church_sandwich_formula_revisions from public,anon,authenticated,service_role;

create trigger church_sandwich_formula_revisions_append_only
  before update or delete on private.church_sandwich_formula_revisions
  for each row execute function public.prevent_ledger_mutation();

create function private.church_sandwich_formula_view(
  p_formula private.church_sandwich_formula_revisions,
  p_latest boolean
)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'recipeKey',p_formula.recipe_key,'revision',p_formula.revision,'measurements',p_formula.measurements,
    'reviewReference',p_formula.review_reference,'reviewedAt',p_formula.reviewed_at,'reviewerName',p_formula.reviewer_name,
    'current',p_latest and not exists (
      select 1 from jsonb_each(p_formula.measurements) measurement(ingredient,facts)
      where not exists (
        select 1 from private.church_ingredient_evidence evidence
        where evidence.organization_id = p_formula.organization_id and evidence.location_id = p_formula.location_id
          and evidence.ingredient_key = measurement.ingredient and evidence.status = 'reviewed'
          and evidence.revision = (measurement.facts->>'evidenceRevision')::integer
      )
    )
  )
$$;

create function public.list_church_sandwich_formulas(p_location_id uuid)
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
    select coalesce(jsonb_agg(private.church_sandwich_formula_view(formula,true) order by formula.recipe_key),'[]'::jsonb)
    from (
      select distinct on (history.recipe_key) history.*
      from private.church_sandwich_formula_revisions history
      where history.organization_id = organization and history.location_id = p_location_id
      order by history.recipe_key,history.revision desc
    ) formula
  );
end
$$;

create function public.save_church_sandwich_formula(
  p_request_id uuid,p_location_id uuid,p_recipe_key text,p_expected_revision integer,
  p_measurements jsonb,p_review_reference text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  ingredients text[] := private.church_sandwich_formula_ingredients(p_recipe_key);
  review_reference text := btrim(p_review_reference);
  prior private.church_sandwich_formula_revisions%rowtype;
  recorded private.church_sandwich_formula_revisions%rowtype;
  ingredient text;
  measurement jsonb;
  quantity numeric;
  received numeric;
  usable numeric;
  reference_revision numeric;
  current_revision integer;
  reviewer_name text;
  supplier_evidence jsonb;
begin
  if organization is null or not private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date) then
    raise exception 'Church Street recipe management access is required' using errcode = '42501';
  end if;
  if p_request_id is null or ingredients is null or p_expected_revision is null
    or p_expected_revision < 0 or p_expected_revision >= 2147483647
    or review_reference is null or length(review_reference) not between 1 and 300
    or review_reference !~ '\S' or review_reference ~ '[[:cntrl:]]'
    or jsonb_typeof(p_measurements) is distinct from 'object' or pg_column_size(p_measurements) > 8000 then
    raise exception 'Invalid Church Street sandwich formula' using errcode = '22023';
  end if;
  if (p_measurements - ingredients) <> '{}'::jsonb or not p_measurements ?& ingredients then
    raise exception 'Use the exact ingredients for this Church Street sandwich' using errcode = '22023';
  end if;

  foreach ingredient in array ingredients loop
    measurement := p_measurements->ingredient;
    if jsonb_typeof(measurement) is distinct from 'object' then
      raise exception 'A measured portion and batch observation are required for each ingredient' using errcode = '22023';
    end if;
    if (measurement - array['quantity','measuredInput','measuredUsable','evidenceRevision','yieldBasis']) <> '{}'::jsonb
      or jsonb_typeof(measurement->'quantity') is distinct from 'number'
      or jsonb_typeof(measurement->'measuredInput') is distinct from 'number'
      or jsonb_typeof(measurement->'measuredUsable') is distinct from 'number'
      or jsonb_typeof(measurement->'evidenceRevision') is distinct from 'number'
      or (measurement->>'yieldBasis') is distinct from (
        case when ingredient = '10-inch baguette' then 'whole_each' else 'weighed_usable_grams' end
      ) then
      raise exception 'A measured portion, batch observation and current evidence revision are required for each ingredient' using errcode = '22023';
    end if;
    quantity := (measurement->>'quantity')::numeric;
    received := (measurement->>'measuredInput')::numeric;
    usable := (measurement->>'measuredUsable')::numeric;
    reference_revision := (measurement->>'evidenceRevision')::numeric;
    if quantity <= 0 or quantity > 2000 or quantity > usable or usable > received or received > 1000000
      or trim_scale(quantity) <> round(quantity,3) or trim_scale(received) <> round(received,3)
      or trim_scale(usable) <> round(usable,3) or reference_revision not between 1 and 2147483647
      or reference_revision <> trunc(reference_revision)
      or (ingredient = '10-inch baguette' and (quantity <> 1 or usable <> trunc(usable) or received <> trunc(received))) then
      raise exception 'Measured quantities must be positive and usable yield cannot exceed measured input' using errcode = '22023';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('church-formula-request:' || p_location_id::text || ':' || p_request_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('church-formula:' || p_location_id::text || ':' || p_recipe_key,0));
  select coalesce(max(history.revision),0) into current_revision
  from private.church_sandwich_formula_revisions history
  where history.organization_id = organization and history.location_id = p_location_id and history.recipe_key = p_recipe_key;
  select * into prior from private.church_sandwich_formula_revisions history
  where history.location_id = p_location_id and history.request_id = p_request_id;
  if found then
    if prior.reviewed_by is distinct from actor or prior.recipe_key is distinct from p_recipe_key
      or prior.revision - 1 is distinct from p_expected_revision
      or prior.measurements is distinct from p_measurements or prior.review_reference is distinct from review_reference then
      raise exception 'This sandwich formula request was already used for a different operation' using errcode = 'PT409';
    end if;
    if private.church_square_count_organization(p_location_id) is distinct from organization
      or not private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date) then
      raise exception 'Church Street recipe management access is required' using errcode = '42501';
    end if;
    return private.church_sandwich_formula_view(prior,prior.revision = current_revision);
  end if;
  if current_revision <> p_expected_revision then
    raise exception 'Sandwich formula changed. Reload the current revision and try again.' using errcode = 'PT409';
  end if;

  -- Match the ingredient writer's lock keys so an approval cannot overtake a label change.
  for ingredient in select value from unnest(ingredients) component(value) order by value collate "C" loop
    perform pg_advisory_xact_lock(hashtextextended('church-ingredient:' || p_location_id::text || ':' || ingredient,0));
  end loop;
  if private.church_square_count_organization(p_location_id) is distinct from organization
    or not private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date) then
    raise exception 'Church Street recipe management access is required' using errcode = '42501';
  end if;

  select jsonb_object_agg(evidence.ingredient_key,jsonb_build_object(
      'evidenceRevision',evidence.revision,'supplierSku',evidence.supplier_sku,'sourceReference',evidence.source_reference,
      'reviewedBy',evidence.reviewed_by,'reviewedAt',evidence.reviewed_at
    )) into supplier_evidence
  from private.church_ingredient_evidence evidence
  where evidence.organization_id = organization and evidence.location_id = p_location_id
    and evidence.ingredient_key = any(ingredients) and evidence.status = 'reviewed'
    and evidence.revision = (p_measurements->evidence.ingredient_key->>'evidenceRevision')::numeric;
  if supplier_evidence is null or not supplier_evidence ?& ingredients then
    raise exception 'Supplier evidence changed or remains unreviewed. Review the exact current evidence before signing.' using errcode = 'PT409';
  end if;

  select left(coalesce(nullif(btrim(profile.preferred_name),''),nullif(btrim(profile.display_name),'')),120)
  into reviewer_name from public.profiles profile where profile.id = actor;
  insert into private.church_sandwich_formula_revisions (
    organization_id,location_id,recipe_key,revision,request_id,measurements,supplier_evidence,
    review_reference,reviewed_by,reviewed_at,reviewer_name
  ) values (
    organization,p_location_id,p_recipe_key,current_revision + 1,p_request_id,p_measurements,supplier_evidence,
    review_reference,actor,clock_timestamp(),coalesce(reviewer_name,'Reviewed by staff')
  ) returning * into recorded;
  return private.church_sandwich_formula_view(recorded,true);
end
$$;

revoke all on function private.church_sandwich_formula_ingredients(text),
  private.church_sandwich_formula_view(private.church_sandwich_formula_revisions,boolean),
  public.list_church_sandwich_formulas(uuid),public.save_church_sandwich_formula(uuid,uuid,text,integer,jsonb,text)
  from public,anon,authenticated,service_role;
grant execute on function public.list_church_sandwich_formulas(uuid),
  public.save_church_sandwich_formula(uuid,uuid,text,integer,jsonb,text) to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114102336', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
