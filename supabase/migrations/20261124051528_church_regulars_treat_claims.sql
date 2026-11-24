-- Purchase eligibility is verified server-side against Square before reservation.
-- No mobile numbers, names, payment details or marketing permissions are copied.
create table private.church_regulars_treat_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.locations(id),
  account_id text not null check (account_id ~ '^[A-Za-z0-9_:-]{1,192}$'),
  milestone integer not null check (milestone in (3,7)),
  earned_on date not null,
  cycle_start date not null,
  cycle_end date not null,
  request_id uuid not null unique,
  evidence jsonb not null,
  status text not null default 'reserved' check (status in ('reserved','fulfilled','canceled')),
  reserved_by uuid not null,
  reserved_at timestamptz not null default clock_timestamp(),
  last_actor_id uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  fulfilled_at timestamptz,
  item_label text,
  check (earned_on = cycle_start + milestone - 1 and cycle_end >= earned_on),
  check ((status = 'fulfilled' and fulfilled_at is not null and item_label is not null and length(btrim(item_label)) between 1 and 160)
    or (status <> 'fulfilled' and fulfilled_at is null and item_label is null))
);
create index church_regulars_treat_claims_member on private.church_regulars_treat_claims(organization_id,location_id,account_id);

create table private.church_regulars_treat_audit (
  id bigint generated always as identity primary key,
  claim_id uuid not null references private.church_regulars_treat_claims(id),
  actor_id uuid not null,
  status text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table private.church_regulars_treat_claims enable row level security;
alter table private.church_regulars_treat_claims force row level security;
alter table private.church_regulars_treat_audit enable row level security;
alter table private.church_regulars_treat_audit force row level security;
revoke all on private.church_regulars_treat_claims,private.church_regulars_treat_audit from public,anon,authenticated,service_role;
grant usage on schema private to service_role;
grant select,insert,update on private.church_regulars_treat_claims to service_role;
grant select,insert on private.church_regulars_treat_audit to service_role;
grant usage,select on sequence private.church_regulars_treat_audit_id_seq to service_role;
create policy regulars_claim_service on private.church_regulars_treat_claims to service_role using(true) with check(true);
create policy regulars_audit_service on private.church_regulars_treat_audit to service_role using(true) with check(true);

create function private.audit_church_regulars_treat_claim()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Treat claims cannot be deleted'; end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'reserved' or new.status not in ('fulfilled','canceled')
      or row(new.id,new.organization_id,new.location_id,new.account_id,new.milestone,new.earned_on,
        new.cycle_start,new.cycle_end,new.request_id,new.evidence,new.reserved_by,new.reserved_at)
      is distinct from row(old.id,old.organization_id,old.location_id,old.account_id,old.milestone,old.earned_on,
        old.cycle_start,old.cycle_end,old.request_id,old.evidence,old.reserved_by,old.reserved_at) then
      raise exception 'Treat claim history is immutable' using errcode = '22023';
    end if;
  end if;
  insert into private.church_regulars_treat_audit(claim_id,actor_id,status)
    values(new.id,new.last_actor_id,new.status);
  return new;
end $$;
revoke all on function private.audit_church_regulars_treat_claim() from public,anon,authenticated,service_role;
create trigger church_regulars_treat_claim_audit after insert or update or delete on private.church_regulars_treat_claims
  for each row execute function private.audit_church_regulars_treat_claim();
create trigger church_regulars_treat_audit_append_only before update or delete on private.church_regulars_treat_audit
  for each row execute function public.prevent_ledger_mutation();

create function public.service_church_regulars_treat(
  p_actor_id uuid,p_location_id uuid,p_account_id text,p_action text,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  target_org uuid;
  selected_id uuid;
  target private.church_regulars_treat_claims%rowtype;
  start_day date; end_day date; earned_day date; step integer;
  today date := (clock_timestamp() at time zone 'America/New_York')::date;
begin
  select organization.id into target_org
  from public.organizations organization
  join public.locations location on location.organization_id = organization.id
  join public.organization_memberships membership on membership.organization_id = organization.id
  where organization.slug = 'le-yard-church-street' and organization.status = 'active'
    and location.id = p_location_id and location.code = 'CHURCH' and location.is_active
    and membership.user_id = p_actor_id and membership.status = 'active' and membership.role in ('owner','admin')
    for share of organization,location,membership;
  if target_org is null then raise exception 'Church Street owner access required' using errcode = '42501'; end if;
  if p_action is null or p_account_id is null or p_account_id !~ '^[A-Za-z0-9_:-]{1,192}$'
    or p_action not in ('read','reserve','fulfill','cancel') then
    raise exception 'Invalid treat request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('church-regulars:' || target_org::text || ':' || p_account_id,0));
  if p_action = 'reserve' then
    start_day := (p_payload->>'cycleStart')::date; end_day := (p_payload->>'cycleEnd')::date;
    earned_day := (p_payload->>'earnedOn')::date; step := (p_payload->>'milestone')::integer;
    if step not in (3,7) or start_day is null or end_day is null or earned_day is null
      or start_day < '2026-11-24'::date or end_day > today
      or earned_day <> start_day + step - 1 or end_day < earned_day
      or jsonb_array_length(p_payload->'qualifyingDays') is distinct from step
      or jsonb_array_length(p_payload->'orderIds') is distinct from step
      or exists(select 1 from jsonb_array_elements_text(p_payload->'qualifyingDays') with ordinality d(value,n)
        where d.value::date <> start_day + d.n::integer - 1)
      or exists(select 1 from jsonb_array_elements_text(p_payload->'orderIds') d(value)
        where d.value !~ '^[A-Za-z0-9_:-]{1,192}$')
      or (select count(distinct value) from jsonb_array_elements_text(p_payload->'orderIds')) <> step then
      raise exception 'Complete qualifying purchase evidence required' using errcode = '22023';
    end if;
    select * into target from private.church_regulars_treat_claims c
      where c.organization_id = target_org and c.location_id = p_location_id and c.account_id = p_account_id
        and c.status <> 'canceled' and c.milestone = step and c.cycle_start <= end_day and c.cycle_end >= start_day
      order by c.reserved_at limit 1;
    if found then selected_id := target.id;
    else
      insert into private.church_regulars_treat_claims(
        organization_id,location_id,account_id,milestone,earned_on,cycle_start,cycle_end,request_id,
        evidence,reserved_by,last_actor_id
      ) values(target_org,p_location_id,p_account_id,step,earned_day,start_day,end_day,(p_payload->>'requestId')::uuid,
        jsonb_build_object('qualifyingDays',p_payload->'qualifyingDays','orderIds',p_payload->'orderIds'),p_actor_id,p_actor_id)
      returning id into selected_id;
    end if;
  elsif p_action in ('fulfill','cancel') then
    select * into target from private.church_regulars_treat_claims c
      where c.id = (p_payload->>'claimId')::uuid and c.organization_id = target_org
        and c.location_id = p_location_id and c.account_id = p_account_id for update;
    if not found then raise exception 'Treat claim not found' using errcode = '22023'; end if;
    selected_id := target.id;
    if p_action = 'fulfill' and target.status = 'fulfilled' then
      if target.item_label is distinct from btrim(p_payload->>'itemLabel') then raise exception 'Treat already handed over' using errcode = 'PT409'; end if;
    elsif p_action = 'cancel' and target.status = 'canceled' then null;
    elsif target.status <> 'reserved' then raise exception 'Treat claim changed' using errcode = 'PT409';
    else
      if p_action = 'fulfill' and (p_payload->>'itemLabel' is null or length(btrim(p_payload->>'itemLabel')) not between 1 and 160) then
        raise exception 'Record the treat handed over' using errcode = '22023';
      end if;
      update private.church_regulars_treat_claims set
        status = case when p_action = 'fulfill' then 'fulfilled' else 'canceled' end,
        fulfilled_at = case when p_action = 'fulfill' then clock_timestamp() else null end,
        item_label = case when p_action = 'fulfill' then btrim(p_payload->>'itemLabel') else null end,
        last_actor_id = p_actor_id,updated_at = clock_timestamp() where id = selected_id;
    end if;
  end if;
  return jsonb_build_object('selectedClaimId',selected_id,'claims',(
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'milestone',c.milestone,'earnedOn',c.earned_on,
      'cycleStart',c.cycle_start,'cycleEnd',c.cycle_end,'status',c.status,'reservedAt',c.reserved_at,
      'fulfilledAt',c.fulfilled_at,'itemLabel',c.item_label) order by c.reserved_at),'[]'::jsonb)
    from private.church_regulars_treat_claims c where c.organization_id = target_org and c.location_id = p_location_id and c.account_id = p_account_id
  ));
end $$;
revoke all on function public.service_church_regulars_treat(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_church_regulars_treat(uuid,uuid,text,text,jsonb) to service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20261124051528',table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint',access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
