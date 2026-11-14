create table private.church_catering_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  title text not null check (length(title) between 1 and 120),
  service_date date not null check (service_date between date '2000-01-01' and date '2100-12-31'),
  stage text not null check (stage in ('inquiry','quoted','confirmed','completed','canceled')),
  owner_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  square_merchant_id text,
  square_location_id text,
  square_invoice_id text,
  square_order_id text,
  invoice_facts jsonb,
  check (
    (square_merchant_id is null and square_location_id is null and square_invoice_id is null
      and square_order_id is null and invoice_facts is null)
    or (square_merchant_id is not null and square_location_id is not null and square_invoice_id is not null
      and square_order_id is not null and invoice_facts is not null and jsonb_typeof(invoice_facts) = 'object')
  ),
  foreign key (organization_id, location_id) references public.locations(organization_id,id),
  unique (location_id, square_invoice_id),
  unique (location_id, square_order_id),
  unique (location_id, id)
);
create index church_catering_jobs_location_date on private.church_catering_jobs(location_id,service_date,updated_at desc);

create table private.church_catering_job_changes (
  location_id uuid not null,
  request_id uuid not null,
  job_id uuid not null,
  actor_id uuid not null,
  operation text not null check (operation in ('create','edit','attach','refresh','detach','no_change')),
  request_facts jsonb not null check (jsonb_typeof(request_facts) = 'object'),
  previous_link jsonb check (jsonb_typeof(previous_link) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(location_id,request_id),
  foreign key(location_id,job_id) references private.church_catering_jobs(location_id,id)
);

alter table private.church_catering_jobs enable row level security;
alter table private.church_catering_jobs force row level security;
alter table private.church_catering_job_changes enable row level security;
alter table private.church_catering_job_changes force row level security;
revoke all on private.church_catering_jobs, private.church_catering_job_changes
  from public, anon, authenticated, service_role;

create function private.church_catering_authority(p_actor uuid, p_location uuid)
returns uuid language plpgsql stable set search_path = ''
as $$
declare
  organization uuid := private.church_square_count_organization(p_location);
begin
  if organization is null or not exists (
    select 1 from public.organization_memberships membership
    where membership.user_id = p_actor and membership.organization_id = organization
      and membership.status = 'active' and membership.role in ('owner','admin','manager')
  ) or not private.user_has_capability(p_actor,organization,p_location,'reports.financial.view',
      (statement_timestamp() at time zone 'America/New_York')::date) then
    raise exception 'Church Street catering management access is required' using errcode = '42501';
  end if;
  return organization;
end
$$;

-- Current canonical reads are usable only when the invoice still belongs to the
-- attached Square order. Keep reviewed evidence visible if that linkage changes.
create function private.church_catering_job_view(p_job private.church_catering_jobs)
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
    'invoice',invoice
  );
end
$$;

create function public.list_church_catering_jobs(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_catering_authority(auth.uid(),p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
begin
  return (
    select coalesce(jsonb_agg(private.church_catering_job_view(job.record)
      order by job.terminal,job.upcoming_date,job.past_date desc,job.updated_at desc,job.id),'[]'::jsonb)
    from (
      select j as record,j.stage in ('completed','canceled') as terminal,j.updated_at,j.id,
        case when j.service_date >= business_date then j.service_date end as upcoming_date,
        case when j.service_date < business_date then j.service_date end as past_date
      from private.church_catering_jobs j where j.organization_id = organization and j.location_id = p_location_id
      order by terminal,upcoming_date,past_date desc,j.updated_at desc,j.id limit 100
    ) job
  );
end
$$;

-- An advisory lock serializes one logical request before any row locks are
-- taken. The immutable receipt returns the original result after response loss.
create function private.replay_church_catering_job_change(
  p_actor uuid,p_location uuid,p_request uuid,p_facts jsonb
)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  old_request private.church_catering_job_changes%rowtype;
begin
  if p_request is null then raise exception 'A catering request identity is required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('church-catering-request:' || p_location::text || ':' || p_request::text,0));
  select * into old_request from private.church_catering_job_changes where location_id = p_location and request_id = p_request;
  if not found then return null; end if;
  if old_request.actor_id is distinct from p_actor or old_request.request_facts is distinct from p_facts then
    raise exception 'The catering request identity was already used for a different operation' using errcode = 'PT409';
  end if;
  return old_request.result;
end
$$;

create function public.save_church_catering_job(
  p_request_id uuid,p_location_id uuid,p_title text,p_service_date date,p_stage text,
  p_job_id uuid default null,p_expected_revision integer default null
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_catering_authority(actor,p_location_id);
  title text := btrim(p_title);
  job private.church_catering_jobs%rowtype;
  operation text;
  request_facts jsonb;
  result jsonb;
begin
  if title is null or length(title) not between 1 and 120 or title ~ '[[:cntrl:]]'
    or p_service_date is null or p_service_date not between date '2000-01-01' and date '2100-12-31'
    or p_stage is null or p_stage not in ('inquiry','quoted','confirmed','completed','canceled')
    or (p_job_id is null and (p_expected_revision is not null or p_stage <> 'inquiry'))
    or (p_job_id is not null and coalesce(p_expected_revision,0) < 1) then
    raise exception 'Invalid Church Street catering job fields' using errcode = '22023';
  end if;
  request_facts := jsonb_build_object('action','save','id',p_job_id,'revision',p_expected_revision,
    'title',title,'serviceDate',p_service_date,'stage',p_stage);
  result := private.replay_church_catering_job_change(actor,p_location_id,p_request_id,request_facts);
  if result is not null then return result; end if;

  if p_job_id is null then
    insert into private.church_catering_jobs (organization_id,location_id,title,service_date,stage,owner_id,created_by,updated_by)
    values (organization,p_location_id,title,p_service_date,p_stage,actor,actor,actor) returning * into job;
    operation := 'create';
  else
    select * into job from private.church_catering_jobs candidate where candidate.id = p_job_id
      and candidate.location_id = p_location_id and candidate.organization_id = organization for update;
    if not found or job.revision <> p_expected_revision then
      raise exception 'The catering job changed or is unavailable. Reload and try again.' using errcode = 'PT409';
    end if;
    if (job.title,job.service_date,job.stage) is not distinct from (title,p_service_date,p_stage) then
      operation := 'no_change';
    else
      if job.square_invoice_id is not null and job.service_date <> p_service_date then
        raise exception 'A linked catering job service date cannot be changed here' using errcode = 'PT409';
      end if;
      if job.stage in ('completed','canceled')
        or (job.stage <> p_stage and not (
          (job.stage = 'inquiry' and p_stage in ('quoted','confirmed','canceled')) or
          (job.stage = 'quoted' and p_stage in ('inquiry','confirmed','canceled')) or
          (job.stage = 'confirmed' and p_stage in ('quoted','completed','canceled'))
        )) then
        raise exception 'That catering stage change is unavailable' using errcode = 'PT409';
      end if;
      update private.church_catering_jobs as target set title = btrim(p_title),service_date = p_service_date,stage = p_stage,
        revision = target.revision + 1,updated_by = actor,updated_at = clock_timestamp()
      where target.id = job.id returning * into job;
      operation := 'edit';
    end if;
  end if;

  result := private.church_catering_job_view(job);
  insert into private.church_catering_job_changes (location_id,request_id,job_id,actor_id,operation,request_facts,result)
  values (p_location_id,p_request_id,job.id,actor,operation,request_facts,result);
  return result;
end
$$;

create function public.service_attach_church_catering_invoice(
  p_actor_id uuid,p_request_id uuid,p_location_id uuid,p_job_id uuid,p_expected_revision integer,
  p_merchant_id text,p_square_location_id text,p_invoice_id text,p_order_id text,p_invoice_status text,
  p_invoice_service_date date,p_invoice_updated_at timestamptz,p_deposit_state text,
  p_deposit_due_cents integer,p_deposit_completed_cents integer
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid;
  job private.church_catering_jobs%rowtype;
  evidence jsonb;
  request_facts jsonb;
  result jsonb;
  operation text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Square verification service access is required' using errcode = '42501';
  end if;
  organization := private.church_catering_authority(p_actor_id,p_location_id);

  if p_job_id is null or coalesce(p_expected_revision,0) < 1
     or coalesce(p_merchant_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
     or coalesce(p_square_location_id,'') !~ '^[A-Za-z0-9_-]{1,100}$'
     or coalesce(p_invoice_id,'') !~ '^[A-Za-z0-9_:-]{1,192}$'
     or coalesce(p_order_id,'') !~ '^[A-Za-z0-9_:-]{1,192}$'
     or coalesce(p_invoice_status,'') not in ('DRAFT','UNPAID','SCHEDULED','PARTIALLY_PAID','PAID',
       'PARTIALLY_REFUNDED','REFUNDED','CANCELED','FAILED','PAYMENT_PENDING','UNKNOWN')
     or p_invoice_service_date is null or p_invoice_updated_at is null
     or not isfinite(p_invoice_updated_at) or p_invoice_updated_at > statement_timestamp() + interval '5 minutes'
     or coalesce(p_deposit_state,'') not in ('not_requested','unknown','unpaid','partial','satisfied','review_required')
     or coalesce(p_deposit_due_cents,0) < 0 or coalesce(p_deposit_completed_cents,0) < 0
     or (p_deposit_state in ('unpaid','partial','satisfied') and not coalesce(
       p_invoice_status in ('UNPAID','PARTIALLY_PAID','PAID','PAYMENT_PENDING') and p_deposit_due_cents > 0 and
       case p_deposit_state when 'unpaid' then p_deposit_completed_cents = 0
         when 'partial' then p_deposit_completed_cents > 0 and p_deposit_completed_cents < p_deposit_due_cents
         else p_deposit_completed_cents >= p_deposit_due_cents end,false)) then
    raise exception 'Invalid verified catering invoice evidence' using errcode = '22023';
  end if;

  evidence := jsonb_build_object('status',p_invoice_status,'serviceDate',p_invoice_service_date,
    'updatedAt',p_invoice_updated_at,'deposit',jsonb_build_object('state',p_deposit_state,
      'dueCents',p_deposit_due_cents,'completedCents',p_deposit_completed_cents));
  request_facts := jsonb_build_object('action','attach','id',p_job_id,'revision',p_expected_revision,
    'merchant',p_merchant_id,'location',p_square_location_id,'invoice',p_invoice_id,'order',p_order_id,'evidence',evidence);
  result := private.replay_church_catering_job_change(p_actor_id,p_location_id,p_request_id,request_facts);
  if result is not null then return result; end if;

  -- Follow the count/backfill location lock order and accept only the already
  -- registered Square scope (mapping or signed, stored receipt).
  perform 1 from public.locations where id = p_location_id for update;
  organization := private.church_catering_authority(p_actor_id,p_location_id);
  if exists (
    select 1 from private.church_square_count_items item where item.location_id = p_location_id
      and (item.merchant_id,item.square_location_id) is distinct from (p_merchant_id,p_square_location_id)
  ) or exists (
    select 1 from private.church_square_webhook_receipts receipt where receipt.location_id = p_location_id
      and (receipt.merchant_id,receipt.square_location_id) is distinct from (p_merchant_id,p_square_location_id)
  ) or (not exists (
    select 1 from private.church_square_count_items item where item.location_id = p_location_id
      and (item.merchant_id,item.square_location_id) = (p_merchant_id,p_square_location_id)
  ) and not exists (
    select 1 from private.church_square_webhook_receipts receipt where receipt.location_id = p_location_id
      and (receipt.merchant_id,receipt.square_location_id) = (p_merchant_id,p_square_location_id)
  )) then
    raise exception 'Square location is outside the approved Church Street account' using errcode = '42501';
  end if;

  select * into job from private.church_catering_jobs candidate where candidate.id = p_job_id
    and candidate.location_id = p_location_id and candidate.organization_id = organization for update;
  if not found or job.revision <> p_expected_revision then
    raise exception 'The catering job changed or is unavailable. Reload and try again.' using errcode = 'PT409';
  end if;
  if job.service_date <> p_invoice_service_date then
    raise exception 'Square invoice and catering job service dates must match' using errcode = 'PT409';
  end if;
  if job.square_invoice_id is not null and (
      (job.square_merchant_id,job.square_location_id,job.square_invoice_id,job.square_order_id) is distinct from
      (p_merchant_id,p_square_location_id,p_invoice_id,p_order_id)
  ) then
    raise exception 'That job already has a different verified Square invoice or order' using errcode = 'PT409';
  end if;
  if job.square_invoice_id is null and job.stage in ('completed','canceled') then
    raise exception 'New Square invoices require an active catering job' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from private.church_catering_jobs existing where existing.location_id = p_location_id
      and existing.id <> job.id and (existing.square_invoice_id = p_invoice_id or existing.square_order_id = p_order_id)
  ) then
    raise exception 'The Square invoice or order is linked to another catering job' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from private.church_square_resource_state current_invoice
    where current_invoice.organization_id = organization and current_invoice.location_id = p_location_id
      and current_invoice.merchant_id = p_merchant_id and current_invoice.square_location_id = p_square_location_id
      and current_invoice.resource_kind = 'invoice' and current_invoice.resource_id = p_invoice_id
      and current_invoice.source_updated_at > p_invoice_updated_at
  ) then
    raise exception 'Square has newer invoice evidence. Verify the invoice again.' using errcode = 'PT409';
  end if;

  if job.invoice_facts = evidence then
    operation := 'no_change';
  else
    if job.invoice_facts is not null and (job.invoice_facts->>'updatedAt')::timestamptz >= p_invoice_updated_at then
      raise exception 'Square invoice evidence is older or inconsistent' using errcode = 'PT409';
    end if;
    operation := case when job.square_invoice_id is null then 'attach' else 'refresh' end;
    update private.church_catering_jobs as target set square_merchant_id = p_merchant_id,square_location_id = p_square_location_id,
      square_invoice_id = p_invoice_id,square_order_id = p_order_id,invoice_facts = evidence,
      revision = target.revision + 1,updated_by = p_actor_id,updated_at = clock_timestamp()
    where target.id = job.id returning * into job;
  end if;

  result := private.church_catering_job_view(job);
  insert into private.church_catering_job_changes (location_id,request_id,job_id,actor_id,operation,request_facts,result)
  values (p_location_id,p_request_id,job.id,p_actor_id,operation,request_facts,result);
  return result;
end
$$;

create function public.detach_church_catering_invoice(
  p_request_id uuid,p_location_id uuid,p_job_id uuid,p_expected_revision integer,p_expected_invoice_reference text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_catering_authority(actor,p_location_id);
  job private.church_catering_jobs%rowtype;
  request_facts jsonb;
  previous_link jsonb;
  result jsonb;
begin
  if p_job_id is null or coalesce(p_expected_revision,0) < 1
    or coalesce(p_expected_invoice_reference,'') !~ '^[A-Za-z0-9_:-]{1,10}$' then
    raise exception 'Confirm the current catering invoice reference' using errcode = '22023';
  end if;
  request_facts := jsonb_build_object('action','detach','id',p_job_id,'revision',p_expected_revision,
    'invoiceReference',p_expected_invoice_reference);
  result := private.replay_church_catering_job_change(actor,p_location_id,p_request_id,request_facts);
  if result is not null then return result; end if;

  perform 1 from public.locations where id = p_location_id for update;
  organization := private.church_catering_authority(actor,p_location_id);
  select * into job from private.church_catering_jobs candidate where candidate.id = p_job_id
    and candidate.location_id = p_location_id and candidate.organization_id = organization for update;
  if not found or job.revision <> p_expected_revision then
    raise exception 'The catering job changed or is unavailable. Reload and try again.' using errcode = 'PT409';
  end if;
  if job.stage in ('completed','canceled')
    or right(job.square_invoice_id,10) is distinct from p_expected_invoice_reference then
    raise exception 'The current catering invoice cannot be detached with that confirmation' using errcode = 'PT409';
  end if;

  previous_link := jsonb_build_object('merchant',job.square_merchant_id,'location',job.square_location_id,
    'invoice',job.square_invoice_id,'order',job.square_order_id,'evidence',job.invoice_facts);
  update private.church_catering_jobs as target set square_merchant_id = null,square_location_id = null,
    square_invoice_id = null,square_order_id = null,invoice_facts = null,
    revision = target.revision + 1,updated_by = actor,updated_at = clock_timestamp()
  where target.id = job.id returning * into job;

  result := private.church_catering_job_view(job);
  insert into private.church_catering_job_changes (location_id,request_id,job_id,actor_id,operation,request_facts,result,previous_link)
  values (p_location_id,p_request_id,job.id,actor,'detach',request_facts,result,previous_link);
  return result;
end
$$;

revoke all on function private.church_catering_authority(uuid,uuid),private.church_catering_job_view(private.church_catering_jobs),
  private.replay_church_catering_job_change(uuid,uuid,uuid,jsonb),
  public.detach_church_catering_invoice(uuid,uuid,uuid,integer,text),
  public.list_church_catering_jobs(uuid),public.save_church_catering_job(uuid,uuid,text,date,text,uuid,integer),
  public.service_attach_church_catering_invoice(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,date,timestamptz,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.detach_church_catering_invoice(uuid,uuid,uuid,integer,text),
  public.list_church_catering_jobs(uuid),public.save_church_catering_job(uuid,uuid,text,date,text,uuid,integer)
  to authenticated;
grant execute on function public.service_attach_church_catering_invoice(uuid,uuid,uuid,uuid,integer,text,text,text,text,text,date,timestamptz,text,integer,integer)
  to service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114091500', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
