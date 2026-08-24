-- Trigger functions execute through their owning triggers and never require
-- direct role execution. Revoke the default PUBLIC privilege explicitly so
-- anonymous, authenticated, and service clients cannot invoke them.

revoke all on function private.bind_auth_user_to_invitation_request()
from public, anon, authenticated, service_role;
revoke all on function private.project_user_invitation_delivery_state()
from public, anon, authenticated, service_role;
revoke all on function private.project_user_invitation_acceptance()
from public, anon, authenticated, service_role;
revoke all on function private.capture_waitlist_removal_evidence()
from public, anon, authenticated, service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20260824220810',
    table_fingerprint = snapshot.value ->> 'tableFingerprint',
    function_fingerprint = snapshot.value ->> 'functionFingerprint',
    access_fingerprint = snapshot.value ->> 'accessFingerprint',
    captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
