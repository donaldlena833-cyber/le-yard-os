-- Keep every user-visible chat mutation available to connected clients.
-- The earlier realtime list covered messages, reactions, and read receipts;
-- attachments and announcement acknowledgements also need change events for
-- cross-session updates in the live messages workspace.
do $realtime_chat_completeness$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['chat_attachments', 'announcement_acknowledgements']
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
      execute format('alter table public.%I replica identity full', table_name);
    end loop;
  end if;
end
$realtime_chat_completeness$;
