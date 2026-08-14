-- Postgres Changes DELETE events cannot be safely tenant-filtered, so the
-- operational publication deliberately carries INSERT/UPDATE only. Convert
-- user-visible child deletions into a scoped parent UPDATE: authorized chat
-- clients receive the message update and re-read its RLS-filtered evidence.

create or replace function private.touch_chat_message_after_child_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op <> 'DELETE'
    or tg_table_schema <> 'public'
    or tg_table_name not in (
      'chat_reactions',
      'chat_attachments',
      'announcement_acknowledgements'
    ) then
    raise exception 'Chat child invalidation is trigger-only'
      using errcode = '55000';
  end if;

  update public.chat_messages message
  set updated_at = clock_timestamp()
  where message.organization_id = old.organization_id
    and message.id = old.message_id
    and message.deleted_at is null;

  return old;
end
$$;

revoke all on function private.touch_chat_message_after_child_delete()
from public, anon, authenticated, service_role;

drop trigger if exists chat_reaction_delete_invalidate_message
on public.chat_reactions;
create trigger chat_reaction_delete_invalidate_message
after delete on public.chat_reactions
for each row execute function private.touch_chat_message_after_child_delete();

drop trigger if exists chat_attachment_delete_invalidate_message
on public.chat_attachments;
create trigger chat_attachment_delete_invalidate_message
after delete on public.chat_attachments
for each row execute function private.touch_chat_message_after_child_delete();

drop trigger if exists chat_acknowledgement_delete_invalidate_message
on public.announcement_acknowledgements;
create trigger chat_acknowledgement_delete_invalidate_message
after delete on public.announcement_acknowledgements
for each row execute function private.touch_chat_message_after_child_delete();

comment on function private.touch_chat_message_after_child_delete() is
  'Trigger-only bridge from RLS-unsafe child DELETE events to one authorized parent-message UPDATE invalidation.';
