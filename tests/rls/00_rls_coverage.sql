begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(13);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint,
  'every public table has RLS enabled'
);

select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity),
  0::bigint,
  'every public table forces RLS, including for accidental table-owner paths'
);

select is(
  (select count(*) from pg_tables t
   where t.schemaname = 'public'
     and not exists (select 1 from pg_policies p where p.schemaname = t.schemaname and p.tablename = t.tablename)),
  0::bigint,
  'every public table has at least one explicit policy'
);

select is(
  (select count(*) from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'),
  0::bigint,
  'anonymous users have no public-table grants'
);

select ok(
  not (select public from storage.buckets where id = 'receipts'),
  'receipt storage is private'
);

select ok(
  not (select public from storage.buckets where id = 'employee-documents'),
  'employee-document storage is private'
);

select ok(
  not has_table_privilege('authenticated', 'private.integration_credentials', 'select'),
  'authenticated clients cannot read integration credential ciphertext'
);

select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.audit_events'::regclass and tgname = 'audit_events_immutable' and not tgisinternal),
  'the immutable audit guard is installed'
);

-- Validate actual future-object defaults for the application migration role.
-- These uncommitted objects are never visible to another database session.
create table public.readiness_anonymous_default_probe(id bigserial primary key);
select ok(
  not has_table_privilege('anon', 'public.readiness_anonymous_default_probe',
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  'migration-created tables do not inherit anonymous access'
);
select ok(
  not has_sequence_privilege('anon', 'public.readiness_anonymous_default_probe_id_seq',
    'USAGE,SELECT,UPDATE'),
  'migration-created sequences do not inherit anonymous access'
);
select is(
  (select count(*) from pg_class relation
   join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public' and relation.relkind = 'S'
     and case when relation.relkind = 'S' then
       has_sequence_privilege('anon', relation.oid, 'USAGE,SELECT,UPDATE')
       else false end),
  0::bigint,
  'anonymous users have no effective public sequence privileges'
);

drop table public.readiness_anonymous_default_probe;
create temporary table readiness_access_fingerprint_baseline as
  select private.compute_runtime_schema_fingerprints() ->> 'accessFingerprint' as fingerprint;
alter default privileges for role postgres in schema public grant select on tables to anon;
select isnt(
  private.compute_runtime_schema_fingerprints() ->> 'accessFingerprint',
  (select fingerprint from readiness_access_fingerprint_baseline),
  'runtime access fingerprint detects default privilege drift before a table is created'
);
alter default privileges for role postgres in schema public revoke select on tables from anon;

grant usage on sequence public.reservation_events_id_seq to anon;
select isnt(
  private.compute_runtime_schema_fingerprints() ->> 'accessFingerprint',
  (select fingerprint from readiness_access_fingerprint_baseline),
  'runtime access fingerprint detects sequence privilege drift'
);
revoke usage on sequence public.reservation_events_id_seq from anon;

select * from finish();
rollback;
