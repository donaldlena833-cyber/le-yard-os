create table private.church_ingredient_batches (
  organization_id uuid not null,
  location_id uuid not null,
  id uuid not null,
  ingredient_key text not null check (private.is_church_ingredient_key(ingredient_key)),
  evidence_revision integer not null check (evidence_revision > 0),
  supplier_sku text not null check (length(supplier_sku) between 1 and 120),
  supplier_lot text not null check (length(supplier_lot) between 1 and 120),
  batch_code text not null check (length(batch_code) between 1 and 120),
  handled_as text not null check (handled_as in ('opened','prepped')),
  handled_at timestamptz not null,
  discard_at timestamptz not null,
  storage_rule text not null check (length(storage_rule) between 1 and 1000),
  handling_rule text not null check (length(handling_rule) between 1 and 1000),
  recorded_at timestamptz not null,
  recorded_by uuid not null,
  recorded_by_name text not null check (length(recorded_by_name) between 1 and 120),
  check (isfinite(handled_at) and isfinite(discard_at) and isfinite(recorded_at)
    and handled_at <= recorded_at and discard_at > handled_at and discard_at > recorded_at),
  primary key(location_id,id),
  unique(location_id,ingredient_key,batch_code),
  foreign key(organization_id,location_id) references public.locations(organization_id,id)
);

create index church_ingredient_batches_recent_idx
  on private.church_ingredient_batches(location_id,recorded_at desc,id);

create table private.church_ingredient_batch_voids (
  location_id uuid not null,
  batch_id uuid not null,
  request_id uuid not null,
  reason text not null check (length(reason) between 1 and 240),
  voided_at timestamptz not null,
  voided_by uuid not null,
  primary key(location_id,batch_id),
  unique(location_id,request_id),
  foreign key(location_id,batch_id) references private.church_ingredient_batches(location_id,id)
);

alter table private.church_ingredient_batches enable row level security;
alter table private.church_ingredient_batches force row level security;
alter table private.church_ingredient_batch_voids enable row level security;
alter table private.church_ingredient_batch_voids force row level security;
revoke all on private.church_ingredient_batches,private.church_ingredient_batch_voids from public,anon,authenticated,service_role;

create trigger church_ingredient_batches_append_only
  before update or delete on private.church_ingredient_batches
  for each row execute function public.prevent_ledger_mutation();
create trigger church_ingredient_batch_voids_append_only
  before update or delete on private.church_ingredient_batch_voids
  for each row execute function public.prevent_ledger_mutation();

create function private.church_ingredient_batch_view(p_batch private.church_ingredient_batches)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id',p_batch.id,'ingredientKey',p_batch.ingredient_key,'evidenceRevision',p_batch.evidence_revision,
    'supplierSku',p_batch.supplier_sku,'supplierLot',p_batch.supplier_lot,'batchCode',p_batch.batch_code,
    'handledAs',p_batch.handled_as,'handledAt',p_batch.handled_at,'discardAt',p_batch.discard_at,
    'storageRule',p_batch.storage_rule,'handlingRule',p_batch.handling_rule,
    'recordedAt',p_batch.recorded_at,'recordedByName',p_batch.recorded_by_name,
    'voidedAt',batch_void.voided_at,'voidReason',batch_void.reason,
    'evidenceCurrent',exists (
      select 1 from private.church_ingredient_evidence evidence
      where evidence.organization_id = p_batch.organization_id and evidence.location_id = p_batch.location_id
        and evidence.ingredient_key = p_batch.ingredient_key and evidence.status = 'reviewed'
        and evidence.revision = p_batch.evidence_revision
    )
  ) from (select 1) placeholder left join private.church_ingredient_batch_voids batch_void
    on batch_void.location_id = p_batch.location_id and batch_void.batch_id = p_batch.id
$$;

create function public.list_church_ingredient_batches(p_location_id uuid)
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
    select coalesce(jsonb_agg(private.church_ingredient_batch_view(recent) order by recent.recorded_at desc,recent.id),'[]'::jsonb)
    from (
      select batch.* from private.church_ingredient_batches batch
      where batch.organization_id = organization and batch.location_id = p_location_id
      order by batch.recorded_at desc,batch.id limit 50
    ) recent
  );
end
$$;

create function public.record_church_ingredient_batch(
  p_request_id uuid,p_location_id uuid,p_ingredient_key text,p_evidence_revision integer,
  p_supplier_lot text,p_batch_code text,p_handled_as text,p_handled_at timestamptz,p_discard_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  clean_lot text := btrim(p_supplier_lot);
  clean_code text := btrim(p_batch_code);
  prior private.church_ingredient_batches%rowtype;
  recorded private.church_ingredient_batches%rowtype;
  evidence private.church_ingredient_evidence%rowtype;
  recorded_at timestamptz;
  recorded_by_name text;
begin
  if organization is null or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;
  if p_request_id is null or not private.is_church_ingredient_key(p_ingredient_key)
    or p_evidence_revision is null or p_evidence_revision <= 0
    or clean_lot is null or length(clean_lot) not between 1 and 120 or clean_lot !~ '\S' or clean_lot ~ '[[:cntrl:]]'
    or clean_code is null or length(clean_code) not between 1 and 120 or clean_code !~ '\S' or clean_code ~ '[[:cntrl:]]'
    or p_handled_as is null or p_handled_as not in ('opened','prepped')
    or p_handled_at is null or not isfinite(p_handled_at) or p_discard_at is null or not isfinite(p_discard_at)
    or p_handled_at < '2000-01-01T00:00:00Z'::timestamptz or p_discard_at >= '2101-01-01T00:00:00Z'::timestamptz
    or p_discard_at <= p_handled_at then
    raise exception 'Enter a supplier lot, a unique batch code, and actual handling and discard times' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('church-ingredient-batch:' || p_location_id::text || ':' || p_request_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('church-ingredient:' || p_location_id::text || ':' || p_ingredient_key,0));
  if private.church_square_count_organization(p_location_id) is distinct from organization or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;

  select * into prior from private.church_ingredient_batches batch
  where batch.organization_id = organization and batch.location_id = p_location_id and batch.id = p_request_id;
  if found then
    if (prior.recorded_by,prior.ingredient_key,prior.evidence_revision,prior.supplier_lot,prior.batch_code,
      prior.handled_as,prior.handled_at,prior.discard_at) is distinct from (
      actor,p_ingredient_key,p_evidence_revision,clean_lot,clean_code,p_handled_as,p_handled_at,p_discard_at
    ) then
      raise exception 'The batch request was already used for a different recording' using errcode = 'PT409';
    end if;
    return private.church_ingredient_batch_view(prior);
  end if;

  recorded_at := clock_timestamp();
  if p_handled_at > recorded_at or p_discard_at <= recorded_at then
    raise exception 'The batch must already be handled and its discard time must still be ahead' using errcode = '22023';
  end if;
  select * into evidence from private.church_ingredient_evidence candidate
  where candidate.organization_id = organization and candidate.location_id = p_location_id
    and candidate.ingredient_key = p_ingredient_key and candidate.status = 'reviewed'
    and candidate.revision = p_evidence_revision;
  if not found then
    raise exception 'Supplier evidence changed or remains unreviewed. Review the current label before recording this batch.' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from private.church_ingredient_batches batch
    where batch.organization_id = organization and batch.location_id = p_location_id
      and batch.ingredient_key = p_ingredient_key and batch.batch_code = clean_code
  ) then
    raise exception 'This batch code is already recorded for the ingredient. Use a new code.' using errcode = 'PT409';
  end if;

  select left(coalesce(nullif(btrim(profile.preferred_name),''),nullif(btrim(profile.display_name),'')),120)
  into recorded_by_name from public.profiles profile where profile.id = actor;
  insert into private.church_ingredient_batches (
    organization_id,location_id,id,ingredient_key,evidence_revision,supplier_sku,supplier_lot,batch_code,
    handled_as,handled_at,discard_at,storage_rule,handling_rule,recorded_at,recorded_by,recorded_by_name
  ) values (
    organization,p_location_id,p_request_id,p_ingredient_key,p_evidence_revision,evidence.supplier_sku,clean_lot,clean_code,
    p_handled_as,p_handled_at,p_discard_at,evidence.storage_rule,
    case when p_handled_as = 'opened' then evidence.opened_rule else evidence.prepped_rule end,
    recorded_at,actor,coalesce(recorded_by_name,'Recorded by staff')
  ) returning * into recorded;
  return private.church_ingredient_batch_view(recorded);
end
$$;

create function public.void_church_ingredient_batch(
  p_location_id uuid,p_batch_id uuid,p_request_id uuid,p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  clean_reason text := btrim(p_reason);
  recorded private.church_ingredient_batches%rowtype;
  prior private.church_ingredient_batch_voids%rowtype;
begin
  if organization is null or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_batch_id is null
    or clean_reason is null or length(clean_reason) not between 1 and 240
    or clean_reason !~ '\S' or clean_reason ~ '[[:cntrl:]]' then
    raise exception 'Enter a reason to void this batch label' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('church-ingredient-batch-void-request:' || p_location_id::text || ':' || p_request_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('church-ingredient-batch:' || p_location_id::text || ':' || p_batch_id::text,0));
  if private.church_square_count_organization(p_location_id) is distinct from organization or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;

  select * into recorded from private.church_ingredient_batches batch
  where batch.organization_id = organization and batch.location_id = p_location_id and batch.id = p_batch_id;
  if not found then
    raise exception 'Church Street batch label not found' using errcode = 'P0002';
  end if;
  select * into prior from private.church_ingredient_batch_voids batch_void
  where batch_void.location_id = p_location_id and batch_void.request_id = p_request_id;
  if found then
    if (prior.batch_id,prior.voided_by,prior.reason) is distinct from (p_batch_id,actor,clean_reason) then
      raise exception 'The void request was already used for a different recording' using errcode = 'PT409';
    end if;
    return private.church_ingredient_batch_view(recorded);
  end if;
  if exists (
    select 1 from private.church_ingredient_batch_voids batch_void
    where batch_void.location_id = p_location_id and batch_void.batch_id = p_batch_id
  ) then
    raise exception 'This batch label has already been voided' using errcode = 'PT409';
  end if;
  insert into private.church_ingredient_batch_voids (location_id,batch_id,request_id,reason,voided_at,voided_by)
  values (p_location_id,p_batch_id,p_request_id,clean_reason,clock_timestamp(),actor);
  return private.church_ingredient_batch_view(recorded);
end
$$;

revoke all on function private.church_ingredient_batch_view(private.church_ingredient_batches),
  public.list_church_ingredient_batches(uuid),
  public.record_church_ingredient_batch(uuid,uuid,text,integer,text,text,text,timestamptz,timestamptz),
  public.void_church_ingredient_batch(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.list_church_ingredient_batches(uuid),
  public.record_church_ingredient_batch(uuid,uuid,text,integer,text,text,text,timestamptz,timestamptz),
  public.void_church_ingredient_batch(uuid,uuid,uuid,text) to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114105000', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
