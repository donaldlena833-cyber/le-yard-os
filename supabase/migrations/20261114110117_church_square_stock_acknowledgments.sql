create table private.church_square_stock_acknowledgments (
  item_id uuid not null references private.church_square_count_items(id),
  episode_id uuid not null,
  acknowledged_by uuid not null,
  acknowledged_by_name text not null check (length(acknowledged_by_name) between 1 and 120),
  acknowledged_at timestamptz not null,
  primary key(item_id,episode_id)
);

alter table private.church_square_stock_acknowledgments enable row level security;
alter table private.church_square_stock_acknowledgments force row level security;
revoke all on private.church_square_stock_acknowledgments from public,anon,authenticated,service_role;

create trigger church_square_stock_acknowledgments_append_only
  before update or delete on private.church_square_stock_acknowledgments
  for each row execute function public.prevent_ledger_mutation();

create or replace function public.list_church_square_stock_alerts(p_location_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' set row_security = off
as $$
declare
  target_organization uuid := private.church_square_count_organization(p_location_id);
begin
  if not private.can_record_church_square_count(auth.uid(),target_organization,p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',item.id,'label',item.label,'quantity',trim_scale(stock.quantity)::text,
      'calculatedAt',stock.calculated_at,'episode',stock.episode_id,
      'acknowledgedAt',ack.acknowledged_at,'acknowledgedByName',ack.acknowledged_by_name
    ) order by stock.quantity,item.label,item.id),'[]'::jsonb)
    from private.church_square_count_items item
    join private.church_square_stock_state stock on stock.item_id = item.id
    left join private.church_square_stock_acknowledgments ack on ack.item_id = item.id and ack.episode_id = stock.episode_id
    where item.organization_id = target_organization and item.location_id = p_location_id
      and item.is_enabled and stock.episode_id is not null
  );
end
$$;

create function public.acknowledge_church_square_stock_alert(
  p_location_id uuid,p_item_id uuid,p_episode_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' set row_security = off
as $$
declare
  actor uuid := auth.uid();
  target_organization uuid := private.church_square_count_organization(p_location_id);
  current_episode uuid;
  actor_name text;
  ack private.church_square_stock_acknowledgments%rowtype;
begin
  if not private.can_record_church_square_count(actor,target_organization,p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;
  if p_item_id is null or p_episode_id is null then
    raise exception 'An exact item and low-stock episode are required' using errcode = '22023';
  end if;

  -- Serialize with the webhook's threshold transitions. Keep the mapping enabled through capture.
  perform pg_advisory_xact_lock(hashtextextended('church-square-stock:' || p_item_id::text,0));
  select stock.episode_id into current_episode
  from private.church_square_count_items item
  join private.church_square_stock_state stock on stock.item_id = item.id
  where item.id = p_item_id and item.organization_id = target_organization
    and item.location_id = p_location_id and item.is_enabled
  for share of item;
  if private.church_square_count_organization(p_location_id) is distinct from target_organization
    or not private.can_record_church_square_count(actor,target_organization,p_location_id) then
    raise exception 'Church Street inventory count access is required' using errcode = '42501';
  end if;
  if current_episode is distinct from p_episode_id then
    raise exception 'That low-stock alert is no longer current' using errcode = 'PT409';
  end if;

  select * into ack from private.church_square_stock_acknowledgments existing
  where existing.item_id = p_item_id and existing.episode_id = p_episode_id;
  if not found then
    select left(coalesce(nullif(btrim(profile.preferred_name),''),nullif(btrim(profile.display_name),'')),120)
    into actor_name from public.profiles profile where profile.id = actor;
    insert into private.church_square_stock_acknowledgments (
      item_id,episode_id,acknowledged_by,acknowledged_by_name,acknowledged_at
    ) values (
      p_item_id,p_episode_id,actor,coalesce(actor_name,'Acknowledged by staff'),clock_timestamp()
    ) returning * into ack;

    insert into public.church_square_stock_invalidation_signals as signal (organization_id,location_id)
    values (target_organization,p_location_id)
    on conflict (organization_id,location_id) do update
      set revision = signal.revision + 1,updated_at = clock_timestamp();
  end if;

  return jsonb_build_object('acknowledgedAt',ack.acknowledged_at,'acknowledgedByName',ack.acknowledged_by_name);
end
$$;

revoke all on function public.list_church_square_stock_alerts(uuid),
  public.acknowledge_church_square_stock_alert(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_church_square_stock_alerts(uuid),
  public.acknowledge_church_square_stock_alert(uuid,uuid,uuid) to authenticated;

update private.runtime_schema_contract_expected expected
set migration_head = '20261114110117', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
