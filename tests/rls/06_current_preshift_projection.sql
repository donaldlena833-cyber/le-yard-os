begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(12);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
-- Exercise actual versioned publication commands; retain all versions until rollback.
do $fixture$
declare period text; i integer; revisions integer;
begin
  foreach period in array array['lunch','dinner','all_day'] loop
    revisions:=case period when 'lunch' then 30 else 2 end;
    for i in 1..(revisions+15) loop
      perform public.save_preshift(extensions.gen_random_uuid(),null,
        '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
        '2036-01-07',period,case when i<=revisions then 'published' else 'draft' end,
        null,null,null,'Projection fixture '||period||' '||i,null,null,null,'[]'::jsonb,null,null,null,'PRIVATE projection fixture');
    end loop;
  end loop;
  perform public.save_preshift(extensions.gen_random_uuid(),null,
    '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',
    '2036-01-07','dinner','published',null,null,null,'OTHER LOCATION fixture',null,null,null,'[]'::jsonb,null,null,null,'PRIVATE other location');
end
$fixture$;
set local role authenticated;
create temporary table owner_briefs as select * from public.read_preshifts_safe('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2036-01-07',12);
select is((select count(*) from owner_briefs),12::bigint,'Owner projection preserves the requested bound');
select is((select count(*) from owner_briefs where status='published' and ((service_period='lunch' and version_number=30) or (service_period in ('dinner','all_day') and version_number=2))),3::bigint,'Owner sees the current publication from every service despite many lunch revisions');
select is((select count(*) from owner_briefs where status='draft' and ((service_period='lunch' and version_number=45) or (service_period in ('dinner','all_day') and version_number=17))),3::bigint,'many drafts cannot starve another service or the current publication');
select ok((select bool_and(manager_notes='PRIVATE projection fixture') from owner_briefs),'authorized manager projection keeps its private notes');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',true);
create temporary table employee_briefs as select * from public.read_preshifts_safe('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2036-01-07',12);
select is((select count(*) from employee_briefs),12::bigint,'staff projection preserves the requested bound');
select is((select count(*) from employee_briefs where (service_period='lunch' and version_number=30) or (service_period in ('dinner','all_day') and version_number=2)),3::bigint,'staff sees every current publication before historical versions');
select ok((select bool_and(status<>'draft') from employee_briefs),'staff cannot read any draft');
select ok((select bool_and(manager_notes is null) from employee_briefs),'staff cannot read any manager note');
select ok((select bool_and(location_id='30000000-0000-4000-8000-000000000001') from employee_briefs),'other-location briefs do not enter the bounded projection');
select is((select array_agg(id) from public.read_preshifts_safe('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2036-01-07',12)),(select array_agg(id) from public.read_preshifts_safe('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2036-01-07',12)),'identical bounded reads use deterministic ordering');
select ok((select status='published' from public.read_preshifts_safe('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2036-01-07',1)),'even a one-row request prioritizes a current publication');
select throws_ok($q$select * from public.read_preshifts_safe('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2036-01-07',0)$q$,'22023',null,'invalid limits remain refused');
reset role;
select * from finish();
rollback;
