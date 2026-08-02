-- Le Yard OS: timekeeping, closeouts, tips, receipts, purchasing, and inventory.

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  employee_id uuid not null,
  job_role_id uuid not null,
  scheduled_shift_id uuid,
  clocked_in_at timestamptz not null,
  clocked_out_at timestamptz,
  status public.time_entry_status not null default 'open',
  source text not null default 'employee' check (source in ('employee', 'manager', 'import', 'system')),
  clock_in_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(clock_in_metadata) = 'object'),
  clock_out_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(clock_out_metadata) = 'object'),
  submitted_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete restrict,
  foreign key (organization_id, job_role_id) references public.job_roles(organization_id, id) on delete restrict,
  foreign key (organization_id, scheduled_shift_id) references public.shifts(organization_id, id) on delete set null,
  unique (organization_id, id),
  check (clocked_out_at is null or clocked_out_at > clocked_in_at),
  check ((status = 'open' and clocked_out_at is null) or status <> 'open'),
  check ((approved_at is null and approved_by is null) or (approved_at is not null and approved_by is not null))
);

create unique index one_open_time_entry_per_employee
on public.time_entries(employee_id) where clocked_out_at is null;

create table public.time_breaks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  time_entry_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  is_paid boolean not null,
  source text not null default 'employee' check (source in ('employee', 'manager', 'import', 'system')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, time_entry_id) references public.time_entries(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check (ended_at is null or ended_at > started_at)
);

create table public.time_entry_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  time_entry_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  proposed_clocked_in_at timestamptz,
  proposed_clocked_out_at timestamptz,
  proposed_job_role_id uuid,
  proposed_breaks jsonb,
  reason text not null,
  status public.request_status not null default 'pending',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, time_entry_id) references public.time_entries(organization_id, id) on delete cascade,
  foreign key (organization_id, proposed_job_role_id) references public.job_roles(organization_id, id) on delete restrict,
  unique (organization_id, id),
  check (proposed_clocked_out_at is null or proposed_clocked_in_at is null or proposed_clocked_out_at > proposed_clocked_in_at),
  check ((decided_at is null and decided_by is null) or (decided_at is not null and decided_by is not null))
);

create table public.shift_closeouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  business_date date not null,
  shift_label text not null,
  status public.review_status not null default 'pending',
  gross_sales_cents bigint not null default 0 check (gross_sales_cents >= 0),
  net_sales_cents bigint not null default 0 check (net_sales_cents >= 0),
  cash_sales_cents bigint not null default 0 check (cash_sales_cents >= 0),
  card_sales_cents bigint not null default 0 check (card_sales_cents >= 0),
  expected_cash_cents bigint not null default 0,
  actual_cash_cents bigint,
  covers integer not null default 0 check (covers >= 0),
  comps_cents bigint not null default 0 check (comps_cents >= 0),
  voids_cents bigint not null default 0 check (voids_cents >= 0),
  service_charges_cents bigint not null default 0 check (service_charges_cents >= 0),
  card_tips_cents bigint not null default 0 check (card_tips_cents >= 0),
  cash_tips_cents bigint not null default 0 check (cash_tips_cents >= 0),
  notes text,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (location_id, business_date, shift_label),
  unique (organization_id, id),
  check ((status = 'approved' and approved_at is not null and approved_by is not null) or status <> 'approved')
);

create table public.closeout_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  closeout_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id, closeout_id) references public.shift_closeouts(organization_id, id) on delete cascade,
  unique (organization_id, storage_path)
);

create table public.tip_pool_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, id),
  unique (organization_id, name)
);

create table public.tip_pool_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  policy_id uuid not null,
  version integer not null check (version > 0),
  distribution_method public.tip_distribution_method not null,
  effective_from date not null,
  effective_to date,
  source_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(source_rules) = 'object'),
  rounding_rule text not null default 'largest_remainder' check (rounding_rule = 'largest_remainder'),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id, policy_id) references public.tip_pool_policies(organization_id, id) on delete cascade,
  unique (policy_id, version),
  unique (organization_id, id),
  check (effective_to is null or effective_to >= effective_from),
  check ((approved_at is null and approved_by is null) or (approved_at is not null and approved_by is not null))
);

create table public.tip_pool_eligibility_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  policy_version_id uuid not null,
  job_role_id uuid not null,
  eligible boolean not null default true,
  points numeric(10,4) not null default 1 check (points >= 0),
  minimum_minutes integer not null default 0 check (minimum_minutes >= 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, policy_version_id) references public.tip_pool_policy_versions(organization_id, id) on delete cascade,
  foreign key (organization_id, job_role_id) references public.job_roles(organization_id, id) on delete restrict,
  unique (policy_version_id, job_role_id)
);

create table public.tip_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  policy_version_id uuid not null,
  closeout_id uuid,
  business_date date not null,
  shift_label text not null,
  status public.run_status not null default 'draft',
  distributable_cents bigint not null default 0,
  allocated_cents bigint not null default 0,
  calculation_version text not null default 'largest-remainder-v1',
  calculated_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  locked_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, policy_version_id) references public.tip_pool_policy_versions(organization_id, id) on delete restrict,
  foreign key (organization_id, closeout_id) references public.shift_closeouts(organization_id, id) on delete set null,
  unique (location_id, business_date, shift_label),
  unique (organization_id, id),
  check (distributable_cents >= 0 and allocated_cents >= 0),
  check ((status = 'approved' and approved_at is not null and approved_by is not null and locked_at is not null) or status <> 'approved')
);

create table public.tip_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tip_run_id uuid not null,
  source_type text not null check (source_type in ('card_tips', 'cash_tips', 'service_charge', 'other')),
  label text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  is_distributable boolean not null default true,
  reference_type text,
  reference_id uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, tip_run_id) references public.tip_runs(organization_id, id) on delete cascade
);

create table public.tip_run_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tip_run_id uuid not null,
  employee_id uuid not null,
  job_role_id uuid not null,
  worked_minutes integer not null default 0 check (worked_minutes >= 0),
  points numeric(10,4) not null default 1 check (points >= 0),
  eligible boolean not null default true,
  exclusion_reason text,
  source_time_entry_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, tip_run_id) references public.tip_runs(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete restrict,
  foreign key (organization_id, job_role_id) references public.job_roles(organization_id, id) on delete restrict,
  unique (tip_run_id, employee_id)
);

create table public.tip_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tip_run_id uuid not null,
  employee_id uuid not null,
  amount_cents bigint not null check (amount_cents <> 0),
  reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, tip_run_id) references public.tip_runs(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete restrict,
  check ((approved_at is null and approved_by is null) or (approved_at is not null and approved_by is not null))
);

create table public.tip_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tip_run_id uuid not null,
  employee_id uuid not null,
  base_amount_cents bigint not null,
  adjustment_cents bigint not null default 0,
  final_amount_cents bigint not null,
  weight numeric(24,6) not null,
  exact_share numeric(30,12) not null,
  remainder_rank integer,
  explanation jsonb not null check (jsonb_typeof(explanation) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (organization_id, tip_run_id) references public.tip_runs(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete restrict,
  unique (tip_run_id, employee_id)
);

create table public.payroll_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  period_start date not null,
  period_end date not null,
  status public.job_status not null default 'queued',
  format text not null default 'csv' check (format in ('csv', 'xlsx')),
  storage_path text,
  totals jsonb not null default '{}'::jsonb,
  generated_by uuid not null references auth.users(id) on delete restrict,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  check (period_end >= period_start)
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  account_number text,
  contact_name text,
  email text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  payment_terms text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  accounting_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  vendor_id uuid,
  expense_category_id uuid,
  document_kind text not null default 'receipt' check (document_kind in ('receipt', 'invoice', 'credit_note')),
  document_number text,
  document_date date,
  total_cents bigint,
  tax_cents bigint,
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  payment_method text,
  review_status public.review_status not null default 'pending',
  ocr_text text,
  content_hash text,
  source text not null default 'upload' check (source in ('upload', 'camera', 'email', 'integration', 'import')),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  notes text,
  search_vector tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(document_number, '') || ' ' || coalesce(ocr_text, '') || ' ' || coalesce(notes, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, vendor_id) references public.vendors(organization_id, id) on delete set null,
  foreign key (organization_id, expense_category_id) references public.expense_categories(organization_id, id) on delete set null,
  unique (organization_id, id),
  check (total_cents is null or total_cents >= 0),
  check (tax_cents is null or tax_cents >= 0)
);

create unique index receipts_content_hash_unique
on public.receipts(organization_id, content_hash) where content_hash is not null;

create table public.receipt_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  receipt_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  page_count integer check (page_count is null or page_count > 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, receipt_id) references public.receipts(organization_id, id) on delete cascade,
  unique (organization_id, storage_path)
);

create table public.receipt_ocr_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  receipt_id uuid not null,
  provider text not null,
  model text,
  status public.job_status not null default 'queued',
  raw_response jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, receipt_id) references public.receipts(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create table public.receipt_extractions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  receipt_id uuid not null,
  ocr_run_id uuid,
  field_name text not null,
  extracted_value jsonb not null,
  normalized_value jsonb,
  confidence numeric(5,4) check (confidence between 0 and 1),
  bounding_box jsonb,
  review_status public.review_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, receipt_id) references public.receipts(organization_id, id) on delete cascade,
  foreign key (organization_id, ocr_run_id) references public.receipt_ocr_runs(organization_id, id) on delete set null
);

create table public.receipt_duplicate_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  receipt_id uuid not null,
  possible_duplicate_id uuid not null,
  score numeric(5,4) not null check (score between 0 and 1),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  resolution text check (resolution in ('duplicate', 'not_duplicate', 'merged')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, receipt_id) references public.receipts(organization_id, id) on delete cascade,
  foreign key (organization_id, possible_duplicate_id) references public.receipts(organization_id, id) on delete cascade,
  unique (receipt_id, possible_duplicate_id),
  check (receipt_id <> possible_duplicate_id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  receipt_id uuid,
  vendor_id uuid,
  expense_category_id uuid,
  expense_date date not null,
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint generated always as (subtotal_cents + tax_cents) stored,
  description text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, receipt_id) references public.receipts(organization_id, id) on delete set null,
  foreign key (organization_id, vendor_id) references public.vendors(organization_id, id) on delete set null,
  foreign key (organization_id, expense_category_id) references public.expense_categories(organization_id, id) on delete set null,
  unique (organization_id, id)
);

create table public.measurement_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  symbol text not null,
  dimension text not null check (dimension in ('count', 'mass', 'volume', 'length')),
  is_base boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, symbol),
  unique (organization_id, id)
);

create table public.unit_conversions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  from_unit_id uuid not null,
  to_unit_id uuid not null,
  multiplier numeric(20,8) not null check (multiplier > 0),
  item_id uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, from_unit_id) references public.measurement_units(organization_id, id) on delete cascade,
  foreign key (organization_id, to_unit_id) references public.measurement_units(organization_id, id) on delete cascade,
  unique (organization_id, from_unit_id, to_unit_id, item_id),
  check (from_unit_id <> to_unit_id)
);

create table public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  parent_id uuid references public.inventory_categories(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid,
  base_unit_id uuid not null,
  name text not null,
  sku text,
  description text,
  track_inventory boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, category_id) references public.inventory_categories(organization_id, id) on delete set null,
  foreign key (organization_id, base_unit_id) references public.measurement_units(organization_id, id) on delete restrict,
  unique (organization_id, name),
  unique (organization_id, sku),
  unique (organization_id, id)
);

alter table public.unit_conversions
  add constraint unit_conversions_item_fk foreign key (organization_id, item_id)
  references public.inventory_items(organization_id, id) on delete cascade;

create table public.vendor_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  vendor_id uuid not null,
  inventory_item_id uuid not null,
  purchase_unit_id uuid not null,
  vendor_sku text,
  pack_quantity numeric(16,4) not null default 1 check (pack_quantity > 0),
  last_price_cents bigint check (last_price_cents is null or last_price_cents >= 0),
  is_preferred boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, vendor_id) references public.vendors(organization_id, id) on delete cascade,
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete cascade,
  foreign key (organization_id, purchase_unit_id) references public.measurement_units(organization_id, id) on delete restrict,
  unique (vendor_id, inventory_item_id, purchase_unit_id),
  unique (organization_id, id)
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  vendor_id uuid not null,
  po_number text not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'partially_received', 'received', 'cancelled')),
  ordered_on date,
  expected_on date,
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  shipping_cents bigint not null default 0 check (shipping_cents >= 0),
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, vendor_id) references public.vendors(organization_id, id) on delete restrict,
  unique (organization_id, po_number),
  unique (organization_id, id)
);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  purchase_order_id uuid not null,
  inventory_item_id uuid not null,
  unit_id uuid not null,
  quantity numeric(16,4) not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  line_total_cents bigint generated always as (round(quantity * unit_price_cents)::bigint) stored,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, purchase_order_id) references public.purchase_orders(organization_id, id) on delete cascade,
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete restrict,
  foreign key (organization_id, unit_id) references public.measurement_units(organization_id, id) on delete restrict
);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  vendor_id uuid not null,
  purchase_order_id uuid,
  receipt_id uuid,
  delivered_at timestamptz not null,
  invoice_number text,
  received_by uuid not null references auth.users(id) on delete restrict,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, vendor_id) references public.vendors(organization_id, id) on delete restrict,
  foreign key (organization_id, purchase_order_id) references public.purchase_orders(organization_id, id) on delete set null,
  foreign key (organization_id, receipt_id) references public.receipts(organization_id, id) on delete set null,
  unique (organization_id, id)
);

create table public.delivery_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  delivery_id uuid not null,
  inventory_item_id uuid not null,
  unit_id uuid not null,
  quantity numeric(16,4) not null check (quantity > 0),
  accepted_quantity numeric(16,4) not null check (accepted_quantity >= 0 and accepted_quantity <= quantity),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  lot_code text,
  expires_on date,
  created_at timestamptz not null default now(),
  foreign key (organization_id, delivery_id) references public.deliveries(organization_id, id) on delete cascade,
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete restrict,
  foreign key (organization_id, unit_id) references public.measurement_units(organization_id, id) on delete restrict
);

create table public.inventory_par_levels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  inventory_item_id uuid not null,
  par_quantity numeric(16,4) not null check (par_quantity >= 0),
  reorder_quantity numeric(16,4) check (reorder_quantity is null or reorder_quantity >= 0),
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete cascade,
  unique (location_id, inventory_item_id, effective_from)
);

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  counted_at timestamptz not null default now(),
  status public.review_status not null default 'pending',
  count_type text not null default 'full' check (count_type in ('full', 'cycle', 'spot')),
  counted_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create table public.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  inventory_count_id uuid not null,
  inventory_item_id uuid not null,
  unit_id uuid not null,
  expected_quantity numeric(16,4),
  counted_quantity numeric(16,4) not null check (counted_quantity >= 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, inventory_count_id) references public.inventory_counts(organization_id, id) on delete cascade,
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete restrict,
  foreign key (organization_id, unit_id) references public.measurement_units(organization_id, id) on delete restrict,
  unique (inventory_count_id, inventory_item_id, unit_id)
);

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  inventory_item_id uuid not null,
  unit_id uuid not null,
  transaction_kind public.inventory_transaction_kind not null,
  quantity_delta numeric(18,6) not null check (quantity_delta <> 0),
  unit_cost_cents bigint check (unit_cost_cents is null or unit_cost_cents >= 0),
  occurred_at timestamptz not null default now(),
  reference_type text,
  reference_id uuid,
  reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete restrict,
  foreign key (organization_id, unit_id) references public.measurement_units(organization_id, id) on delete restrict
);

create table public.waste_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  inventory_item_id uuid not null,
  unit_id uuid not null,
  quantity numeric(16,4) not null check (quantity > 0),
  reason_code text not null,
  estimated_cost_cents bigint check (estimated_cost_cents is null or estimated_cost_cents >= 0),
  occurred_at timestamptz not null default now(),
  notes text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete restrict,
  foreign key (organization_id, unit_id) references public.measurement_units(organization_id, id) on delete restrict,
  unique (organization_id, id)
);

create table public.inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_location_id uuid not null,
  to_location_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'in_transit', 'received', 'cancelled')),
  sent_at timestamptz,
  received_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  received_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, from_location_id) references public.locations(organization_id, id) on delete restrict,
  foreign key (organization_id, to_location_id) references public.locations(organization_id, id) on delete restrict,
  unique (organization_id, id),
  check (from_location_id <> to_location_id)
);

create table public.inventory_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  transfer_id uuid not null,
  inventory_item_id uuid not null,
  unit_id uuid not null,
  sent_quantity numeric(16,4) not null check (sent_quantity > 0),
  received_quantity numeric(16,4) check (received_quantity is null or received_quantity >= 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, transfer_id) references public.inventory_transfers(organization_id, id) on delete cascade,
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete restrict,
  foreign key (organization_id, unit_id) references public.measurement_units(organization_id, id) on delete restrict
);

create table public.item_price_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  inventory_item_id uuid not null,
  vendor_id uuid not null,
  unit_id uuid not null,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  effective_at timestamptz not null,
  source_type text,
  source_id uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete cascade,
  foreign key (organization_id, vendor_id) references public.vendors(organization_id, id) on delete cascade,
  foreign key (organization_id, unit_id) references public.measurement_units(organization_id, id) on delete restrict
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  yield_quantity numeric(16,4) not null default 1 check (yield_quantity > 0),
  yield_unit_id uuid not null,
  menu_price_cents bigint check (menu_price_cents is null or menu_price_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, yield_unit_id) references public.measurement_units(organization_id, id) on delete restrict,
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  recipe_id uuid not null,
  inventory_item_id uuid not null,
  unit_id uuid not null,
  quantity numeric(16,6) not null check (quantity > 0),
  waste_factor numeric(7,6) not null default 0 check (waste_factor >= 0 and waste_factor < 1),
  created_at timestamptz not null default now(),
  foreign key (organization_id, recipe_id) references public.recipes(organization_id, id) on delete cascade,
  foreign key (organization_id, inventory_item_id) references public.inventory_items(organization_id, id) on delete restrict,
  foreign key (organization_id, unit_id) references public.measurement_units(organization_id, id) on delete restrict,
  unique (recipe_id, inventory_item_id)
);

create table public.cogs_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  period_start date not null,
  period_end date not null,
  opening_inventory_cents bigint not null default 0,
  purchases_cents bigint not null default 0,
  transfers_in_cents bigint not null default 0,
  transfers_out_cents bigint not null default 0,
  closing_inventory_cents bigint not null default 0,
  cogs_cents bigint generated always as (opening_inventory_cents + purchases_cents + transfers_in_cents - transfers_out_cents - closing_inventory_cents) stored,
  status public.review_status not null default 'pending',
  calculated_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (location_id, period_start, period_end),
  check (period_end >= period_start)
);

create index time_entries_employee_time_idx on public.time_entries(employee_id, clocked_in_at desc);
create index time_entries_location_status_idx on public.time_entries(location_id, status, clocked_in_at desc);
create index time_corrections_pending_idx on public.time_entry_corrections(location_id, created_at) where status = 'pending';
create index closeouts_location_date_idx on public.shift_closeouts(location_id, business_date desc);
create index tip_runs_location_date_idx on public.tip_runs(location_id, business_date desc);
create index tip_allocations_employee_idx on public.tip_allocations(employee_id, created_at desc);
create index receipts_search_idx on public.receipts using gin(search_vector);
create index receipts_review_idx on public.receipts(location_id, review_status, document_date desc);
create index receipt_extractions_review_idx on public.receipt_extractions(receipt_id, review_status);
create index purchase_orders_location_status_idx on public.purchase_orders(location_id, status, expected_on);
create index inventory_transactions_item_time_idx on public.inventory_transactions(location_id, inventory_item_id, occurred_at desc);
create index waste_location_time_idx on public.waste_records(location_id, occurred_at desc);
create index price_history_item_time_idx on public.item_price_history(inventory_item_id, effective_at desc);

comment on table public.tip_pool_policy_versions is 'Approved versions are immutable; policies never silently change historical calculations.';
comment on table public.tip_allocations is 'Cent-level deterministic calculation output with human-readable evidence.';
comment on table public.inventory_transactions is 'Append-only inventory ledger; corrections use compensating transactions.';
