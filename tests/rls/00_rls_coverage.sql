begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

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

select * from finish();
rollback;
