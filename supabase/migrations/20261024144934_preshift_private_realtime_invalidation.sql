-- Raw pre-shift rows remain private because they include manager-only notes.
-- Broadcast only scoped identity invalidation; reload the safe RPC projection.
create or replace function private.broadcast_preshift_invalidation()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  source_record jsonb := case
    when tg_op <> 'DELETE' then to_jsonb(new)
    else to_jsonb(old)
  end;
  organization_uuid uuid;
  location_uuid uuid;
  new_identity jsonb := case
    when tg_op <> 'DELETE' then jsonb_build_object(
      'id', to_jsonb(new) ->> 'id',
      'organization_id', to_jsonb(new) ->> 'organization_id',
      'location_id', to_jsonb(new) ->> 'location_id'
    )
    else null
  end;
  old_identity jsonb := case
    when tg_op <> 'INSERT' then jsonb_build_object(
      'id', to_jsonb(old) ->> 'id',
      'organization_id', to_jsonb(old) ->> 'organization_id',
      'location_id', to_jsonb(old) ->> 'location_id'
    )
    else null
  end;
  broadcast_payload jsonb;
begin
  if tg_table_schema <> 'public' or tg_table_name not in ('preshifts', 'preshift_acknowledgements') then
    raise exception 'Pre-shift invalidation is trigger-only' using errcode = '42501';
  end if;
  organization_uuid := nullif(source_record ->> 'organization_id', '')::uuid;
  location_uuid := nullif(source_record ->> 'location_id', '')::uuid;

  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null
    and organization_uuid is not null
    and location_uuid is not null then
    broadcast_payload := jsonb_build_object(
      'record', new_identity,
      'old_record', old_identity,
      'operation', tg_op,
      'table', tg_table_name,
      'schema', tg_table_schema
    );
    execute 'select realtime.send($1,$2,$3,$4)'
    using
      broadcast_payload,
      tg_op,
      'service-control:' || organization_uuid::text || ':' || location_uuid::text,
      true;
  end if;
  return null;
end
$$;

revoke all on function private.broadcast_preshift_invalidation()
from public, anon, authenticated, service_role;

create trigger preshifts_private_invalidation
  after insert or update or delete on public.preshifts
  for each row execute function private.broadcast_preshift_invalidation();
create trigger preshift_acknowledgements_private_invalidation
  after insert or update or delete on public.preshift_acknowledgements
  for each row execute function private.broadcast_preshift_invalidation();

do $preshift_broadcast_policy$
begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      create policy le_yard_preshift_invalidation_read
      on realtime.messages for select to authenticated
      using (
        case when realtime.topic() ~ '^service-control:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.can_access_location(
          split_part(realtime.topic(), ':', 2)::uuid,
          split_part(realtime.topic(), ':', 3)::uuid
        ) or public.has_current_location_capability(
          split_part(realtime.topic(), ':', 2)::uuid,
          split_part(realtime.topic(), ':', 3)::uuid,
          'preshift.manage'
        ) else false end
      )
    $policy$;
  end if;
end
$preshift_broadcast_policy$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261024144934',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
