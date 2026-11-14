create function private.church_catering_portions_within(p_packed jsonb,p_published jsonb)
returns boolean language sql immutable set search_path = ''
as $$
  select case when private.valid_church_catering_portions(p_packed)
    and private.valid_church_catering_portions(p_published) then not exists (
    select 1 from jsonb_each_text(p_packed) packed(recipe,qty)
    where packed.qty::int > (p_published->>packed.recipe)::int
  ) else false end
$$;

alter table private.church_catering_jobs
  add column packed_portions jsonb not null
    default '{"parisien":0,"verger":0,"bellecour":0,"bleu":0,"rustique":0,"figaro":0}'::jsonb,
  add constraint church_catering_packed_portions_within_plan
    check (private.church_catering_portions_within(packed_portions,portions));

alter table private.church_catering_job_changes
  drop constraint church_catering_job_changes_operation_check,
  add constraint church_catering_job_changes_operation_check check (
    operation in ('create','edit','attach','refresh','detach','no_change','prep_draft','prep_publish','prep_pack')
  );

create function private.protect_church_catering_packed_plan()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.packed_portions <> '{"parisien":0,"verger":0,"bellecour":0,"bleu":0,"rustique":0,"figaro":0}'::jsonb
    and (
      (new.service_date,new.portions) is distinct from (old.service_date,old.portions)
      or ((new.stage,new.prep_published_at,new.prep_published_by)
          is distinct from (old.stage,old.prep_published_at,old.prep_published_by)
        and not (old.stage = 'confirmed' and new.stage in ('completed','canceled')))
    ) then
    raise exception 'Correct the packed portions before changing the published Kitchen plan or service date' using errcode = 'PT409';
  end if;
  return new;
end
$$;

create trigger protect_church_catering_packed_plan
before update of stage,service_date,portions,prep_published_at,prep_published_by on private.church_catering_jobs
for each row execute function private.protect_church_catering_packed_plan();

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
    'invoice',invoice,'portions',p_job.portions,'prepPublishedAt',p_job.prep_published_at,
    'packedPortions',p_job.packed_portions
  );
end
$$;

create function public.save_church_catering_packed_portions(
  p_request_id uuid,p_location_id uuid,p_job_id uuid,p_expected_revision integer,
  p_packed_portions jsonb,p_reference text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_catering_authority(actor,p_location_id);
  job private.church_catering_jobs%rowtype;
  reference text := btrim(p_reference);
  request_facts jsonb;
  result jsonb;
  operation text;
begin
  if p_job_id is null or coalesce(p_expected_revision,0) < 1
    or not private.valid_church_catering_portions(p_packed_portions)
    or reference is null or length(reference) not between 1 and 120
    or reference !~ '\S' or reference ~ '[[:cntrl:]]'
    or reference ~ U&'[\061C\200B-\200F\202A-\202E\2060-\206F\FEFF]' then
    raise exception 'Enter six whole sandwich quantities and a short physical pack-list reference' using errcode = '22023';
  end if;
  request_facts := jsonb_build_object('action','prep_pack','id',p_job_id,'revision',p_expected_revision,
    'packedPortions',p_packed_portions,'reference',reference);
  result := private.replay_church_catering_job_change(actor,p_location_id,p_request_id,request_facts);
  if result is not null then return result; end if;

  select * into job from private.church_catering_jobs candidate
  where candidate.id = p_job_id and candidate.location_id = p_location_id and candidate.organization_id = organization
  for update;
  if not found or job.revision <> p_expected_revision then
    raise exception 'The catering job changed or is unavailable. Reload and try again.' using errcode = 'PT409';
  end if;
  if private.church_catering_authority(actor,p_location_id) is distinct from organization
    or job.stage <> 'confirmed' or job.prep_published_at is null
    or job.service_date <> (clock_timestamp() at time zone 'America/New_York')::date then
    raise exception 'Record packed portions for a confirmed, published catering job on its Church Street service date' using errcode = 'PT409';
  end if;
  if not private.church_catering_portions_within(p_packed_portions,job.portions) then
    raise exception 'Packed portions cannot exceed the published quantity for any sandwich' using errcode = 'PT409';
  end if;

  if job.packed_portions = p_packed_portions then
    operation := 'no_change';
  else
    update private.church_catering_jobs as target set packed_portions = p_packed_portions,
      revision = target.revision + 1,updated_by = actor,updated_at = clock_timestamp()
    where target.id = job.id returning * into job;
    operation := 'prep_pack';
  end if;
  result := private.church_catering_job_view(job);
  insert into private.church_catering_job_changes (location_id,request_id,job_id,actor_id,operation,request_facts,result)
  values (p_location_id,p_request_id,job.id,actor,operation,request_facts,result);
  return result;
end
$$;

comment on function public.save_church_catering_packed_portions(uuid,uuid,uuid,integer,jsonb,text) is
  'Record cumulative packed portions for the current published plan. Reference only the physical pack list. Leave out names, contact details and provider identifiers.';

create or replace function public.list_church_catering_prep(p_location_id uuid)
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
    with by_recipe as (
      select job.service_date,plan.recipe,count(*) as jobs,
        sum(plan.qty::int) as published,
        sum((job.packed_portions->>plan.recipe)::int) as packed
      from private.church_catering_jobs job
      cross join lateral jsonb_each_text(job.portions) plan(recipe,qty)
      where job.organization_id = organization and job.location_id = p_location_id and job.stage = 'confirmed'
        and job.prep_published_at is not null and job.service_date between business_date and business_date + 6
      group by job.service_date,plan.recipe
    ), daily as (
      select service_date,max(jobs) as job_count,jsonb_object_agg(recipe,published) as portions,
        jsonb_object_agg(recipe,packed) as packed_portions,
        jsonb_object_agg(recipe,published - packed) as remaining_portions
      from by_recipe group by service_date
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'serviceDate',daily.service_date,'portions',daily.portions,'jobCount',daily.job_count,
      'packedPortions',daily.packed_portions,'remainingPortions',daily.remaining_portions
    ) order by daily.service_date),'[]'::jsonb)
    from daily
  );
end
$$;

revoke all on function private.church_catering_portions_within(jsonb,jsonb),
  private.protect_church_catering_packed_plan(),private.church_catering_job_view(private.church_catering_jobs),
  public.save_church_catering_packed_portions(uuid,uuid,uuid,integer,jsonb,text), public.list_church_catering_prep(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.save_church_catering_packed_portions(uuid,uuid,uuid,integer,jsonb,text),
  public.list_church_catering_prep(uuid) to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114110900', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
