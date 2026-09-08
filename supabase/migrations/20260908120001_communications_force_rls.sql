-- Keep migration versions monotonic after the already-applied Groups migration.
alter table public.communication_messages force row level security;
alter table public.communication_cases force row level security;
alter table public.communication_case_notes force row level security;
alter table public.communication_threads force row level security;

update private.runtime_schema_contract_expected expected
set migration_head = '20260908120001',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
