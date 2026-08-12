-- Authoritative application/database compatibility contract. This is service
-- role only: public health exposes only a generic ready/not-ready result.
create or replace function public.service_runtime_schema_contract()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  migration_head text;
  public_function_count integer;
begin
  select max(version)::text
    into migration_head
    from supabase_migrations.schema_migrations;

  select count(*)::integer
    into public_function_count
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';

  return pg_catalog.jsonb_build_object(
    'migrationHead', migration_head,
    'publicFunctionCount', public_function_count,
    'contractVersion', 'runtime-schema-v1'
  );
end;
$$;

revoke all on function public.service_runtime_schema_contract() from public;
revoke all on function public.service_runtime_schema_contract() from anon;
revoke all on function public.service_runtime_schema_contract() from authenticated;
grant execute on function public.service_runtime_schema_contract() to service_role;

comment on function public.service_runtime_schema_contract() is
  'Returns the minimal service-only runtime schema contract used to fail closed when the deployed application and database are out of sync.';
