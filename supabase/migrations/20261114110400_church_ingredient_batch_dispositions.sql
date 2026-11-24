create table private.church_ingredient_batch_dispositions (
  location_id uuid not null,
  batch_id uuid not null,
  request_id uuid not null,
  outcome text not null check (outcome in ('used_up','discarded')),
  resolved_at timestamptz not null check (isfinite(resolved_at)),
  resolved_by uuid not null,
  resolved_by_name text not null check (length(resolved_by_name) between 1 and 120),
  primary key(location_id,batch_id),
  unique(location_id,request_id),
  foreign key(location_id,batch_id) references private.church_ingredient_batches(location_id,id)
);

create index church_ingredient_batches_due_idx
  on private.church_ingredient_batches(location_id,discard_at,id);
alter table private.church_ingredient_batch_dispositions enable row level security;
alter table private.church_ingredient_batch_dispositions force row level security;
revoke all on private.church_ingredient_batch_dispositions from public,anon,authenticated,service_role;
create trigger church_ingredient_batch_dispositions_append_only
  before update or delete on private.church_ingredient_batch_dispositions
  for each row execute function public.prevent_ledger_mutation();

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
$$;

create or replace function public.list_church_ingredient_batches(p_location_id uuid)
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
    select coalesce(jsonb_agg(private.church_ingredient_batch_view(recent.batch)
      order by recent.activity_at desc,recent.id),'[]'::jsonb)
    from (
      select batch,batch.id,coalesce(disposition.resolved_at,batch_void.voided_at,batch.recorded_at) as activity_at
      from private.church_ingredient_batches batch
      left join private.church_ingredient_batch_dispositions disposition
        on disposition.location_id = batch.location_id and disposition.batch_id = batch.id
      left join private.church_ingredient_batch_voids batch_void
        on batch_void.location_id = batch.location_id and batch_void.batch_id = batch.id
      where batch.organization_id = organization and batch.location_id = p_location_id
      order by activity_at desc,batch.id limit 50
    ) recent
  );
end
$$;

create function public.list_church_ingredient_batch_queue(p_location_id uuid)
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
    with unresolved as not materialized (
      select batch.* from private.church_ingredient_batches batch
      where batch.organization_id = organization and batch.location_id = p_location_id
        and not exists (select 1 from private.church_ingredient_batch_voids batch_void
          where batch_void.location_id = batch.location_id and batch_void.batch_id = batch.id)
        and not exists (select 1 from private.church_ingredient_batch_dispositions disposition
          where disposition.location_id = batch.location_id and disposition.batch_id = batch.id)
    )
    select jsonb_build_object(
      'batches',coalesce((select jsonb_agg(private.church_ingredient_batch_view(due) order by due.discard_at,due.id)
        from (select unresolved.* from unresolved order by discard_at,id limit 50) due),'[]'::jsonb),
      'total',(select count(*) from unresolved)
    )
  );
end
$$;

create function public.resolve_church_ingredient_batch(
  p_location_id uuid,p_batch_id uuid,p_request_id uuid,p_outcome text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  recorded private.church_ingredient_batches%rowtype;
  prior private.church_ingredient_batch_dispositions%rowtype;
  current_time_at_resolution timestamptz;
  actor_name text;
begin
  if organization is null or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_batch_id is null or p_outcome is null or p_outcome not in ('used_up','discarded') then
    raise exception 'Choose how the Church Street batch was resolved' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('church-ingredient-batch-disposition-request:' || p_location_id::text || ':' || p_request_id::text,0));
  -- Void uses this same batch lock. Only one terminal event can be recorded.
  perform pg_advisory_xact_lock(hashtextextended('church-ingredient-batch:' || p_location_id::text || ':' || p_batch_id::text,0));
  select * into recorded from private.church_ingredient_batches batch
  where batch.organization_id = organization and batch.location_id = p_location_id and batch.id = p_batch_id;
  if found and p_outcome = 'used_up' then
    -- Match the supplier writer before testing evidence for the used-up decision.
    perform pg_advisory_xact_lock(hashtextextended('church-ingredient:' || p_location_id::text || ':' || recorded.ingredient_key,0));
  end if;
  if private.church_square_count_organization(p_location_id) is distinct from organization or not (
    private.user_has_capability(actor,organization,p_location_id,'recipe.manage',business_date)
    or private.user_has_capability(actor,organization,p_location_id,'prep.manage',business_date)
  ) then
    raise exception 'Church Street recipe or prep management access is required' using errcode = '42501';
  end if;
  if recorded.id is null then
    raise exception 'Church Street batch label not found' using errcode = 'P0002';
  end if;

  select * into prior from private.church_ingredient_batch_dispositions disposition
  where disposition.location_id = p_location_id and disposition.request_id = p_request_id;
  if found then
    if (prior.batch_id,prior.resolved_by,prior.outcome) is distinct from (p_batch_id,actor,p_outcome) then
      raise exception 'The resolution request was already used for a different recording' using errcode = 'PT409';
    end if;
    return private.church_ingredient_batch_view(recorded);
  end if;
  if exists (select 1 from private.church_ingredient_batch_voids batch_void
      where batch_void.location_id = p_location_id and batch_void.batch_id = p_batch_id)
    or exists (select 1 from private.church_ingredient_batch_dispositions disposition
      where disposition.location_id = p_location_id and disposition.batch_id = p_batch_id) then
    raise exception 'This batch label already has a terminal record' using errcode = 'PT409';
  end if;

  current_time_at_resolution := clock_timestamp();
  if p_outcome = 'used_up' and (current_time_at_resolution >= recorded.discard_at or not exists (
    select 1 from private.church_ingredient_evidence evidence
    where evidence.organization_id = organization and evidence.location_id = p_location_id
      and evidence.ingredient_key = recorded.ingredient_key and evidence.revision = recorded.evidence_revision
      and evidence.status = 'reviewed'
  )) then
    raise exception 'A batch past discard time or with changed supplier evidence cannot be recorded as used up' using errcode = 'PT409';
  end if;

  select left(coalesce(nullif(btrim(profile.preferred_name),''),nullif(btrim(profile.display_name),'')),120)
  into actor_name from public.profiles profile where profile.id = actor;
  insert into private.church_ingredient_batch_dispositions (location_id,batch_id,request_id,outcome,resolved_at,resolved_by,resolved_by_name)
  values (p_location_id,p_batch_id,p_request_id,p_outcome,current_time_at_resolution,actor,coalesce(actor_name,'Recorded by staff'));
  return private.church_ingredient_batch_view(recorded);
end
$$;

-- The existing void function already holds the shared batch lock. Enforce the
-- same terminal-state rule for that path at its single append point.
create function private.guard_church_ingredient_batch_void()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if exists (select 1 from private.church_ingredient_batch_dispositions disposition
    where disposition.location_id = new.location_id and disposition.batch_id = new.batch_id) then
    raise exception 'A resolved Church Street batch label cannot be voided' using errcode = 'PT409';
  end if;
  return new;
end
$$;

create trigger church_ingredient_batch_void_terminal_guard
  before insert on private.church_ingredient_batch_voids
  for each row execute function private.guard_church_ingredient_batch_void();

revoke all on function private.church_ingredient_batch_view(private.church_ingredient_batches),private.guard_church_ingredient_batch_void(),
  public.list_church_ingredient_batches(uuid),public.list_church_ingredient_batch_queue(uuid),public.resolve_church_ingredient_batch(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.list_church_ingredient_batches(uuid),public.list_church_ingredient_batch_queue(uuid),
  public.resolve_church_ingredient_batch(uuid,uuid,uuid,text)
  to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114110400', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
