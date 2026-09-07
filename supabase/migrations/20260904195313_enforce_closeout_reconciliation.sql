-- Closeout arithmetic belongs to the database, not to a form or simulation.
-- These constraints apply to every new or changed closeout record.

alter table public.shift_closeouts
  add constraint shift_closeouts_gross_to_net_check
  check (
    gross_sales_cents - comps_cents - voids_cents = net_sales_cents
  ),
  add constraint shift_closeouts_tenders_to_net_check
  check (
    cash_sales_cents + card_sales_cents = net_sales_cents
  ),
  add constraint shift_closeouts_cash_variance_reason_check
  check (
    actual_cash_cents is null
    or actual_cash_cents = expected_cash_cents
    or length(btrim(coalesce(notes, ''))) >= 8
  ),
  add constraint shift_closeouts_approved_cash_evidence_check
  check (
    status <> 'approved'
    or actual_cash_cents is not null
  );

comment on constraint shift_closeouts_gross_to_net_check on public.shift_closeouts is
  'Gross sales less comps and voids must equal net sales.';
comment on constraint shift_closeouts_tenders_to_net_check on public.shift_closeouts is
  'Cash and card tenders must equal net sales.';
comment on constraint shift_closeouts_cash_variance_reason_check on public.shift_closeouts is
  'A nonzero drawer variance requires a meaningful reason or recorded correction note.';
comment on constraint shift_closeouts_approved_cash_evidence_check on public.shift_closeouts is
  'An approved closeout must retain an actual blind-count result.';

-- Cash is an append-only journal. Corrections are additional movements rather
-- than edits, preserving the original observation and actor.

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  business_date date not null,
  closeout_id uuid,
  movement_kind text not null check (
    movement_kind in (
      'opening_bank',
      'cash_sale',
      'paid_out',
      'cash_drop',
      'deposit',
      'adjustment'
    )
  ),
  amount_cents bigint not null check (amount_cents <> 0),
  actor_id uuid not null references auth.users(id) on delete restrict,
  note text not null check (length(btrim(note)) >= 8 and length(note) <= 2000),
  correction_of_id uuid,
  simulation_run_id text check (
    simulation_run_id is null
    or simulation_run_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$'
  ),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, closeout_id)
    references public.shift_closeouts(organization_id, id) on delete restrict,
  foreign key (correction_of_id)
    references public.cash_movements(id) on delete restrict,
  unique (organization_id, id),
  check (
    (movement_kind = 'adjustment' and correction_of_id is not null)
    or (movement_kind <> 'adjustment' and correction_of_id is null)
  )
);

create index cash_movements_location_date_created_idx
on public.cash_movements (location_id, business_date desc, created_at, id);

create index cash_movements_closeout_idx
on public.cash_movements (closeout_id)
where closeout_id is not null;

alter table public.cash_movements enable row level security;
alter table public.cash_movements force row level security;

create policy cash_movements_exact_capability_read
on public.cash_movements
for select
to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array[
      'cash.manage',
      'closeout.create',
      'closeout.approve',
      'reports.financial.view'
    ]
  )
);

create policy cash_movements_exact_capability_insert
on public.cash_movements
for insert
to authenticated
with check (
  actor_id = auth.uid()
  and public.has_capability(
    organization_id,
    location_id,
    'cash.manage'
  )
);

revoke all on table public.cash_movements from public, anon, authenticated;
grant select, insert on table public.cash_movements to authenticated;
grant all on table public.cash_movements to service_role;

create or replace function public.guard_cash_movement_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  raise exception 'Cash movements are append-only; record an adjustment instead'
    using errcode = '42501';
end
$$;

create trigger cash_movement_append_only_guard
before update or delete on public.cash_movements
for each row execute function public.guard_cash_movement_append_only();

revoke all on function public.guard_cash_movement_append_only() from public, anon, authenticated;

comment on table public.cash_movements is
  'Append-only cash journal for opening banks, sales, paid-outs, drops, deposits, and linked corrections.';
comment on column public.cash_movements.simulation_run_id is
  'Optional exact synthetic run scope; never implies permission to mutate production data.';

-- This repository intentionally fingerprints the complete runtime schema. Any
-- later migration must close by capturing its own reviewed catalog head.
update private.runtime_schema_contract_expected expected
set migration_head = '20260904195313',
    table_fingerprint = snapshot.value ->> 'tableFingerprint',
    function_fingerprint = snapshot.value ->> 'functionFingerprint',
    access_fingerprint = snapshot.value ->> 'accessFingerprint',
    captured_at = clock_timestamp()
from (
  select private.compute_runtime_schema_fingerprints() as value
) snapshot
where expected.contract_version = 'runtime-schema-v2';
