-- Current hosted Realtime exposes broadcast_changes with record arguments.
-- Reservation invalidation must never pass full operational rows to that API,
-- so emit the compatible envelope through realtime.send using identity only.

create or replace function public.broadcast_reservation_change()
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
      'reservations:' || organization_uuid::text || ':' || location_uuid::text,
      true;
  end if;
  return null;
end
$$;

revoke all on function public.broadcast_reservation_change()
from public, anon, authenticated, service_role;
