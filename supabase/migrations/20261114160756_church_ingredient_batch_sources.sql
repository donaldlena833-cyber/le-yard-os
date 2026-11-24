create table private.church_ingredient_batch_sources (
  location_id uuid not null,
  batch_id uuid not null,
  source_batch_id uuid not null,
  primary key (location_id,batch_id),
  foreign key (location_id,batch_id) references private.church_ingredient_batches(location_id,id),
  foreign key (location_id,source_batch_id) references private.church_ingredient_batches(location_id,id),
  check (batch_id <> source_batch_id)
);
alter table private.church_ingredient_batch_sources enable row level security;
alter table private.church_ingredient_batch_sources force row level security;
revoke all on private.church_ingredient_batch_sources from public,anon,authenticated,service_role;
create trigger church_ingredient_batch_sources_append_only
  before update or delete on private.church_ingredient_batch_sources
  for each row execute function public.prevent_ledger_mutation();

create function private.church_ingredient_batch_source_needs_review(p_location uuid,p_batch uuid)
returns boolean language sql stable set search_path = ''
as $$
  with recursive sources(id) as (
    select link.source_batch_id from private.church_ingredient_batch_sources link
    where link.location_id = p_location and link.batch_id = p_batch
    union
    select link.source_batch_id from sources join private.church_ingredient_batch_sources link
      on link.location_id = p_location and link.batch_id = sources.id
  )
  select exists (
    select 1 from sources
    where exists (select 1 from private.church_ingredient_batch_voids voided
      where voided.location_id = p_location and voided.batch_id = sources.id)
    or exists (select 1 from private.church_ingredient_batch_dispositions disposition
      where disposition.location_id = p_location and disposition.batch_id = sources.id and disposition.outcome = 'discarded')
  )
$$;

-- Share the per-ingredient lock with label creation and supplier revisions.
-- Once an ancestor is held for review, allow discard or void of the descendant.
create function private.guard_church_ingredient_batch_source_use()
returns trigger language plpgsql set search_path = ''
as $$
declare
  ingredient text;
  require_usable_source boolean := false;
begin
  select batch.ingredient_key into strict ingredient from private.church_ingredient_batches batch
  where batch.location_id = new.location_id and batch.id = new.batch_id;
  perform pg_advisory_xact_lock(hashtextextended('church-ingredient:' || new.location_id::text || ':' || ingredient,0));
  if tg_table_name = 'church_ingredient_batch_measurements' then
    require_usable_source := true;
  elsif tg_table_name = 'church_ingredient_batch_dispositions' then
    require_usable_source := new.outcome = 'used_up';
  end if;
  if require_usable_source and private.church_ingredient_batch_source_needs_review(new.location_id,new.batch_id) then
    raise exception 'The source batch was voided or discarded. Review the linked batch before use.' using errcode = 'PT409';
  end if;
  return new;
end
$$;

create trigger church_ingredient_batch_voids_guard_sources before insert on private.church_ingredient_batch_voids
  for each row execute function private.guard_church_ingredient_batch_source_use();
create trigger church_ingredient_batch_dispositions_guard_sources before insert on private.church_ingredient_batch_dispositions
  for each row execute function private.guard_church_ingredient_batch_source_use();
create trigger church_ingredient_batch_measurements_guard_sources before insert on private.church_ingredient_batch_measurements
  for each row execute function private.guard_church_ingredient_batch_source_use();

create function public.record_church_ingredient_batch_from_source(
  p_request_id uuid,p_location_id uuid,p_source_batch_id uuid,p_batch_code text,p_handled_at timestamptz,p_discard_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  source private.church_ingredient_batches%rowtype;
  recorded private.church_ingredient_batches%rowtype;
begin
  if organization is null or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_source_batch_id is null or p_request_id = p_source_batch_id
    or p_handled_at is null or not isfinite(p_handled_at) or p_discard_at is null or not isfinite(p_discard_at) then
    raise exception 'Choose a source batch, prep time, and discard deadline' using errcode = '22023';
  end if;

  select * into source from private.church_ingredient_batches batch
  where batch.organization_id = organization and batch.location_id = p_location_id and batch.id = p_source_batch_id;
  if not found then
    raise exception 'The Church Street source batch could not be found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('church-ingredient-batch:' || p_location_id::text || ':' || p_request_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('church-ingredient:' || p_location_id::text || ':' || source.ingredient_key,0));
  if private.church_square_count_organization(p_location_id) is distinct from organization or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;

  if exists (select 1 from private.church_ingredient_batches batch where batch.location_id = p_location_id and batch.id = p_request_id) then
    if not exists (select 1 from private.church_ingredient_batch_sources link
      where link.location_id = p_location_id and link.batch_id = p_request_id and link.source_batch_id = p_source_batch_id) then
      raise exception 'The batch request was already used for a different recording' using errcode = 'PT409';
    end if;
    return public.record_church_ingredient_batch(p_request_id,p_location_id,source.ingredient_key,
      source.evidence_revision,source.supplier_lot,p_batch_code,'prepped',p_handled_at,p_discard_at);
  end if;

  if source.discard_at <= clock_timestamp()
    or exists (select 1 from private.church_ingredient_batch_voids voided
      where voided.location_id = p_location_id and voided.batch_id = p_source_batch_id)
    or exists (select 1 from private.church_ingredient_batch_dispositions disposition
      where disposition.location_id = p_location_id and disposition.batch_id = p_source_batch_id)
    or private.church_ingredient_batch_source_needs_review(p_location_id,p_source_batch_id) then
    raise exception 'The source batch is closed, overdue, or needs review' using errcode = 'PT409';
  end if;
  if p_handled_at < source.handled_at or p_discard_at > source.discard_at then
    raise exception 'Prep must follow the source handling time. Use its discard deadline or an earlier one.' using errcode = '22023';
  end if;

  perform public.record_church_ingredient_batch(p_request_id,p_location_id,source.ingredient_key,
    source.evidence_revision,source.supplier_lot,p_batch_code,'prepped',p_handled_at,p_discard_at);
  insert into private.church_ingredient_batch_sources(location_id,batch_id,source_batch_id)
  values(p_location_id,p_request_id,p_source_batch_id);
  select * into strict recorded from private.church_ingredient_batches batch
  where batch.location_id = p_location_id and batch.id = p_request_id;
  return private.church_ingredient_batch_view(recorded);
end
$$;

revoke all on function private.church_ingredient_batch_source_needs_review(uuid,uuid),
  private.guard_church_ingredient_batch_source_use(),
  public.record_church_ingredient_batch_from_source(uuid,uuid,uuid,text,timestamptz,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.record_church_ingredient_batch_from_source(uuid,uuid,uuid,text,timestamptz,timestamptz)
  to authenticated;

create or replace function private.church_ingredient_batch_view(p_batch private.church_ingredient_batches)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id',p_batch.id,'ingredientKey',p_batch.ingredient_key,'evidenceRevision',p_batch.evidence_revision,
    'supplierSku',p_batch.supplier_sku,'supplierLot',p_batch.supplier_lot,'batchCode',p_batch.batch_code,
    'handledAs',p_batch.handled_as,'handledAt',p_batch.handled_at,'discardAt',p_batch.discard_at,
    'storageRule',p_batch.storage_rule,'handlingRule',p_batch.handling_rule,
    'recordedAt',p_batch.recorded_at,'recordedByName',p_batch.recorded_by_name,
    'voidedAt',batch_void.voided_at,'voidReason',batch_void.reason,
    'disposition',case when disposition.batch_id is not null then jsonb_build_object(
      'outcome',disposition.outcome,'resolvedAt',disposition.resolved_at,'resolvedByName',disposition.resolved_by_name
    ) end,
    'latestMeasurement',latest.receipt,
    'sourceBatch',case when source.id is not null then jsonb_build_object(
      'id',source.id,'batchCode',source.batch_code,'discardAt',source.discard_at
    ) end,
    'sourceNeedsReview',private.church_ingredient_batch_source_needs_review(p_batch.location_id,p_batch.id),
    'evidenceCurrent',exists (
      select 1 from private.church_ingredient_evidence evidence
      where evidence.organization_id = p_batch.organization_id and evidence.location_id = p_batch.location_id
        and evidence.ingredient_key = p_batch.ingredient_key and evidence.status = 'reviewed'
        and evidence.revision = p_batch.evidence_revision
    )
  ) from (select 1) placeholder
  left join private.church_ingredient_batch_voids batch_void
    on batch_void.location_id = p_batch.location_id and batch_void.batch_id = p_batch.id
  left join private.church_ingredient_batch_dispositions disposition
    on disposition.location_id = p_batch.location_id and disposition.batch_id = p_batch.id
  left join private.church_ingredient_batch_sources source_link
    on source_link.location_id = p_batch.location_id and source_link.batch_id = p_batch.id
  left join private.church_ingredient_batches source
    on source.location_id = source_link.location_id and source.id = source_link.source_batch_id
  left join lateral (
    select private.church_ingredient_batch_measurement_view(measurement) as receipt
    from private.church_ingredient_batch_measurements measurement
    where measurement.location_id = p_batch.location_id and measurement.batch_id = p_batch.id
    order by measurement.batch_revision desc limit 1
  ) latest on true
$$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114160756', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
