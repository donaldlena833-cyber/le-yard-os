create table private.church_ingredient_batch_measurements (
  location_id uuid not null,
  batch_id uuid not null,
  id uuid not null,
  batch_revision bigint not null check (batch_revision > 0),
  previous_id uuid,
  quantity numeric not null check (quantity between 0 and 1000000 and scale(quantity) <= 3),
  observed_at timestamptz not null check (isfinite(observed_at)),
  recorded_at timestamptz not null check (isfinite(recorded_at) and observed_at <= recorded_at),
  recorded_by uuid not null,
  recorded_by_name text not null check (length(recorded_by_name) between 1 and 120),
  primary key(location_id,id),
  unique(location_id,batch_id,batch_revision),
  check ((batch_revision = 1) = (previous_id is null)),
  foreign key(location_id,batch_id) references private.church_ingredient_batches(location_id,id)
);

alter table private.church_ingredient_batch_measurements enable row level security;
alter table private.church_ingredient_batch_measurements force row level security;
revoke all on private.church_ingredient_batch_measurements from public,anon,authenticated,service_role;
create trigger church_ingredient_batch_measurements_append_only
  before update or delete on private.church_ingredient_batch_measurements
  for each row execute function public.prevent_ledger_mutation();

create function private.church_ingredient_batch_measurement_view(p_measurement private.church_ingredient_batch_measurements)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id',p_measurement.id,'batchId',p_measurement.batch_id,'quantity',p_measurement.quantity,
    'observedAt',p_measurement.observed_at,'recordedAt',p_measurement.recorded_at,
    'recordedByName',p_measurement.recorded_by_name
  )
$$;

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
  left join lateral (
    select private.church_ingredient_batch_measurement_view(measurement) as receipt
    from private.church_ingredient_batch_measurements measurement
    where measurement.location_id = p_batch.location_id and measurement.batch_id = p_batch.id
    order by measurement.batch_revision desc limit 1
  ) latest on true
$$;

create function public.record_church_ingredient_batch_measurement(
  p_location_id uuid,p_batch_id uuid,p_request_id uuid,p_expected_latest_id uuid,
  p_quantity numeric,p_observed_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  batch private.church_ingredient_batches%rowtype;
  prior private.church_ingredient_batch_measurements%rowtype;
  latest private.church_ingredient_batch_measurements%rowtype;
  recorded private.church_ingredient_batch_measurements%rowtype;
  measurement_time timestamptz;
  actor_name text;
begin
  if organization is null or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;
  if p_batch_id is null or p_request_id is null or p_quantity is null
    or p_quantity not between 0 and 1000000 or scale(p_quantity) > 3
    or p_observed_at is null or not isfinite(p_observed_at) then
    raise exception 'Enter a measured quantity with up to three decimal places and its observation time' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'church-ingredient-batch-measurement-request:' || p_location_id::text || ':' || p_request_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended(
    'church-ingredient-batch:' || p_location_id::text || ':' || p_batch_id::text,0));
  select * into batch from private.church_ingredient_batches candidate
  where candidate.organization_id = organization and candidate.location_id = p_location_id and candidate.id = p_batch_id;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(
      'church-ingredient:' || p_location_id::text || ':' || batch.ingredient_key,0));
  end if;
  business_date := (clock_timestamp() at time zone 'America/New_York')::date;
  if private.church_square_count_organization(p_location_id) is distinct from organization or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;
  if batch.id is null then
    raise exception 'Church Street batch label not found' using errcode = 'P0002';
  end if;

  select * into prior from private.church_ingredient_batch_measurements measurement
  where measurement.location_id = p_location_id and measurement.id = p_request_id;
  if found then
    if (prior.batch_id,prior.previous_id,prior.quantity,prior.observed_at,prior.recorded_by)
      is distinct from (p_batch_id,p_expected_latest_id,p_quantity,p_observed_at,actor) then
      raise exception 'The measurement request was already used for a different recording' using errcode = 'PT409';
    end if;
    return private.church_ingredient_batch_measurement_view(prior);
  end if;

  if batch.ingredient_key = '10-inch baguette' and p_quantity <> trunc(p_quantity) then
    raise exception 'Count baguettes in whole units' using errcode = '22023';
  end if;
  measurement_time := clock_timestamp();
  if p_observed_at < batch.handled_at or p_observed_at > measurement_time then
    raise exception 'The observation must be at or after handling and cannot be in the future' using errcode = '22023';
  end if;
  if measurement_time >= batch.discard_at
    or exists (select 1 from private.church_ingredient_batch_voids batch_void
      where batch_void.location_id = p_location_id and batch_void.batch_id = p_batch_id)
    or exists (select 1 from private.church_ingredient_batch_dispositions disposition
      where disposition.location_id = p_location_id and disposition.batch_id = p_batch_id)
    or not exists (select 1 from private.church_ingredient_evidence evidence
      where evidence.organization_id = organization and evidence.location_id = p_location_id
        and evidence.ingredient_key = batch.ingredient_key and evidence.revision = batch.evidence_revision
        and evidence.status = 'reviewed') then
    raise exception 'This batch is past discard time, closed, or no longer matches reviewed supplier evidence' using errcode = 'PT409';
  end if;

  select * into latest from private.church_ingredient_batch_measurements measurement
  where measurement.location_id = p_location_id and measurement.batch_id = p_batch_id
  order by measurement.batch_revision desc limit 1;
  if latest.id is distinct from p_expected_latest_id then
    raise exception 'This batch already has a newer measurement. Reload it before recording.' using errcode = 'PT409';
  end if;
  if p_observed_at < latest.observed_at then
    raise exception 'The observation is earlier than the latest measurement for this batch' using errcode = 'PT409';
  end if;

  select left(coalesce(nullif(btrim(profile.preferred_name),''),nullif(btrim(profile.display_name),'')),120)
  into actor_name from public.profiles profile where profile.id = actor;
  insert into private.church_ingredient_batch_measurements (
    location_id,batch_id,id,batch_revision,previous_id,quantity,observed_at,recorded_at,recorded_by,recorded_by_name
  ) values (
    p_location_id,p_batch_id,p_request_id,coalesce(latest.batch_revision,0) + 1,p_expected_latest_id,
    p_quantity,p_observed_at,measurement_time,actor,coalesce(actor_name,'Recorded by staff')
  ) returning * into recorded;
  return private.church_ingredient_batch_measurement_view(recorded);
end
$$;

revoke all on function private.church_ingredient_batch_measurement_view(private.church_ingredient_batch_measurements),
  private.church_ingredient_batch_view(private.church_ingredient_batches),
  public.record_church_ingredient_batch_measurement(uuid,uuid,uuid,uuid,numeric,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.record_church_ingredient_batch_measurement(uuid,uuid,uuid,uuid,numeric,timestamptz)
  to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114110800', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
