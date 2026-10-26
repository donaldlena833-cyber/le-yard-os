-- Operational relations have no anonymous browser API. Keep staff/service
-- grants and every RLS policy unchanged. Public guest booking uses its existing
-- scoped server-side commands, not anonymous relation access.
revoke all privileges on all tables in schema public from anon, public;
revoke all privileges on all sequences in schema public from anon, public;

-- Migration-created objects must opt in to anonymous access explicitly.
-- Both global and per-schema defaults matter: a per-schema REVOKE cannot
-- subtract a privilege that was granted globally.
alter default privileges for role postgres
  revoke all privileges on tables from anon, public;
alter default privileges for role postgres
  revoke all privileges on sequences from anon, public;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, public;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, public;

-- Some provider-managed creators cannot be administered by the application
-- migrator. Harden them when authorized, otherwise leave an explicit notice.
-- The remaining creator defaults are fingerprinted below and require a
-- provider/owner check before hosted release; no membership is broadened.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    if pg_has_role(current_user, 'supabase_admin', 'MEMBER') then
      alter default privileges for role supabase_admin
        revoke all privileges on tables from anon, public;
      alter default privileges for role supabase_admin
        revoke all privileges on sequences from anon, public;
      alter default privileges for role supabase_admin in schema public
        revoke all privileges on tables from anon, public;
      alter default privileges for role supabase_admin in schema public
        revoke all privileges on sequences from anon, public;
    else
      raise notice 'Protected supabase_admin defaults remain provider-controlled; verify before hosted release';
    end if;
  end if;
end
$$;

-- Include future-default and sequence-grant drift in the existing access
-- fingerprint, alongside relation grants, policies, and function grants.
create or replace function private.compute_runtime_schema_fingerprints()
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
    ), '') || E'\n--sequences--\n' || coalesce((
      select string_agg(concat_ws('|', relation.relname,
        coalesce(relation.relacl::text, '')), E'\n' order by relation.relname)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public' and relation.relkind = 'S'
    ), '') || E'\n--default-privileges--\n' || coalesce((
      select string_agg(concat_ws('|', pg_get_userbyid(default_acl.defaclrole),
        coalesce(namespace.nspname, '*'), default_acl.defaclobjtype,
        default_acl.defaclacl::text), E'\n'
        order by pg_get_userbyid(default_acl.defaclrole),
          coalesce(namespace.nspname, '*'), default_acl.defaclobjtype)
      from pg_catalog.pg_default_acl default_acl
      left join pg_catalog.pg_namespace namespace
        on namespace.oid = default_acl.defaclnamespace
      where default_acl.defaclnamespace = 0 or namespace.nspname = 'public'
    ), ''),
    'sha256'), 'hex')
  into access_hash;

  return jsonb_build_object('tableFingerprint', table_hash,
    'functionFingerprint', function_hash, 'accessFingerprint', access_hash);
end
$$;


revoke all on function private.compute_runtime_schema_fingerprints()
from public, anon, authenticated, service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20261024143200',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
