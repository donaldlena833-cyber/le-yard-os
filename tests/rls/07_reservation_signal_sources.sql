begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(12);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',true);
select is((select array_agg(c.relname::text order by c.relname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgfoid='public.broadcast_reservation_change()'::regprocedure and not t.tgisinternal),array['reservation_table_allocations','reservations','table_status_events','waitlist_entries']::text[],'the reviewed producer serves exactly four existing operating tables');
create function pg_temp.signal_revision() returns bigint language sql as $fn$
 select coalesce((select revision from public.reservation_invalidation_signals where location_id='30000000-0000-4000-8000-000000000001'),0)
$fn$;
create temporary table previous_signal as select pg_temp.signal_revision() revision;
insert into public.reservation_service_periods(organization_id,location_id,name,days_of_week,starts_local,ends_local,default_duration_minutes,pacing_interval_minutes,pacing_cover_limit,min_party_size,max_party_size,effective_from,effective_to,approved_at,approved_by)
values('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Native signal source fixture',array[0,1,2,3,4,5,6],'11:00','15:00',90,15,10,1,6,'2035-01-08','2035-01-08',now(),'10000000-0000-4000-8000-000000000001');
select public.save_reservation('a4800000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',null,null,'2035-01-08T17:00Z',90,2,null,'manual',array[]::uuid[]);
select is(pg_temp.signal_revision(),(select revision+1 from previous_signal),'actual staff reservation command advances its safe signal');
update previous_signal set revision=pg_temp.signal_revision();
insert into public.reservation_tables(id,organization_id,location_id,label,max_capacity,position_x,position_y,width,height,approved_at,approved_by)
values('a4800000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Native signal-only table',2,0.1,0.1,0.1,0.1,now(),'10000000-0000-4000-8000-000000000001');
insert into public.reservation_table_allocations(id,organization_id,location_id,table_id,allocation_kind,starts_at,ends_at) values('a4800000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','a4800000-0000-4000-8000-000000000002','block','2035-01-08T20:00Z','2035-01-08T21:00Z');
select is(pg_temp.signal_revision(),(select revision+1 from previous_signal),'allocation insert advances the same scoped signal');
update previous_signal set revision=pg_temp.signal_revision();
update public.reservation_table_allocations set is_active=false,released_at=now() where id='a4800000-0000-4000-8000-000000000003';
select is(pg_temp.signal_revision(),(select revision+1 from previous_signal),'allocation update advances the same scoped signal');
update previous_signal set revision=pg_temp.signal_revision();
delete from public.reservation_table_allocations where id='a4800000-0000-4000-8000-000000000003';
select is(pg_temp.signal_revision(),(select revision+1 from previous_signal),'allocation delete advances the same scoped signal');
update previous_signal set revision=pg_temp.signal_revision();
insert into public.waitlist_entries(id,organization_id,location_id,display_name,party_size) values('a4800000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Native signal fixture',2);
select is(pg_temp.signal_revision(),(select revision+1 from previous_signal),'waitlist insert advances the same scoped signal');
update previous_signal set revision=pg_temp.signal_revision();
update public.waitlist_entries set status='cancelled' where id='a4800000-0000-4000-8000-000000000004';
select is(pg_temp.signal_revision(),(select revision+1 from previous_signal),'waitlist update advances the same scoped signal');
update previous_signal set revision=pg_temp.signal_revision();
delete from public.waitlist_entries where id='a4800000-0000-4000-8000-000000000004';
select is(pg_temp.signal_revision(),(select revision+1 from previous_signal),'waitlist delete advances the same scoped signal');
update previous_signal set revision=pg_temp.signal_revision();
insert into public.table_status_events(organization_id,location_id,table_id,status,note) values('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','a4800000-0000-4000-8000-000000000002','available','Native signal fixture');
select is(pg_temp.signal_revision(),(select revision+1 from previous_signal),'table-status insert advances the same scoped signal');
update previous_signal set revision=pg_temp.signal_revision();
select throws_ok($q$update public.table_status_events set note='Native signal update' where table_id='a4800000-0000-4000-8000-000000000002'$q$,'42501','table_status_events is append-only','table-status updates remain refused before signal generation');
select throws_ok($q$delete from public.table_status_events where table_id='a4800000-0000-4000-8000-000000000002'$q$,'42501','table_status_events is append-only','table-status deletes remain refused before signal generation');
select is(pg_temp.signal_revision(),(select revision from previous_signal),'refused append-only edits do not forge a new revision');
select * from finish();
rollback;
