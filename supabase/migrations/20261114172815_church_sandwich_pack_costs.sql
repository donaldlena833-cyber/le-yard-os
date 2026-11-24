create table private.church_sandwich_pack_costs (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  location_id uuid not null,
  request_id uuid not null,
  ingredient_key text not null check (private.is_church_ingredient_key(ingredient_key)),
  evidence_revision integer not null check (evidence_revision >= 1),
  supplier_sku text not null check (length(supplier_sku) between 1 and 120),
  pack_quantity numeric not null check (
    pack_quantity > 0 and pack_quantity <= 1000000 and pack_quantity = round(pack_quantity,3)
    and (ingredient_key <> '10-inch baguette' or pack_quantity = trunc(pack_quantity))
  ),
  pack_cost_cents bigint not null check (pack_cost_cents between 1 and 100000000),
  invoice_date date not null check (invoice_date >= date '0001-01-01' and isfinite(invoice_date)),
  invoice_reference text not null check (
    length(invoice_reference) between 1 and 160
    and invoice_reference ~ '\S' and invoice_reference !~ '[[:cntrl:]]'
  ),
  recorded_by uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  unique (location_id,request_id),
  foreign key (organization_id,location_id) references public.locations(organization_id,id),
  foreign key (location_id,ingredient_key) references private.church_ingredient_evidence(location_id,ingredient_key)
);

create index church_sandwich_pack_costs_current_idx
  on private.church_sandwich_pack_costs(location_id,ingredient_key,evidence_revision,invoice_date desc,recorded_at desc,id desc);

alter table private.church_sandwich_pack_costs enable row level security;
alter table private.church_sandwich_pack_costs force row level security;
revoke all on private.church_sandwich_pack_costs from public,anon,authenticated,service_role;

create trigger church_sandwich_pack_costs_append_only
  before update or delete on private.church_sandwich_pack_costs
  for each row execute function public.prevent_ledger_mutation();

comment on table private.church_sandwich_pack_costs is
  'Invoice-backed USD observations. Quantity is the as-purchased whole baguette count or as-purchased grams before prep loss.';

create function private.church_sandwich_pack_cost_authority(p_location_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_square_count_organization(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
begin
  if actor is null or organization is null
    or not public.has_org_role(organization,array['owner','admin','manager']::public.app_role[])
    or not private.user_has_capability(actor,organization,p_location_id,'inventory.price.manage',business_date)
    or not private.user_has_capability(actor,organization,p_location_id,'reports.financial.view',business_date) then
    raise exception 'Church Street inventory price management and financial reports access are required' using errcode = '42501';
  end if;
  return organization;
end
$$;

create function private.church_sandwich_pack_cost_view(p_cost private.church_sandwich_pack_costs)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'ingredientKey',p_cost.ingredient_key,'evidenceRevision',p_cost.evidence_revision,
    'supplierSku',p_cost.supplier_sku,'packQuantity',p_cost.pack_quantity,'packCostCents',p_cost.pack_cost_cents,
    'invoiceDate',p_cost.invoice_date,'invoiceReference',p_cost.invoice_reference,'recordedAt',p_cost.recorded_at
  )
$$;

create function public.list_church_sandwich_pack_costs(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  organization uuid := private.church_sandwich_pack_cost_authority(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
begin
  return (
    select coalesce(jsonb_agg(private.church_sandwich_pack_cost_view(cost) order by cost.ingredient_key),'[]'::jsonb)
    from (
      select distinct on (observed.ingredient_key) observed.*
      from private.church_sandwich_pack_costs observed
      join private.church_ingredient_evidence evidence
        on evidence.organization_id = observed.organization_id and evidence.location_id = observed.location_id
        and evidence.ingredient_key = observed.ingredient_key and evidence.revision = observed.evidence_revision
        and evidence.supplier_sku = observed.supplier_sku and evidence.status = 'reviewed'
      where observed.organization_id = organization and observed.location_id = p_location_id
        and observed.invoice_date <= business_date
      order by observed.ingredient_key,observed.invoice_date desc,observed.recorded_at desc,observed.id desc
    ) cost
  );
end
$$;

create function public.record_church_sandwich_pack_cost(
  p_location_id uuid,p_request_id uuid,p_ingredient_key text,p_evidence_revision integer,
  p_pack_quantity numeric,p_pack_cost_cents bigint,p_invoice_date date,p_invoice_reference text
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  organization uuid := private.church_sandwich_pack_cost_authority(p_location_id);
  business_date date := (statement_timestamp() at time zone 'America/New_York')::date;
  invoice_reference text := btrim(p_invoice_reference);
  evidence private.church_ingredient_evidence%rowtype;
  observed private.church_sandwich_pack_costs%rowtype;
begin
  if p_request_id is null or not private.is_church_ingredient_key(p_ingredient_key)
    or p_evidence_revision is null or p_evidence_revision < 1
    or p_pack_quantity is null or p_pack_quantity <= 0 or p_pack_quantity > 1000000
    or p_pack_quantity <> round(p_pack_quantity,3)
    or (p_ingredient_key = '10-inch baguette' and p_pack_quantity <> trunc(p_pack_quantity))
    or p_pack_cost_cents is null or p_pack_cost_cents not between 1 and 100000000
    or p_invoice_date is null or not isfinite(p_invoice_date) or p_invoice_date not between date '0001-01-01' and business_date
    or invoice_reference is null or length(invoice_reference) not between 1 and 160
    or invoice_reference !~ '\S' or invoice_reference ~ '[[:cntrl:]]' then
    raise exception 'An invoice line with a valid as-purchased pack amount and positive USD cost is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('church-pack-cost-request:' || p_location_id::text || ':' || p_request_id::text,0));
  select * into observed from private.church_sandwich_pack_costs prior
  where prior.organization_id = organization and prior.location_id = p_location_id and prior.request_id = p_request_id;
  if found then
    if (observed.recorded_by,observed.ingredient_key,observed.evidence_revision,observed.pack_quantity,
        observed.pack_cost_cents,observed.invoice_date,observed.invoice_reference) is distinct from
      (actor,p_ingredient_key,p_evidence_revision,p_pack_quantity,p_pack_cost_cents,p_invoice_date,invoice_reference) then
      raise exception 'This pack cost request was already used for a different operation' using errcode = 'PT409';
    end if;
    perform private.church_sandwich_pack_cost_authority(p_location_id);
    return private.church_sandwich_pack_cost_view(observed);
  end if;

  -- Share the supplier evidence writer's lock across costing and review changes.
  perform pg_advisory_xact_lock(hashtextextended('church-ingredient:' || p_location_id::text || ':' || p_ingredient_key,0));
  perform private.church_sandwich_pack_cost_authority(p_location_id);
  select * into evidence from private.church_ingredient_evidence current_evidence
  where current_evidence.organization_id = organization and current_evidence.location_id = p_location_id
    and current_evidence.ingredient_key = p_ingredient_key;
  if not found or evidence.status <> 'reviewed' or evidence.revision <> p_evidence_revision then
    raise exception 'The reviewed supplier evidence changed or is unavailable. Reload before recording the pack cost.'
      using errcode = 'PT409';
  end if;

  insert into private.church_sandwich_pack_costs (
    organization_id,location_id,request_id,ingredient_key,evidence_revision,supplier_sku,
    pack_quantity,pack_cost_cents,invoice_date,invoice_reference,recorded_by
  ) values (
    organization,p_location_id,p_request_id,p_ingredient_key,evidence.revision,evidence.supplier_sku,
    p_pack_quantity,p_pack_cost_cents,p_invoice_date,invoice_reference,actor
  ) returning * into observed;
  return private.church_sandwich_pack_cost_view(observed);
end
$$;

revoke all on function private.church_sandwich_pack_cost_authority(uuid),
  private.church_sandwich_pack_cost_view(private.church_sandwich_pack_costs),
  public.list_church_sandwich_pack_costs(uuid),
  public.record_church_sandwich_pack_cost(uuid,uuid,text,integer,numeric,bigint,date,text)
  from public,anon,authenticated,service_role;
grant execute on function public.list_church_sandwich_pack_costs(uuid),
  public.record_church_sandwich_pack_cost(uuid,uuid,text,integer,numeric,bigint,date,text) to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114172815', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
