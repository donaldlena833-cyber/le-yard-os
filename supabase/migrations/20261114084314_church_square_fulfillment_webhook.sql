alter table private.church_square_webhook_receipts
  drop constraint church_square_webhook_receipts_event_type_check,
  add constraint church_square_webhook_receipts_event_type_check
  check (event_type in (
    'inventory.count.updated', 'order.created', 'order.updated', 'order.fulfillment.updated',
    'payment.created', 'payment.updated', 'refund.created', 'refund.updated',
    'invoice.published', 'invoice.updated', 'invoice.payment_made', 'invoice.refunded', 'invoice.canceled'
  ));

update private.runtime_schema_contract_expected expected
set migration_head = '20261114084314',
  table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint',
  access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
