-- Deployment configuration, not a schema migration. Requires pg_cron, pg_net,
-- and a Vault secret named le_yard_music_scheduler_v1 matching the server-only
-- MUSIC_SCHEDULER_SECRET in the Operations Vercel project. Never put its value here.
select cron.schedule(
  'le-yard-music-schedule',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://operations.leyardny.com/api/internal/music/schedule',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'le_yard_music_scheduler_v1')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
