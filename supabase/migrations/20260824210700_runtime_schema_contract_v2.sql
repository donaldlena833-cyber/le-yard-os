-- Final migration: catalog-level schema, function, and access fingerprints.
-- The expected values are captured only after this migration's full contract
-- surface exists, so later drift fails health without exposing catalog detail.

create table private.runtime_schema_contract_expected (
  contract_version text primary key,
  migration_head text not null,
  table_fingerprint text not null check (table_fingerprint ~ '^[0-9a-f]{64}$'),
  function_fingerprint text not null check (function_fingerprint ~ '^[0-9a-f]{64}$'),
  access_fingerprint text not null check (access_fingerprint ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null default clock_timestamp()
);
revoke all on table private.runtime_schema_contract_expected
from public, anon, authenticated, service_role;
grant select on table private.runtime_schema_contract_expected to service_role;

create function private.compute_runtime_schema_fingerprints()
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  table_hash text;
  function_hash text;
  access_hash text;
begin
  select encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', column_info.table_name, column_info.ordinal_position,
      column_info.column_name, column_info.data_type, column_info.udt_schema,
      column_info.udt_name, column_info.is_nullable,
      coalesce(column_info.column_default, '')), E'\n'
    order by column_info.table_name, column_info.ordinal_position
  ), ''), 'sha256'), 'hex')
  into table_hash
  from information_schema.columns column_info
  join information_schema.tables table_info
    on table_info.table_schema = column_info.table_schema
   and table_info.table_name = column_info.table_name
  where column_info.table_schema = 'public'
    and table_info.table_type = 'BASE TABLE';

  select encode(extensions.digest(coalesce(string_agg(
    concat_ws('|', procedure.oid::regprocedure::text,
      procedure.prokind, procedure.provolatile, procedure.prosecdef,
      pg_get_functiondef(procedure.oid)), E'\n'
    order by procedure.oid::regprocedure::text
  ), ''), 'sha256'), 'hex')
  into function_hash
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public';

  select encode(extensions.digest(
    coalesce((
      select string_agg(concat_ws('|', relation.relname,
        relation.relrowsecurity, relation.relforcerowsecurity,
        coalesce(relation.relacl::text, '')), E'\n' order by relation.relname)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and relation.relkind in ('r','p','v','m')
    ), '') || E'\n--policies--\n' || coalesce((
      select string_agg(concat_ws('|', policy.tablename, policy.policyname,
        policy.permissive, policy.roles::text, policy.cmd,
        coalesce(policy.qual, ''), coalesce(policy.with_check, '')),
        E'\n' order by policy.tablename, policy.policyname)
      from pg_catalog.pg_policies policy where policy.schemaname = 'public'
    ), '') || E'\n--functions--\n' || coalesce((
      select string_agg(concat_ws('|', procedure.oid::regprocedure::text,
        coalesce(procedure.proacl::text, '')), E'\n'
        order by procedure.oid::regprocedure::text)
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
    ), ''),
    'sha256'), 'hex')
  into access_hash;

  return jsonb_build_object('tableFingerprint', table_hash,
    'functionFingerprint', function_hash, 'accessFingerprint', access_hash);
end
$$;

create or replace function public.service_runtime_schema_contract()
returns jsonb
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  migration_head text;
  public_function_count integer;
  actual jsonb;
  expected private.runtime_schema_contract_expected%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select max(version)::text into migration_head
  from supabase_migrations.schema_migrations;
  select count(*)::integer into public_function_count
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public';
  actual := private.compute_runtime_schema_fingerprints();
  select * into expected from private.runtime_schema_contract_expected contract
  where contract.contract_version = 'runtime-schema-v2';
  return jsonb_build_object(
    'contractVersion', 'runtime-schema-v2',
    'migrationHead', migration_head,
    'publicFunctionCount', public_function_count,
    'tableFingerprint', actual ->> 'tableFingerprint',
    'functionFingerprint', actual ->> 'functionFingerprint',
    'accessFingerprint', actual ->> 'accessFingerprint',
    'schemaFingerprint', encode(extensions.digest(
      concat_ws('|', actual ->> 'tableFingerprint',
        actual ->> 'functionFingerprint', actual ->> 'accessFingerprint'),
      'sha256'), 'hex'),
    'matchesExpected', expected.migration_head = migration_head
      and expected.table_fingerprint = actual ->> 'tableFingerprint'
      and expected.function_fingerprint = actual ->> 'functionFingerprint'
      and expected.access_fingerprint = actual ->> 'accessFingerprint'
  );
end
$$;

revoke all on function private.compute_runtime_schema_fingerprints()
from public, anon, authenticated, service_role;
revoke all on function public.service_runtime_schema_contract()
from public, anon, authenticated;
grant execute on function public.service_runtime_schema_contract() to service_role;

insert into private.runtime_schema_contract_expected (
  contract_version, migration_head, table_fingerprint,
  function_fingerprint, access_fingerprint
)
select 'runtime-schema-v2', '20260824210700',
  snapshot.value ->> 'tableFingerprint',
  snapshot.value ->> 'functionFingerprint',
  snapshot.value ->> 'accessFingerprint'
from (select private.compute_runtime_schema_fingerprints() as value) snapshot;

comment on function public.service_runtime_schema_contract() is
'Service-only v2 compatibility proof covering migration head, table columns, function bodies, grants, RLS flags, and policies.';
