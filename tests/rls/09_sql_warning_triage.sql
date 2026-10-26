begin;
select plan(21);
create temporary table reviewed_clock_functions(identity text, body_md5 text) on commit drop;
insert into reviewed_clock_functions values
('private.reservation_lifecycle_head_authoritative_kernel(uuid,uuid)','9ed4f83c3d0ae89af04eb9aca37b1886'),
('public.service_connected_acceptance_marker(uuid,text,uuid,text)','a4d790ee81b111cae8ffe623def828b2'),
('public.service_get_managed_reservation(uuid,uuid,text)','ef047c8e3f05fe2c418d9caccec7afbb'),
('public.service_reservation_lifecycle_head(uuid,uuid)','a45ff1711ea4c988638adcccd8f5e9ad'),
('public.service_reservation_pacing_snapshot(uuid,uuid,timestamp with time zone,timestamp with time zone)','fa69e083f8aa65d9ad592dcd02d76018');
select is(p.provolatile::text,'v','clock reader is volatile: '||review.identity)
from reviewed_clock_functions review join pg_proc p on p.oid=review.identity::regprocedure order by review.identity;
select ok(not exists(select 1 from reviewed_clock_functions review join pg_proc p on p.oid=review.identity::regprocedure where md5(p.prosrc)<>review.body_md5),'clock-reader bodies remain byte-identical');
select ok(not exists(select 1 from reviewed_clock_functions review join pg_proc p on p.oid=review.identity::regprocedure where pg_get_userbyid(p.proowner)<>'postgres' or not p.prosecdef),'clock-reader owners and definer boundaries remain');
select ok(not has_function_privilege('authenticated','private.startup_timestamp_is_valid(text)','execute') and not has_function_privilege('anon','private.startup_timestamp_is_valid(text)','execute') and not has_function_privilege('service_role','private.reservation_lifecycle_head_authoritative_kernel(uuid,uuid)','execute'),'private validators and lifecycle kernel remain inaccessible to adapter/browser roles');
create temporary table timestamp_examples(id text,input text,expected boolean) on commit drop;
insert into timestamp_examples values
('utc_seconds','2026-01-13T12:00:00Z',true),
('utc_millis','2026-01-13T12:00:00.123Z',true),
('microseconds','2026-01-13T12:00:00.123456Z',true),
('west_offset','2026-01-13T12:00:00-05:00',true),
('fractional_zone','2026-01-13T12:00:00+05:45',true),
('east_limit','2026-01-13T12:00:00+15:59',true),
('west_limit','2026-01-13T12:00:00-15:59',true),
('leap_2024','2024-02-29T23:59:59Z',true),
('leap_2000','2000-02-29T00:00:00Z',true),
('year_one','0001-01-01T00:00:00Z',true),
('year_last','9999-12-31T23:59:59Z',true),
('locale_mdy','01/13/2026 12:00Z',false),
('locale_dmy','13/01/2026 12:00Z',false),
('locale_ambiguous','01/02/2026 12:00Z',false),
('named_month','Jan 13 2026 12:00Z',false),
('space_separator','2026-01-13 12:00:00Z',false),
('feb_thirty','2026-02-30T12:00:00Z',false),
('not_leap','2026-02-29T12:00:00Z',false),
('century_not_leap','2100-02-29T12:00:00Z',false),
('april_thirty_one','2026-04-31T12:00:00Z',false),
('month_zero','2026-00-13T12:00:00Z',false),
('month_thirteen','2026-13-13T12:00:00Z',false),
('day_zero','2026-01-00T12:00:00Z',false),
('hour_twenty_four','2026-01-13T24:00:00Z',false),
('minute_sixty','2026-01-13T12:60:00Z',false),
('leap_second_unsupported','2026-01-13T12:00:60Z',false),
('offset_sixteen','2026-01-13T12:00:00+16:00',false),
('offset_minutes','2026-01-13T12:00:00+05:60',false),
('compact_offset','2026-01-13T12:00:00-0500',false),
('no_zone','2026-01-13T12:00:00',false),
('no_seconds','2026-01-13T12:00Z',false),
('date_only','2026-01-13',false),
('year_zero','0000-01-13T12:00:00Z',false),
('seven_fraction_digits','2026-01-13T12:00:00.1234567Z',false),
('leading_whitespace',' 2026-01-13T12:00:00Z',false),
('trailing_whitespace','2026-01-13T12:00:00Z ',false),
('empty','',false),
('null',null,false),
('trailing_lf',E'2026-01-13T12:00:00Z\n',false),
('trailing_cr',E'2026-01-13T12:00:00Z\r',false),
('trailing_crlf',E'2026-01-13T12:00:00Z\r\n',false),
('trailing_unicode_separator',U&'2026-01-13T12:00:00Z\2028',false);
create temporary table context_results(style text,zone text,result jsonb,expected jsonb) on commit drop;
do $matrix$
declare style text;zone text;base jsonb;wanted jsonb;observed jsonb;
begin
 select private.startup_workspace_migrate_v1(data) into base from public.startup_workspaces where id='le-yard-opening';
 wanted:=jsonb_build_object('timestamps',(select jsonb_agg(expected order by id) from timestamp_examples),'filtered','{"keep":[{"value":7}]}'::jsonb,'checklist',true,'invalidChecklist',false,'validLeap',true,'invalidLeap',false,'migrated',base);
 foreach style in array array['ISO, MDY','ISO, DMY','SQL, DMY'] loop
  perform set_config('DateStyle',style,true);
  foreach zone in array array['UTC','America/New_York','Asia/Kathmandu'] loop
   perform set_config('TimeZone',zone,true);
   observed:=jsonb_build_object('timestamps',(select jsonb_agg(private.startup_timestamp_is_valid(input) order by id) from timestamp_examples),'filtered',public.report_filters_without_scope('{"LocationID":"discard","keep":[{"TENANT_ID":"discard","value":7}]}'::jsonb),'checklist',private.checklist_authoring_items_are_valid('[{"label":"Check","response_type":"checkbox","required":true,"validation":{}}]'::jsonb),'invalidChecklist',private.checklist_authoring_items_are_valid('[{"label":"Check","unknown":1}]'::jsonb),'validLeap',private.startup_iso_date_is_valid('2024-02-29'),'invalidLeap',private.startup_iso_date_is_valid('2100-02-29'),'migrated',(select private.startup_workspace_migrate_v1(data) from public.startup_workspaces where id='le-yard-opening'));
   insert into context_results values(style,zone,observed,wanted);
  end loop;
 end loop;
end $matrix$;
select is(result::text,expected::text,'timestamp corpus and bounded helpers: '||style||' / '||zone) from context_results order by style,zone;
set local DateStyle='ISO, MDY';set local TimeZone='UTC';
prepare strict_timestamp_cached_plan as select is(private.startup_timestamp_is_valid('01/13/2026 12:00Z'),false,'prepared locale timestamp stays rejected');
execute strict_timestamp_cached_plan;
set local DateStyle='ISO, DMY';execute strict_timestamp_cached_plan;deallocate strict_timestamp_cached_plan;
select is(private.startup_workspace_v3_violations('{"version":0}'::jsonb,'20000000-0000-4000-8000-000000000001'::uuid),array['schema_version'],'Opening Room typed literal initialization remains executable');
create temporary table marker_identity as select gen_random_uuid() target,gen_random_uuid() fixture,(select max(version) from supabase_migrations.schema_migrations) head;
insert into private.connected_acceptance_targets(target_id,environment,schema_version,fixture_id,fixture_revision,expires_at,created_by)
 select target,'nonproduction_preview',head,fixture,'readiness-sql-warning-test',clock_timestamp()+interval '400 milliseconds','READINESS ONLY — native rollback expiry' from marker_identity;
create temporary table marker_expiry as select n,(select count(*)::integer from public.service_connected_acceptance_marker(case when n>0 then ids.target else null end,ids.head,ids.fixture,'readiness-sql-warning-test')) active,(pg_sleep(0.25) is null) as waited from generate_series(1,3)n cross join marker_identity ids;
select is((select array_agg(active order by n)::text from marker_expiry),'{1,1,0}','clock expiry remains current within one outer statement');
select * from finish();rollback;
