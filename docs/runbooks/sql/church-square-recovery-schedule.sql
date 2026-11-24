begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function private.request_church_square_recovery()
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  proof_second text := floor(extract(epoch from clock_timestamp()))::bigint::text;
  signing_key text;
  signed_request text;
begin
  select decrypted_secret into strict signing_key
  from vault.decrypted_secrets where name = 'le_yard_church_square_recovery_v1';
  if signing_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Church Street Square recovery signing configuration unavailable';
  end if;
  signed_request := encode(extensions.hmac(
    'le-yard-church-square-recovery/v1:' || proof_second, signing_key, 'sha256'
  ), 'hex');
  return net.http_post(
    url := 'https://operations.leyardny.com/api/internal/integrations/church-square-recovery',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-le-yard-epoch', proof_second,
      'x-le-yard-recovery-signature', signed_request
    ),
    timeout_milliseconds := 10000
  );
end
$$;

revoke all on function private.request_church_square_recovery() from public, anon, authenticated, service_role;
select cron.schedule(
  'le-yard-church-square-retry',
  '*/5 * * * *',
  'select private.request_church_square_recovery();'
) as job_id;
commit;
