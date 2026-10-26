-- Exact reviewed historical function; used only in an isolated RLS test database.
create or replace function public.publish_schedule(p_schedule_id uuid, p_note text default null)
returns public.schedules
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare result public.schedules;
begin
  select * into result from public.schedules where id = p_schedule_id for update;
  if result.id is null then raise exception 'Schedule not found' using errcode = 'P0002'; end if;
  if not public.can_manage_location(result.organization_id, result.location_id) then
    raise exception 'Not authorized to publish this schedule' using errcode = '42501';
  end if;
  if result.status = 'published' then return result; end if;
  if result.status <> 'draft' then raise exception 'Only draft schedules can be published' using errcode = '23514'; end if;
  if not exists (
    select 1 from public.shifts shift_row
    where shift_row.schedule_id = result.id and shift_row.status <> 'cancelled'
  ) then
    raise exception 'A schedule must contain at least one active shift' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.shifts shift_row
    where shift_row.schedule_id = result.id
      and (
        shift_row.organization_id <> result.organization_id
        or shift_row.location_id <> result.location_id
      )
  ) then
    raise exception 'Every shift must match the schedule tenant and location' using errcode = '23514';
  end if;
  update public.schedules set
    status = 'published', published_by = auth.uid(), published_at = now(), publish_note = p_note
  where id = result.id returning * into result;
  return result;
end
$$;
