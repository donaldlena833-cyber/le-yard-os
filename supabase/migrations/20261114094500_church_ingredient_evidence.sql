create function private.is_church_ingredient_key(p_key text)
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(p_key in (
    '10-inch baguette','French-style ham','cultured butter','Brie','apple','walnuts','honey',
    'roasted red peppers','cornichons','Dijon','Danish blue cheese','arugula','pistachios','Coppa',
    'Prosciutto','fig preserves'
  ),false)
$$;

create table private.church_ingredient_evidence (
  organization_id uuid not null,
  location_id uuid not null,
  ingredient_key text not null check (private.is_church_ingredient_key(ingredient_key)),
  revision integer not null check (revision >= 1),
  status text not null check (status in ('pending','hold','reviewed')),
  supplier_sku text check (length(supplier_sku) between 1 and 120),
  source_reference text check (length(source_reference) between 1 and 300),
  allergen_notes text check (length(allergen_notes) between 1 and 1000),
  cross_contact_notes text check (length(cross_contact_notes) between 1 and 1000),
  storage_rule text check (length(storage_rule) between 1 and 1000),
  opened_rule text check (length(opened_rule) between 1 and 1000),
  prepped_rule text check (length(prepped_rule) between 1 and 1000),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  check ((status = 'reviewed') = (reviewed_by is not null)),
  check ((status = 'reviewed') = (reviewed_at is not null)),
  check (status <> 'reviewed' or (
    supplier_sku is not null and source_reference is not null and allergen_notes is not null
    and cross_contact_notes is not null and storage_rule is not null and opened_rule is not null and prepped_rule is not null
  )),
  primary key(location_id,ingredient_key),
  foreign key(organization_id,location_id) references public.locations(organization_id,id)
);

create table private.church_ingredient_evidence_changes (
  location_id uuid not null,
  request_id uuid not null,
  ingredient_key text not null,
  actor_id uuid not null,
  request_facts jsonb not null check (jsonb_typeof(request_facts) = 'object'),
  previous_facts jsonb check (jsonb_typeof(previous_facts) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(location_id,request_id),
  foreign key(location_id,ingredient_key) references private.church_ingredient_evidence(location_id,ingredient_key)
);

alter table private.church_ingredient_evidence enable row level security;
alter table private.church_ingredient_evidence force row level security;
alter table private.church_ingredient_evidence_changes enable row level security;
alter table private.church_ingredient_evidence_changes force row level security;
revoke all on private.church_ingredient_evidence,private.church_ingredient_evidence_changes
  from public,anon,authenticated,service_role;

create function private.church_ingredient_evidence_view(p_evidence private.church_ingredient_evidence)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'ingredientKey',p_evidence.ingredient_key,'revision',p_evidence.revision,'status',p_evidence.status,
    'supplierSku',p_evidence.supplier_sku,'sourceReference',p_evidence.source_reference,
    'allergenNotes',p_evidence.allergen_notes,'crossContactNotes',p_evidence.cross_contact_notes,
    'storageRule',p_evidence.storage_rule,'openedRule',p_evidence.opened_rule,'preppedRule',p_evidence.prepped_rule,
    'reviewedAt',p_evidence.reviewed_at,'reviewerName',case when p_evidence.reviewed_by is not null then
      coalesce((select left(coalesce(nullif(btrim(profile.preferred_name),''),profile.display_name),120)
        from public.profiles profile where profile.id = p_evidence.reviewed_by),'Reviewed by staff') end,
    'updatedAt',p_evidence.updated_at
  )
$$;

create function public.list_church_ingredient_evidence(p_location_id uuid)
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
    select coalesce(jsonb_agg(private.church_ingredient_evidence_view(evidence) order by evidence.ingredient_key),'[]'::jsonb)
    from private.church_ingredient_evidence evidence
    where evidence.organization_id = organization and evidence.location_id = p_location_id
  );
end
$$;

create function public.save_church_ingredient_evidence(
  p_request_id uuid,p_location_id uuid,p_ingredient_key text,p_expected_revision integer,p_status text,
  p_supplier_sku text,p_source_reference text,p_allergen_notes text,p_cross_contact_notes text,
  p_storage_rule text,p_opened_rule text,p_prepped_rule text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  supplier_sku text := nullif(btrim(p_supplier_sku),'');
  source_reference text := nullif(btrim(p_source_reference),'');
  allergen_notes text := nullif(btrim(p_allergen_notes),'');
  cross_contact_notes text := nullif(btrim(p_cross_contact_notes),'');
  storage_rule text := nullif(btrim(p_storage_rule),'');
  opened_rule text := nullif(btrim(p_opened_rule),'');
  prepped_rule text := nullif(btrim(p_prepped_rule),'');
  request_facts jsonb;
  previous_facts jsonb;
  result jsonb;
  old_request private.church_ingredient_evidence_changes%rowtype;
  evidence private.church_ingredient_evidence%rowtype;
  changed_at timestamptz;
begin
  if organization is null or not private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date) then
    raise exception 'Church Street recipe management access is required' using errcode = '42501';
  end if;

  if p_request_id is null or p_expected_revision is null or p_expected_revision < 0
    or not private.is_church_ingredient_key(p_ingredient_key)
    or p_status is null or p_status not in ('pending','hold','reviewed')
    or length(supplier_sku) > 120 or length(source_reference) > 300
    or supplier_sku ~ '[[:cntrl:]]' or source_reference ~ '[[:cntrl:]]'
    or length(allergen_notes) > 1000 or length(cross_contact_notes) > 1000 or length(storage_rule) > 1000
    or length(opened_rule) > 1000 or length(prepped_rule) > 1000 then
    raise exception 'Invalid Church Street ingredient evidence fields' using errcode = '22023';
  end if;
  if p_status = 'reviewed' and (
    supplier_sku is null or source_reference is null or allergen_notes is null or cross_contact_notes is null
    or storage_rule is null or opened_rule is null or prepped_rule is null
    or allergen_notes !~ '\S' or cross_contact_notes !~ '\S' or storage_rule !~ '\S'
    or opened_rule !~ '\S' or prepped_rule !~ '\S'
  ) then
    raise exception 'Record the exact supplier, source, allergen and cross-contact notes, and storage, opened and prepped rules before marking reviewed'
      using errcode = '22023';
  end if;

  request_facts := jsonb_build_object(
    'ingredientKey',p_ingredient_key,'revision',p_expected_revision,'status',p_status,
    'supplierSku',supplier_sku,'sourceReference',source_reference,'allergenNotes',allergen_notes,'crossContactNotes',cross_contact_notes,
    'storageRule',storage_rule,'openedRule',opened_rule,'preppedRule',prepped_rule
  );

  perform pg_advisory_xact_lock(hashtextextended('church-ingredient-request:' || p_location_id::text || ':' || p_request_id::text,0));
  select * into old_request from private.church_ingredient_evidence_changes changes
  where changes.location_id = p_location_id and changes.request_id = p_request_id;
  if found then
    if old_request.actor_id is distinct from actor or old_request.request_facts is distinct from request_facts then
      raise exception 'The ingredient evidence request identity was already used for a different operation' using errcode = 'PT409';
    end if;
    return old_request.result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('church-ingredient:' || p_location_id::text || ':' || p_ingredient_key,0));
  select * into evidence from private.church_ingredient_evidence current_evidence
  where current_evidence.location_id = p_location_id and current_evidence.ingredient_key = p_ingredient_key
    and current_evidence.organization_id = organization for update;
  if coalesce(evidence.revision,0) <> p_expected_revision then
    raise exception 'The ingredient evidence changed. Reload and try again.' using errcode = 'PT409';
  end if;

  if evidence.revision is not null then
    previous_facts := private.church_ingredient_evidence_view(evidence) || jsonb_build_object('reviewedBy',evidence.reviewed_by);
  end if;
  if evidence.revision is not null and (
    evidence.status,evidence.supplier_sku,evidence.source_reference,evidence.allergen_notes,
    evidence.cross_contact_notes,evidence.storage_rule,evidence.opened_rule,evidence.prepped_rule
  ) is not distinct from (
    p_status,supplier_sku,source_reference,allergen_notes,cross_contact_notes,storage_rule,opened_rule,prepped_rule
  ) then
    result := private.church_ingredient_evidence_view(evidence);
  else
    changed_at := clock_timestamp();
    insert into private.church_ingredient_evidence as target (
      organization_id,location_id,ingredient_key,revision,status,supplier_sku,source_reference,
      allergen_notes,cross_contact_notes,storage_rule,opened_rule,prepped_rule,reviewed_by,reviewed_at,created_by,created_at,updated_by,updated_at
    ) values (
      organization,p_location_id,p_ingredient_key,1,p_status,supplier_sku,source_reference,allergen_notes,cross_contact_notes,
      storage_rule,opened_rule,prepped_rule,case when p_status = 'reviewed' then actor end,
      case when p_status = 'reviewed' then changed_at end,actor,changed_at,actor,changed_at
    )
    on conflict(location_id,ingredient_key) do update set revision = target.revision + 1,
      status = excluded.status,supplier_sku = excluded.supplier_sku,source_reference = excluded.source_reference,
      allergen_notes = excluded.allergen_notes,cross_contact_notes = excluded.cross_contact_notes,
      storage_rule = excluded.storage_rule,opened_rule = excluded.opened_rule,prepped_rule = excluded.prepped_rule,
      reviewed_by = excluded.reviewed_by,reviewed_at = excluded.reviewed_at,updated_by = excluded.updated_by,updated_at = excluded.updated_at
    returning * into evidence;
    result := private.church_ingredient_evidence_view(evidence);
  end if;
  insert into private.church_ingredient_evidence_changes (location_id,request_id,ingredient_key,actor_id,request_facts,previous_facts,result)
  values (p_location_id,p_request_id,p_ingredient_key,actor,request_facts,previous_facts,result);
  return result;
end
$$;

revoke all on function private.is_church_ingredient_key(text),
  private.church_ingredient_evidence_view(private.church_ingredient_evidence),
  public.list_church_ingredient_evidence(uuid),
  public.save_church_ingredient_evidence(uuid,uuid,text,integer,text,text,text,text,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.list_church_ingredient_evidence(uuid),
  public.save_church_ingredient_evidence(uuid,uuid,text,integer,text,text,text,text,text,text,text,text) to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114094500', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
