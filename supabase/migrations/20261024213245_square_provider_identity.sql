-- Keep historical Toast identities; Square has its own explicit provider.
-- This label is committed before the next migration uses it.
alter type public.integration_provider add value if not exists 'square';
update private.runtime_schema_contract_expected expected
set migration_head='20261024213245',table_fingerprint=s.value->>'tableFingerprint',
 function_fingerprint=s.value->>'functionFingerprint',access_fingerprint=s.value->>'accessFingerprint',captured_at=clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) s where expected.contract_version='runtime-schema-v2';
