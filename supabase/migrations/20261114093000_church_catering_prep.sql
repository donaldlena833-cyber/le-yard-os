create function private.valid_church_catering_portions(p_portions jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $$
declare
  recipe text;
begin
  if jsonb_typeof(p_portions) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p_portions)) <> 6 then return false; end if;
  foreach recipe in array array['parisien','verger','bellecour','bleu','rustique','figaro'] loop
    if jsonb_typeof(p_portions->recipe) is distinct from 'number'
      or (p_portions->>recipe) !~ '^(0|[1-9][0-9]{0,3})$'
      or (p_portions->>recipe)::int > 2000 then return false; end if;
  end loop;
  return true;
end
$$;

alter table private.church_catering_jobs
  add column portions jsonb not null default '{"parisien":0,"verger":0,"bellecour":0,"bleu":0,"rustique":0,"figaro":0}'::jsonb
    check (private.valid_church_catering_portions(portions)),
  add column prep_published_at timestamptz,
  add column prep_published_by uuid,
  add constraint church_catering_prep_review_pair check ((prep_published_at is null) = (prep_published_by is null)),
  add constraint church_catering_prep_review_stage check (prep_published_at is null or stage = 'confirmed');

alter table private.church_catering_job_changes
  drop constraint church_catering_job_changes_operation_check,
  add constraint church_catering_job_changes_operation_check
    check (operation in ('create','edit','attach','refresh','detach','no_change','prep_draft','prep_publish'));

create function private.reset_church_catering_prep_if_rescheduled()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if (new.stage,new.service_date) is distinct from (old.stage,old.service_date) then
    new.prep_published_at := null;
    new.prep_published_by := null;
  end if;
  return new;
end
$$;

create trigger reset_church_catering_prep_if_rescheduled
before update of stage,service_date on private.church_catering_jobs
for each row execute function private.reset_church_catering_prep_if_rescheduled();

create or replace function private.church_catering_job_view(p_job private.church_catering_jobs)
returns jsonb language plpgsql stable set search_path = ''
as $$
declare
  published private.church_square_resource_state%rowtype;
  owner_name text;
  evidence jsonb := p_job.invoice_facts;
  invoice jsonb;
  link_needs_review boolean := false;
begin
  select left(coalesce(nullif(btrim(preferred_name), ''),display_name),120) into owner_name
  from public.profiles where id = p_job.owner_id;
  if evidence is not null then
    select * into published from private.church_square_resource_state state
    where state.organization_id = p_job.organization_id and state.location_id = p_job.location_id
      and state.merchant_id = p_job.square_merchant_id and state.square_location_id = p_job.square_location_id
      and state.resource_kind = 'invoice' and state.resource_id = p_job.square_invoice_id
      and state.source_updated_at >= (evidence->>'updatedAt')::timestamptz;
    if found then
      link_needs_review := published.facts->>'orderId' is distinct from p_job.square_order_id;
      if not link_needs_review then evidence := published.facts; end if;
    end if;
    invoice := jsonb_build_object(
      'invoiceReference',right(p_job.square_invoice_id,10),'orderReference',right(p_job.square_order_id,10),
      'status',coalesce(evidence->>'status','UNKNOWN'),'serviceDate',evidence->>'serviceDate',
      'updatedAt',evidence->>'updatedAt',
      'serviceDateMismatch', (evidence->>'serviceDate') is distinct from p_job.service_date::text,
      'linkNeedsReview',link_needs_review,
      'deposit',jsonb_build_object('state',coalesce(evidence #>> '{deposit,state}','unknown'),
        'dueCents',evidence #> '{deposit,dueCents}','completedCents',evidence #> '{deposit,completedCents}')
    );
  end if;
  return jsonb_build_object(
    'id',p_job.id,'title',p_job.title,'serviceDate',p_job.service_date,'stage',p_job.stage,
    'ownerName',coalesce(owner_name,'Assigned manager'),'revision',p_job.revision,'updatedAt',p_job.updated_at,
    'invoice',invoice,'portions',p_job.portions,'prepPublishedAt',p_job.prep_published_at
  );
end
$$;

create function public.save_church_catering_prep(
  p_request_id uuid,p_location_id uuid,p_job_id uuid,p_expected_revision integer,p_portions jsonb,p_publish boolean
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_catering_authority(actor,p_location_id);
  job private.church_catering_jobs%rowtype;
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  request_facts jsonb;
  result jsonb;
  operation text;
begin
  if p_job_id is null or coalesce(p_expected_revision,0) < 1 or p_publish is null
    or not private.valid_church_catering_portions(p_portions) then
    raise exception 'Use six whole sandwich quantities between 0 and 2000' using errcode = '22023';
  end if;

  request_facts := jsonb_build_object('action','prep','id',p_job_id,'revision',p_expected_revision,
    'portions',p_portions,'publish',p_publish);
  result := private.replay_church_catering_job_change(actor,p_location_id,p_request_id,request_facts);
  if result is not null then return result; end if;

  select * into job from private.church_catering_jobs candidate where candidate.id = p_job_id
    and candidate.location_id = p_location_id and candidate.organization_id = organization for update;
  if not found or job.revision <> p_expected_revision then
    raise exception 'The catering job changed or is unavailable. Reload and try again.' using errcode = 'PT409';
  end if;
  if job.stage in ('completed','canceled') then
    raise exception 'The catering job is closed' using errcode = 'PT409';
  end if;
  if p_publish and (job.stage <> 'confirmed' or job.service_date < business_date
    or not exists (select 1 from jsonb_each_text(p_portions) part(key,qty) where part.qty::int > 0)) then
    raise exception 'Confirm an upcoming job and enter at least one sandwich before publishing' using errcode = 'PT409';
  end if;

  if job.portions = p_portions and (not p_publish or job.prep_published_at is not null) then
    operation := 'no_change';
  else
    update private.church_catering_jobs as target set portions = p_portions,
      prep_published_at = case when p_publish then clock_timestamp() end,
      prep_published_by = case when p_publish then actor end,
      revision = target.revision + 1,updated_by = actor,updated_at = clock_timestamp()
    where target.id = job.id returning * into job;
    operation := case when p_publish then 'prep_publish' else 'prep_draft' end;
  end if;

  result := private.church_catering_job_view(job);
  insert into private.church_catering_job_changes (location_id,request_id,job_id,actor_id,operation,request_facts,result)
  values (p_location_id,p_request_id,job.id,actor,operation,request_facts,result);
  return result;
end
$$;

create function public.list_church_catering_prep(p_location_id uuid)
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
    select coalesce(jsonb_agg(jsonb_build_object('serviceDate',daily.service_date,'portions',daily.portions,
      'jobCount',daily.job_count) order by daily.service_date),'[]'::jsonb)
    from (
      select job.service_date,count(*) as job_count,jsonb_build_object(
        'parisien',sum((job.portions->>'parisien')::int),'verger',sum((job.portions->>'verger')::int),
        'bellecour',sum((job.portions->>'bellecour')::int),'bleu',sum((job.portions->>'bleu')::int),
        'rustique',sum((job.portions->>'rustique')::int),'figaro',sum((job.portions->>'figaro')::int)
      ) as portions
      from private.church_catering_jobs job
      where job.organization_id = organization and job.location_id = p_location_id and job.stage = 'confirmed'
        and job.prep_published_at is not null and job.service_date between business_date and business_date + 6
      group by job.service_date
    ) daily
  );
end
$$;

revoke all on function private.valid_church_catering_portions(jsonb),
  private.reset_church_catering_prep_if_rescheduled(),
  public.save_church_catering_prep(uuid,uuid,uuid,integer,jsonb,boolean),public.list_church_catering_prep(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.save_church_catering_prep(uuid,uuid,uuid,integer,jsonb,boolean),
  public.list_church_catering_prep(uuid) to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114093000', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
