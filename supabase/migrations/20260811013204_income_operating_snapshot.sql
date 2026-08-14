-- Canonical, provider-neutral income evidence for the operating dashboard.
-- Browser roles never read raw check identifiers. A service-only ingest command
-- owns idempotency; an exact-capability snapshot returns bounded aggregates.

create table public.income_sales_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  source text not null check (source in ('toast','manual_import','internal')),
  external_id text not null check (length(btrim(external_id)) between 1 and 300),
  business_date date not null,
  status text not null check (status in ('open','closed','voided','refunded')),
  opened_at timestamptz not null,
  closed_at timestamptz,
  gross_sales_cents bigint not null default 0 check (gross_sales_cents >= 0),
  net_sales_cents bigint not null default 0 check (net_sales_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  comp_cents bigint not null default 0 check (comp_cents >= 0),
  void_cents bigint not null default 0 check (void_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  tip_cents bigint not null default 0 check (tip_cents >= 0),
  service_charge_cents bigint not null default 0 check (service_charge_cents >= 0),
  covers integer not null default 0 check (covers >= 0),
  order_channel text,
  source_observed_at timestamptz not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, location_id, source, external_id),
  unique (organization_id, id),
  check (closed_at is null or closed_at >= opened_at),
  check (status = 'open' or closed_at is not null),
  check (char_length(coalesce(order_channel, '')) <= 120)
);

create index income_sales_checks_location_date_idx
on public.income_sales_checks(organization_id, location_id, business_date, status);

create index income_sales_checks_source_freshness_idx
on public.income_sales_checks(organization_id, location_id, source_observed_at desc);

alter table public.income_sales_checks enable row level security;
alter table public.income_sales_checks force row level security;
revoke all on table public.income_sales_checks from public, anon, authenticated;
grant select, insert, update on table public.income_sales_checks to service_role;

create trigger income_sales_checks_updated_at
before update on public.income_sales_checks
for each row execute function public.touch_updated_at();

create function public.ingest_income_sales_check(
  p_organization_id uuid,
  p_location_id uuid,
  p_source text,
  p_external_id text,
  p_status text,
  p_opened_at timestamptz,
  p_closed_at timestamptz,
  p_gross_sales_cents bigint,
  p_net_sales_cents bigint,
  p_discount_cents bigint,
  p_comp_cents bigint,
  p_void_cents bigint,
  p_tax_cents bigint,
  p_tip_cents bigint,
  p_service_charge_cents bigint,
  p_covers integer,
  p_order_channel text,
  p_source_observed_at timestamptz,
  p_payload_hash text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  current_row public.income_sales_checks%rowtype;
  result_row public.income_sales_checks%rowtype;
  resolved_business_date date;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service-role sales ingestion is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_location_id is null
    or p_source not in ('toast','manual_import','internal')
    or length(btrim(coalesce(p_external_id, ''))) not between 1 and 300
    or p_status not in ('open','closed','voided','refunded')
    or p_opened_at is null or p_source_observed_at is null
    or p_source_observed_at < p_opened_at - interval '1 day'
    or p_source_observed_at > clock_timestamp() + interval '5 minutes'
    or (p_status = 'open' and p_closed_at is not null)
    or (p_status <> 'open' and (p_closed_at is null or p_closed_at < p_opened_at))
    or p_gross_sales_cents is null or p_gross_sales_cents < 0
    or p_net_sales_cents is null or p_net_sales_cents < 0
    or p_discount_cents is null or p_discount_cents < 0
    or p_comp_cents is null or p_comp_cents < 0
    or p_void_cents is null or p_void_cents < 0
    or p_tax_cents is null or p_tax_cents < 0
    or p_tip_cents is null or p_tip_cents < 0
    or p_service_charge_cents is null or p_service_charge_cents < 0
    or p_covers is null or p_covers < 0
    or char_length(coalesce(p_order_channel, '')) > 120
    or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Valid bounded sales-check evidence is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id and location.is_active
  ) then
    raise exception 'Sales-check location not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'income-check:' || p_organization_id::text || ':' || p_location_id::text
        || ':' || p_source || ':' || btrim(p_external_id),
      0
    )
  );
  select sales_check.* into current_row
  from public.income_sales_checks sales_check
  where sales_check.organization_id = p_organization_id
    and sales_check.location_id = p_location_id
    and sales_check.source = p_source
    and sales_check.external_id = btrim(p_external_id)
  for update;

  if current_row.id is not null then
    if p_source_observed_at < current_row.source_observed_at then
      raise exception 'Sales-check source evidence is stale' using errcode = '40001';
    end if;
    if p_source_observed_at = current_row.source_observed_at then
      if p_payload_hash = current_row.payload_hash then
        return to_jsonb(current_row) - 'external_id' || jsonb_build_object('replayed', true);
      end if;
      raise exception 'Sales-check source version conflicts' using errcode = '23505';
    end if;
  end if;

  resolved_business_date := private.resolve_service_business_date(
    p_organization_id,
    p_location_id,
    coalesce(p_closed_at, p_source_observed_at, p_opened_at)
  );
  if resolved_business_date is null then
    raise exception 'Sales-check business date could not be resolved' using errcode = '23514';
  end if;

  insert into public.income_sales_checks (
    organization_id, location_id, source, external_id, business_date, status,
    opened_at, closed_at, gross_sales_cents, net_sales_cents, discount_cents,
    comp_cents, void_cents, tax_cents, tip_cents, service_charge_cents,
    covers, order_channel, source_observed_at, payload_hash
  ) values (
    p_organization_id, p_location_id, p_source, btrim(p_external_id),
    resolved_business_date, p_status, p_opened_at, p_closed_at,
    p_gross_sales_cents, p_net_sales_cents, p_discount_cents, p_comp_cents,
    p_void_cents, p_tax_cents, p_tip_cents, p_service_charge_cents,
    p_covers, nullif(btrim(coalesce(p_order_channel, '')), ''),
    p_source_observed_at, p_payload_hash
  )
  on conflict (organization_id, location_id, source, external_id)
  do update set
    business_date = excluded.business_date,
    status = excluded.status,
    opened_at = excluded.opened_at,
    closed_at = excluded.closed_at,
    gross_sales_cents = excluded.gross_sales_cents,
    net_sales_cents = excluded.net_sales_cents,
    discount_cents = excluded.discount_cents,
    comp_cents = excluded.comp_cents,
    void_cents = excluded.void_cents,
    tax_cents = excluded.tax_cents,
    tip_cents = excluded.tip_cents,
    service_charge_cents = excluded.service_charge_cents,
    covers = excluded.covers,
    order_channel = excluded.order_channel,
    source_observed_at = excluded.source_observed_at,
    payload_hash = excluded.payload_hash
  returning * into result_row;

  return to_jsonb(result_row) - 'external_id' || jsonb_build_object('replayed', false);
end
$$;

create function public.income_operating_snapshot(
  p_organization_id uuid,
  p_location_id uuid,
  p_observed_at timestamptz default statement_timestamp(),
  p_history_days integer default 28
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_timezone text;
  currency_code text;
  effective_on date;
  operating_date date;
  window_starts_at timestamptz;
  window_ends_at timestamptz;
  history_starts_on date;
  current_metrics jsonb;
  hourly_metrics jsonb;
  source_metrics jsonb;
begin
  select location.timezone, organization.currency_code,
    (p_observed_at at time zone location.timezone)::date
  into location_timezone, currency_code, effective_on
  from public.locations location
  join public.organizations organization on organization.id = location.organization_id
  where location.organization_id = p_organization_id
    and location.id = p_location_id and location.is_active;

  if actor_id is null or location_timezone is null
    or p_observed_at is null
    or p_observed_at < clock_timestamp() - interval '5 minutes'
    or p_observed_at > clock_timestamp() + interval '1 minute'
    or p_history_days not between 7 and 56
    or not private.user_has_capability(
      actor_id, p_organization_id, p_location_id,
      'reports.financial.view', effective_on
    ) then
    raise exception 'Income access is required' using errcode = '42501';
  end if;

  operating_date := private.resolve_service_business_date(
    p_organization_id, p_location_id, p_observed_at
  );
  if operating_date is null then
    raise exception 'The operating date could not be resolved' using errcode = '23514';
  end if;
  perform private.ensure_service_shifts(
    p_organization_id, p_location_id, array[operating_date]
  );
  select min(shift.starts_at), max(shift.ends_at)
  into window_starts_at, window_ends_at
  from public.service_shifts shift
  where shift.organization_id = p_organization_id
    and shift.location_id = p_location_id
    and shift.business_date = operating_date
    and shift.status = 'scheduled';
  window_starts_at := coalesce(
    window_starts_at,
    operating_date::timestamp at time zone location_timezone
  );
  window_ends_at := coalesce(
    window_ends_at,
    (operating_date + 1)::timestamp at time zone location_timezone
  );
  history_starts_on := effective_on - (p_history_days - 1);

  with labor_entries as (
    select entry.id, entry.employee_id, entry.job_role_id, entry.status,
      greatest(entry.clocked_in_at, window_starts_at) as starts_at,
      least(coalesce(entry.clocked_out_at, p_observed_at), window_ends_at) as ends_at,
      assignment.hourly_rate_cents
    from public.time_entries entry
    left join lateral (
      select role.hourly_rate_cents
      from public.employee_job_roles role
      where role.organization_id = entry.organization_id
        and role.location_id = entry.location_id
        and role.employee_id = entry.employee_id
        and role.job_role_id = entry.job_role_id
        and role.effective_from <= (entry.clocked_in_at at time zone location_timezone)::date
        and (role.effective_to is null
          or role.effective_to >= (entry.clocked_in_at at time zone location_timezone)::date)
      order by role.effective_from desc, role.id desc
      limit 1
    ) assignment on true
    where entry.organization_id = p_organization_id
      and entry.location_id = p_location_id
      and entry.status in ('open','submitted','approved','corrected')
      and entry.clocked_in_at < window_ends_at
      and coalesce(entry.clocked_out_at, p_observed_at) > window_starts_at
  ), labor_paid as (
    select entry.*,
      greatest(0, round(
        extract(epoch from (entry.ends_at - entry.starts_at)) / 60
        - coalesce((
          select sum(extract(epoch from (
            least(coalesce(break.ended_at, p_observed_at), entry.ends_at)
            - greatest(break.started_at, entry.starts_at)
          )) / 60)
          from public.time_breaks break
          where break.organization_id = p_organization_id
            and break.time_entry_id = entry.id and not break.is_paid
            and break.started_at < entry.ends_at
            and coalesce(break.ended_at, p_observed_at) > entry.starts_at
        ), 0)
      ))::integer as paid_minutes
    from labor_entries entry
    where entry.ends_at > entry.starts_at
  ), sales as (
    select coalesce(sum(check_row.net_sales_cents), 0)::bigint as net_sales_cents,
      coalesce(sum(check_row.gross_sales_cents), 0)::bigint as gross_sales_cents,
      coalesce(sum(check_row.covers), 0)::integer as covers,
      count(*)::integer as check_count,
      max(check_row.source_observed_at) as last_observed_at
    from public.income_sales_checks check_row
    where check_row.organization_id = p_organization_id
      and check_row.location_id = p_location_id
      and check_row.business_date = operating_date
      and check_row.status in ('open','closed')
  ), closeout as (
    select coalesce(sum(closeout.net_sales_cents), 0)::bigint as net_sales_cents,
      count(*)::integer as closeout_count,
      count(*) filter (where closeout.status = 'approved')::integer as approved_count,
      max(closeout.updated_at) as last_observed_at
    from public.shift_closeouts closeout
    where closeout.organization_id = p_organization_id
      and closeout.location_id = p_location_id
      and closeout.business_date = operating_date
  ), expense as (
    select coalesce(sum(expense.total_cents), 0)::bigint as total_cents,
      count(*)::integer as expense_count,
      max(expense.updated_at) as last_observed_at
    from public.expenses expense
    where expense.organization_id = p_organization_id
      and expense.location_id = p_location_id
      and expense.expense_date = operating_date
  ), delivery_cost as (
    select coalesce(sum(round(line.accepted_quantity * line.unit_price_cents)), 0)::bigint
        as total_cents,
      max(delivery.updated_at) as last_observed_at
    from public.deliveries delivery
    join public.delivery_lines line
      on line.organization_id = delivery.organization_id
      and line.delivery_id = delivery.id
    where delivery.organization_id = p_organization_id
      and delivery.location_id = p_location_id
      and delivery.delivered_at >= window_starts_at
      and delivery.delivered_at < window_ends_at
  ), waste_cost as (
    select coalesce(sum(waste.estimated_cost_cents), 0)::bigint as total_cents,
      count(*) filter (where waste.estimated_cost_cents is null)::integer as missing_cost_count,
      max(coalesce(waste.approved_at, waste.created_at)) as last_observed_at
    from public.waste_records waste
    where waste.organization_id = p_organization_id
      and waste.location_id = p_location_id
      and waste.approved_at is not null
      and waste.occurred_at >= window_starts_at
      and waste.occurred_at < window_ends_at
  ), combined as (
    select sales.*, closeout.net_sales_cents as closeout_net_sales_cents,
      closeout.closeout_count, closeout.approved_count,
      closeout.last_observed_at as closeout_observed_at,
      expense.total_cents as expense_cents, expense.expense_count,
      expense.last_observed_at as expense_observed_at,
      delivery_cost.total_cents as delivery_cents,
      delivery_cost.last_observed_at as delivery_observed_at,
      waste_cost.total_cents as waste_cents,
      waste_cost.missing_cost_count,
      waste_cost.last_observed_at as waste_observed_at,
      coalesce(sum(labor.paid_minutes), 0)::integer as labor_minutes,
      coalesce(sum(labor.paid_minutes)
        filter (where labor.hourly_rate_cents is not null), 0)::integer
        as labor_known_rate_minutes,
      coalesce(sum(round(labor.paid_minutes * labor.hourly_rate_cents / 60.0))
        filter (where labor.hourly_rate_cents is not null), 0)::bigint
        as labor_cost_cents,
      count(*) filter (where labor.status = 'open')::integer
        as active_time_entry_count
    from sales cross join closeout cross join expense cross join delivery_cost
    cross join waste_cost left join labor_paid labor on true
    group by sales.net_sales_cents, sales.gross_sales_cents, sales.covers,
      sales.check_count, sales.last_observed_at, closeout.net_sales_cents,
      closeout.closeout_count, closeout.approved_count, closeout.last_observed_at,
      expense.total_cents, expense.expense_count, expense.last_observed_at,
      delivery_cost.total_cents, delivery_cost.last_observed_at,
      waste_cost.total_cents, waste_cost.missing_cost_count,
      waste_cost.last_observed_at
  )
  select jsonb_build_object(
    'liveNetSalesCents', case when combined.last_observed_at is null then null
      else combined.net_sales_cents end,
    'liveGrossSalesCents', case when combined.last_observed_at is null then null
      else combined.gross_sales_cents end,
    'salesCovers', combined.covers,
    'salesCheckCount', combined.check_count,
    'closeoutNetSalesCents', case when combined.closeout_count = 0 then null
      else combined.closeout_net_sales_cents end,
    'closeoutCount', combined.closeout_count,
    'approvedCloseoutCount', combined.approved_count,
    'laborMinutes', combined.labor_minutes,
    'laborKnownRateMinutes', combined.labor_known_rate_minutes,
    'laborCostCents', combined.labor_cost_cents,
    'activeTimeEntryCount', combined.active_time_entry_count,
    'recordedExpenseCents', combined.expense_cents,
    'recordedExpenseCount', combined.expense_count,
    'receivedInventoryCostCents', combined.delivery_cents,
    'approvedWasteCostCents', combined.waste_cents,
    'wasteMissingCostCount', combined.missing_cost_count,
    'trackedContributionCents', case
      when combined.last_observed_at is null
        or combined.labor_minutes <> combined.labor_known_rate_minutes then null
      else combined.net_sales_cents - combined.labor_cost_cents - combined.expense_cents
    end
  ) into current_metrics
  from combined;

  with hours as (
    select generate_series(0, 23)::integer as hour_of_day
  ), sales_hourly as (
    select extract(hour from (
        coalesce(check_row.closed_at, check_row.source_observed_at)
          at time zone location_timezone
      ))::integer as hour_of_day,
      sum(check_row.net_sales_cents)::bigint as revenue_cents,
      count(*)::integer as check_count,
      sum(check_row.covers)::integer as covers,
      count(distinct check_row.business_date)::integer as sample_days
    from public.income_sales_checks check_row
    where check_row.organization_id = p_organization_id
      and check_row.location_id = p_location_id
      and check_row.business_date between history_starts_on and effective_on
      and (
        check_row.status = 'closed'
        or (check_row.status = 'open' and check_row.business_date = operating_date)
      )
    group by 1
  ), reservation_hourly as (
    select extract(hour from reservation.reserved_at at time zone location_timezone)::integer
        as hour_of_day,
      count(*)::integer as reservation_count,
      sum(reservation.party_size)::integer as reservation_covers
    from public.reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.location_id = p_location_id
      and (reservation.reserved_at at time zone location_timezone)::date
        between history_starts_on and effective_on + 1
      and reservation.status not in ('cancelled','no_show')
    group by 1
  ), labor_source as (
    select entry.id, entry.employee_id, entry.job_role_id,
      entry.clocked_in_at,
      coalesce(entry.clocked_out_at, least(p_observed_at, clock_timestamp())) as clocked_out_at,
      assignment.hourly_rate_cents
    from public.time_entries entry
    left join lateral (
      select role.hourly_rate_cents
      from public.employee_job_roles role
      where role.organization_id = entry.organization_id
        and role.location_id = entry.location_id
        and role.employee_id = entry.employee_id and role.job_role_id = entry.job_role_id
        and role.effective_from <= (entry.clocked_in_at at time zone location_timezone)::date
        and (role.effective_to is null
          or role.effective_to >= (entry.clocked_in_at at time zone location_timezone)::date)
      order by role.effective_from desc, role.id desc limit 1
    ) assignment on true
    where entry.organization_id = p_organization_id
      and entry.location_id = p_location_id
      and entry.status in ('open','submitted','approved','corrected')
      and (entry.clocked_in_at at time zone location_timezone)::date
        between history_starts_on and effective_on
      and coalesce(entry.clocked_out_at, p_observed_at) > entry.clocked_in_at
  ), labor_slices as (
    select entry.*, bucket.bucket_start,
      least(entry.clocked_out_at, bucket.bucket_start + interval '1 hour') as slice_end,
      greatest(entry.clocked_in_at, bucket.bucket_start) as slice_start
    from labor_source entry
    cross join lateral generate_series(
      date_trunc('hour', entry.clocked_in_at),
      date_trunc('hour', entry.clocked_out_at - interval '1 microsecond'),
      interval '1 hour'
    ) bucket(bucket_start)
  ), paid_labor_slices as (
    select slice.*,
      greatest(0, round(
        extract(epoch from (slice.slice_end - slice.slice_start)) / 60
        - coalesce((
          select sum(extract(epoch from (
            least(coalesce(break.ended_at, p_observed_at), slice.slice_end)
            - greatest(break.started_at, slice.slice_start)
          )) / 60)
          from public.time_breaks break
          where break.organization_id = p_organization_id
            and break.time_entry_id = slice.id and not break.is_paid
            and break.started_at < slice.slice_end
            and coalesce(break.ended_at, p_observed_at) > slice.slice_start
        ), 0)
      ))::integer as paid_minutes
    from labor_slices slice
  ), labor_hourly as (
    select extract(hour from slice.bucket_start at time zone location_timezone)::integer
        as hour_of_day,
      sum(slice.paid_minutes)::integer as labor_minutes,
      sum(case when slice.hourly_rate_cents is null then 0 else round(
        slice.paid_minutes * slice.hourly_rate_cents / 60.0
      ) end)::bigint as labor_cost_cents
    from paid_labor_slices slice
    group by 1
  )
  select jsonb_agg(jsonb_build_object(
    'hour', hour.hour_of_day,
    'revenueCents', coalesce(sales.revenue_cents, 0),
    'checkCount', coalesce(sales.check_count, 0),
    'salesCovers', coalesce(sales.covers, 0),
    'salesSampleDays', coalesce(sales.sample_days, 0),
    'reservationCount', coalesce(reservation.reservation_count, 0),
    'reservationCovers', coalesce(reservation.reservation_covers, 0),
    'laborMinutes', coalesce(labor.labor_minutes, 0),
    'laborCostCents', coalesce(labor.labor_cost_cents, 0)
  ) order by hour.hour_of_day) into hourly_metrics
  from hours hour
  left join sales_hourly sales using (hour_of_day)
  left join reservation_hourly reservation using (hour_of_day)
  left join labor_hourly labor using (hour_of_day);

  select jsonb_build_array(
    (select jsonb_build_object(
      'key', 'sales_checks', 'label', 'Live sales checks',
      'lastObservedAt', max(check_row.source_observed_at),
      'recordCount', count(*)::integer,
      'grain', 'check_latest_state'
    ) from public.income_sales_checks check_row
    where check_row.organization_id = p_organization_id
      and check_row.location_id = p_location_id
      and check_row.business_date = operating_date),
    (select jsonb_build_object(
      'key', 'time_entries', 'label', 'Time clock',
      'lastObservedAt', max(entry.updated_at),
      'recordCount', count(*)::integer,
      'grain', 'time_entry_accrual'
    ) from public.time_entries entry
    where entry.organization_id = p_organization_id
      and entry.location_id = p_location_id
      and entry.status in ('open','submitted','approved','corrected')
      and entry.clocked_in_at < window_ends_at
      and coalesce(entry.clocked_out_at, p_observed_at) > window_starts_at),
    (select jsonb_build_object(
      'key', 'expenses', 'label', 'Recorded expenses',
      'lastObservedAt', max(expense.updated_at),
      'recordCount', count(*)::integer,
      'grain', 'business_date'
    ) from public.expenses expense
    where expense.organization_id = p_organization_id
      and expense.location_id = p_location_id
      and expense.expense_date = operating_date),
    (select jsonb_build_object(
      'key', 'closeouts', 'label', 'Shift closeouts',
      'lastObservedAt', max(closeout.updated_at),
      'recordCount', count(*)::integer,
      'grain', 'service_closeout'
    ) from public.shift_closeouts closeout
    where closeout.organization_id = p_organization_id
      and closeout.location_id = p_location_id
      and closeout.business_date = operating_date)
  ) into source_metrics;

  return jsonb_build_object(
    'observedAt', p_observed_at,
    'organizationId', p_organization_id,
    'locationId', p_location_id,
    'businessDate', operating_date,
    'timeZone', location_timezone,
    'currencyCode', currency_code,
    'historyDays', p_history_days,
    'windowStartsAt', window_starts_at,
    'windowEndsAt', window_ends_at,
    'current', current_metrics,
    'hourly', coalesce(hourly_metrics, '[]'::jsonb),
    'sources', coalesce(source_metrics, '[]'::jsonb)
  );
end
$$;

revoke all on function public.ingest_income_sales_check(
  uuid, uuid, text, text, text, timestamptz, timestamptz,
  bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  integer, text, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.ingest_income_sales_check(
  uuid, uuid, text, text, text, timestamptz, timestamptz,
  bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  integer, text, timestamptz, text
) to service_role;

revoke all on function public.income_operating_snapshot(
  uuid, uuid, timestamptz, integer
) from public, anon, authenticated, service_role;
grant execute on function public.income_operating_snapshot(
  uuid, uuid, timestamptz, integer
) to authenticated;

comment on table public.income_sales_checks is
  'Provider-neutral latest check state for near-real-time income reporting; raw identifiers are service-only.';
comment on function public.income_operating_snapshot(uuid, uuid, timestamptz, integer) is
  'Exact-capability aggregate of current income evidence and bounded hourly planning signals.';
