-- Deliberate application conflicts must not use the engine's serialization
-- SQLSTATE: PostgREST14 retries40001, turning stale-screen refusals into loops.
-- Only the reviewed70 bodies /87 explicit raises are changed. Pinning source
-- hashes makes this forward migration fail closed on unexpected body drift.
-- CREATE OR REPLACE preserves identities, owners and ACLs. Real engine-generated
-- serialization failures remain40001. No browser grant or scope rule is added.
begin;
set local search_path = pg_catalog;

do $business_conflicts$
declare
  reviewed jsonb := $reviewed_manifest$[
  {
    "identity": "private.bind_reservation_message_delivery_evidence()",
    "source_md5": "e6487d0846e59dcdb55d5c78fa7cbdb7",
    "raises": 1
  },
  {
    "identity": "private.cancel_reservation_authoritative_kernel(uuid, uuid, uuid, integer, text)",
    "source_md5": "ff864867cf81e808406b90602e1bad39",
    "raises": 2
  },
  {
    "identity": "private.fence_reservation_message_delivery_insert()",
    "source_md5": "0829f96585581d2bda08b2a0e2cef373",
    "raises": 1
  },
  {
    "identity": "private.modify_reservation_authoritative_kernel(uuid, uuid, uuid, integer, timestamp with time zone, integer, integer, text, uuid[], text)",
    "source_md5": "58c66eac66c1a83d3dd5f0f51855c9e5",
    "raises": 2
  },
  {
    "identity": "private.resolve_location_guest_identity(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb)",
    "source_md5": "779d6b01a0ad9a847d4be47b73df74cc",
    "raises": 2
  },
  {
    "identity": "private.save_reservation_create_kernel(uuid, uuid, uuid, uuid, timestamp with time zone, integer, integer, text, text, uuid[])",
    "source_md5": "4d3626516852b6c2bcae11877832d816",
    "raises": 2
  },
  {
    "identity": "private.transition_reservation_kernel(uuid, uuid, text, text)",
    "source_md5": "61ea18f9f3f525f1fdeb2b4a36f2bc2b",
    "raises": 1
  },
  {
    "identity": "public.acknowledge_sop(uuid, uuid)",
    "source_md5": "eb571385c491bcaafdb77c758d77f043",
    "raises": 3
  },
  {
    "identity": "public.add_guest_note(uuid, uuid, uuid, text, boolean)",
    "source_md5": "9db4b45469e3673223a2bb7fca0dc05f",
    "raises": 1
  },
  {
    "identity": "public.approve_inventory_count(uuid, uuid, boolean, text)",
    "source_md5": "622710f05084fbc7eac039702cc8387c",
    "raises": 2
  },
  {
    "identity": "public.assign_guest_tag(uuid, uuid, uuid)",
    "source_md5": "7a2716d7a308028a8cfc4ba7a51cd504",
    "raises": 1
  },
  {
    "identity": "public.assign_reservation_tables(uuid, uuid, uuid[], text)",
    "source_md5": "a6d72a1a5a423274c930de8d745afd0d",
    "raises": 1
  },
  {
    "identity": "public.begin_owner_intelligence_run(uuid, uuid, text, jsonb)",
    "source_md5": "78816f8cfcf11ca53a89297ab997054a",
    "raises": 1
  },
  {
    "identity": "public.bind_verified_checklist_photo_response_aal2_legacy(uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint)",
    "source_md5": "77ec3ab716269d8b0f3ebbabcf2816e8",
    "raises": 1
  },
  {
    "identity": "public.calculate_tip_run(uuid)",
    "source_md5": "e1d486674b7ccfd051b9f28a45c7b763",
    "raises": 1
  },
  {
    "identity": "public.claim_open_shift(uuid, uuid)",
    "source_md5": "c286759ec67ca18d9384b6104d463b29",
    "raises": 1
  },
  {
    "identity": "public.complete_owner_intelligence_run(uuid, uuid, jsonb, numeric, jsonb, jsonb)",
    "source_md5": "1553f32b6b2533f456f936b591fbe20e",
    "raises": 1
  },
  {
    "identity": "public.complete_prep_task(uuid, uuid, integer, numeric, boolean, text)",
    "source_md5": "5da0c9f3a98588339b64a559dd14f823",
    "raises": 1
  },
  {
    "identity": "public.configure_service_shift_exception(uuid, uuid, uuid, uuid, text, timestamp with time zone, timestamp with time zone, integer, integer, integer, integer, text, boolean)",
    "source_md5": "27e33b74a57f7f8cfd681cd163462d49",
    "raises": 1
  },
  {
    "identity": "public.correct_prep_completion(uuid, uuid, integer, text)",
    "source_md5": "37cb1e053a7a7fa90d0ec40bc558a86e",
    "raises": 1
  },
  {
    "identity": "public.correct_reservation_status(uuid, uuid, uuid, integer, text)",
    "source_md5": "9de825d3879210fbddda2f08f0135529",
    "raises": 2
  },
  {
    "identity": "public.create_chat_channel(uuid, uuid, public.channel_kind, uuid, text, text, uuid[])",
    "source_md5": "ccf0f058250a2cb9095991f014afa9a7",
    "raises": 1
  },
  {
    "identity": "public.create_checklist_template_version(uuid, uuid, text, text, jsonb)",
    "source_md5": "3e2a4ee379ccd3e48410d31b0b0566df",
    "raises": 2
  },
  {
    "identity": "public.create_employee_job_assignment(uuid, uuid, uuid, uuid, integer, date, date, boolean)",
    "source_md5": "6f62e72e4f0398d8f6c7b86d75697da8",
    "raises": 1
  },
  {
    "identity": "public.create_incident(uuid, uuid, text, text, text, timestamp with time zone, uuid[], uuid)",
    "source_md5": "4504545e318e3615619be134e51533ac",
    "raises": 1
  },
  {
    "identity": "public.create_inventory_transfer(uuid, uuid, uuid, text, jsonb)",
    "source_md5": "7b1ba33da3228af5243dfd3dea78257d",
    "raises": 1
  },
  {
    "identity": "public.create_job_role_definition(uuid, uuid, text, text, text, text, numeric, boolean)",
    "source_md5": "3ac81a3f5407cb5dcf3c1c70ee779400",
    "raises": 1
  },
  {
    "identity": "public.create_maintenance_request(uuid, uuid, text, text, text, text, text, uuid, timestamp with time zone)",
    "source_md5": "53a674364ca5a0328c38861eb042657e",
    "raises": 1
  },
  {
    "identity": "public.create_manual_csv_import(uuid, uuid, text, text, text, text, integer, text[], jsonb)",
    "source_md5": "9940ac077b7c33a7fc19e474fccc4d11",
    "raises": 1
  },
  {
    "identity": "public.create_purchase_order(uuid, uuid, uuid, text, date, date, bigint, bigint, text, jsonb)",
    "source_md5": "aa23d2665b86a7849e7a3946a2bae6ef",
    "raises": 1
  },
  {
    "identity": "public.create_sop_draft(uuid, uuid, text, text, boolean, text, text)",
    "source_md5": "cb10bc77d54fa5debbd87ae9ad837de0",
    "raises": 1
  },
  {
    "identity": "public.create_sop_version(uuid, uuid, text, text)",
    "source_md5": "d517747848e4dacbcd7ba1ef48099eaf",
    "raises": 2
  },
  {
    "identity": "public.create_task(uuid, uuid, text, text, text, uuid, timestamp with time zone)",
    "source_md5": "5997b99e4cccb9cd5872f2ffdf6dc51e",
    "raises": 1
  },
  {
    "identity": "public.execute_owner_intelligence_task_proposal(uuid, uuid, text)",
    "source_md5": "0432ad1daf58484f7e756b889b4702cc",
    "raises": 2
  },
  {
    "identity": "public.finalize_employee_document(uuid, uuid, uuid, text, text, text, text, bigint, boolean)",
    "source_md5": "77bf50bf678c514026c5f8d66d01c84f",
    "raises": 1
  },
  {
    "identity": "public.ingest_income_sales_check(uuid, uuid, text, text, text, timestamp with time zone, timestamp with time zone, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, integer, text, timestamp with time zone, text)",
    "source_md5": "e4aa361cc7c118a63bc3c71143cc7342",
    "raises": 1
  },
  {
    "identity": "public.manage_location_release_control(uuid, uuid, uuid, bigint, text, date, integer, boolean, boolean)",
    "source_md5": "d9a068c7036adf953cfda713f337d003",
    "raises": 1
  },
  {
    "identity": "public.merge_guests(uuid, uuid, uuid, numeric, jsonb)",
    "source_md5": "a9b7fd5bf363599ad3e1a570c962dcf8",
    "raises": 2
  },
  {
    "identity": "public.prepare_tip_run_from_closeout(uuid, uuid, uuid)",
    "source_md5": "ed2867004dacb97f1182c51806aae91f",
    "raises": 2
  },
  {
    "identity": "public.receive_inventory_delivery(uuid, uuid, uuid, uuid, timestamp with time zone, text, text, jsonb)",
    "source_md5": "5bff4640613d64f5eaf23a4c3b01a0d9",
    "raises": 1
  },
  {
    "identity": "public.record_checklist_response(uuid, uuid, uuid, jsonb, text, text)",
    "source_md5": "79abd1a95c56a81dcdb163cdde5180b5",
    "raises": 1
  },
  {
    "identity": "public.record_guest_consent(uuid, uuid, text, public.consent_status, text)",
    "source_md5": "6dd2cf2dce9f6eb82ba447f9f02e4187",
    "raises": 1
  },
  {
    "identity": "public.reopen_shift(uuid, uuid)",
    "source_md5": "6ee8d42e6d90d15f62a9b758a9482e00",
    "raises": 1
  },
  {
    "identity": "public.retry_integration_sync_job(uuid, uuid)",
    "source_md5": "9ff5a46974c6f5d48d3913809846dfb9",
    "raises": 1
  },
  {
    "identity": "public.review_delivery_receiving_exceptions(uuid, uuid, uuid, boolean, text)",
    "source_md5": "034f25cff8607038b8d88732ad7f7fe0",
    "raises": 1
  },
  {
    "identity": "public.review_inventory_transfer(uuid, uuid, boolean, text, jsonb)",
    "source_md5": "153c1020b803da6fe3d6fc58b46ae606",
    "raises": 1
  },
  {
    "identity": "public.review_time_entry(uuid, uuid, boolean, text)",
    "source_md5": "bb323c20c08ec7f3a48c54d2384bbb19",
    "raises": 1
  },
  {
    "identity": "public.review_waste_record(uuid, uuid, boolean, text)",
    "source_md5": "5338e9002119f5c38d298e957488a289",
    "raises": 1
  },
  {
    "identity": "public.revoke_service_shift_exception(uuid, uuid, text)",
    "source_md5": "28754f8a930534dbdcfed1998c6b04fb",
    "raises": 1
  },
  {
    "identity": "public.save_availability_rule(uuid, uuid, uuid, uuid, smallint, time without time zone, time without time zone, boolean, date, date, text)",
    "source_md5": "7d6b47fd8e6b81fea4687ef81432997d",
    "raises": 1
  },
  {
    "identity": "public.save_employee_certification(uuid, uuid, uuid, text, text, text, date, date, boolean)",
    "source_md5": "bb3aba6ddd5ac3265ebd5b660ca3f193",
    "raises": 1
  },
  {
    "identity": "public.save_employee_emergency_contact(uuid, uuid, uuid, text, text, text, text, boolean)",
    "source_md5": "0ce0f0107d766278b53531655d3719cf",
    "raises": 1
  },
  {
    "identity": "public.save_expense_category(uuid, uuid, uuid, text, text)",
    "source_md5": "0503d8f51d9c4143fb1dc4c0c23751f1",
    "raises": 1
  },
  {
    "identity": "public.save_guest(uuid, uuid, uuid, text, text, text, text, text, date, boolean, text, text, text)",
    "source_md5": "d241e9d01e19e1755ae2cc0ffb1c57db",
    "raises": 1
  },
  {
    "identity": "public.save_guest_contact(uuid, uuid, uuid, text, text, text, boolean)",
    "source_md5": "77ee1849744be539f49099d465fd098a",
    "raises": 1
  },
  {
    "identity": "public.save_prep_task(uuid, uuid, uuid, date, text, text, uuid, uuid, numeric, uuid, timestamp with time zone, uuid, text, integer)",
    "source_md5": "7b7ab2268701e46db223c9a3e01b378b",
    "raises": 2
  },
  {
    "identity": "public.save_push_subscription(uuid, uuid, text, bytea, text)",
    "source_md5": "51bc1e3b1db0f61c08ca9d22de5ee1f0",
    "raises": 1
  },
  {
    "identity": "public.save_reservation_floor_positions(uuid, uuid, jsonb)",
    "source_md5": "8673745f799dd461605d3191b536750e",
    "raises": 1
  },
  {
    "identity": "public.save_reservation_with_guest(uuid, uuid, text, text, text, timestamp with time zone, integer, integer, text, text, uuid[])",
    "source_md5": "07e880a41fedc9609f500968ebd774e7",
    "raises": 2
  },
  {
    "identity": "public.save_startup_workspace(text, bigint, jsonb)",
    "source_md5": "8c6a2b2ff0362442c3b99e9260e8ebd1",
    "raises": 1
  },
  {
    "identity": "public.save_time_off_request(uuid, uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, text)",
    "source_md5": "d7dd69a06cac5a7824eec1028a8bcb6d",
    "raises": 1
  },
  {
    "identity": "public.seat_waitlist_entry(uuid, uuid, uuid[], integer)",
    "source_md5": "7f93631909dfbe7e84d2184aa86081c7",
    "raises": 1
  },
  {
    "identity": "public.service_ingest_pos_time_entry(uuid, uuid, uuid, text, timestamp with time zone, text, uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, boolean, timestamp with time zone, jsonb)",
    "source_md5": "3128be0e0a3c10922a645f6e30c37af3",
    "raises": 1
  },
  {
    "identity": "public.service_modify_public_reservation(uuid, uuid, uuid, text, timestamp with time zone, integer, integer, text, uuid[])",
    "source_md5": "9860b4c3beea3da8c5d381f04ae24879",
    "raises": 1
  },
  {
    "identity": "public.service_save_guest(uuid, uuid, uuid, uuid, text, text, text, text, text, date, boolean, text, text, text)",
    "source_md5": "b453295ec7bf35f921af9ddfa75bc594",
    "raises": 2
  },
  {
    "identity": "public.set_notification_preference(uuid, uuid, text, boolean, boolean, boolean, jsonb)",
    "source_md5": "ee3f4382db141372f4f062ced21190d3",
    "raises": 1
  },
  {
    "identity": "public.start_checklist_run(uuid, uuid, uuid, date, uuid)",
    "source_md5": "e945352e9a63b231b3efa03a80454a30",
    "raises": 2
  },
  {
    "identity": "public.submit_waste_record(uuid, uuid, uuid, uuid, numeric, text, timestamp with time zone, text)",
    "source_md5": "f6240bc6e6675fb253e1195940e2dab4",
    "raises": 1
  },
  {
    "identity": "public.transition_prep_task(uuid, uuid, integer, text)",
    "source_md5": "4bf81ea7b171d811ca3053b71f746db4",
    "raises": 1
  },
  {
    "identity": "public.undo_owner_intelligence_task_proposal(uuid, uuid, text)",
    "source_md5": "16244fc0cd8f20e34a5630924555d45d",
    "raises": 1
  }
]$reviewed_manifest$::jsonb;
  target record;
  target_oid oid;
  original_source text;
  definition text;
  expected_source text;
  actual_source text;
  assigned_codes integer;
  changed_functions integer := 0;
  changed_raises integer := 0;
  code_pattern constant text := $code_pattern$errcode\s*=\s*'40001'$code_pattern$;
begin
  if jsonb_array_length(reviewed) <> 70 then
    raise exception 'The reviewed business-conflict inventory is incomplete';
  end if;
  if exists (
    select 1 from pg_proc fn join pg_namespace ns on ns.oid=fn.pronamespace
    where ns.nspname in ('public','private') and fn.prokind='f'
      and fn.prosrc like '%40001%'
      and not exists (
        select 1 from jsonb_to_recordset(reviewed)
          as expected(identity text,source_md5 text,raises integer)
        where to_regprocedure(expected.identity)::oid=fn.oid
      )
  ) then
    raise exception 'An unreviewed40001 function requires classification first';
  end if;
  for target in select * from jsonb_to_recordset(reviewed)
    as item(identity text,source_md5 text,raises integer)
  loop
    target_oid := to_regprocedure(target.identity)::oid;
    if target_oid is null then
      raise exception 'Reviewed business-conflict function is missing: %',target.identity;
    end if;
    select fn.prosrc,pg_get_functiondef(fn.oid) into original_source,definition
    from pg_proc fn where fn.oid=target_oid and fn.prokind='f';
    if md5(original_source) is distinct from target.source_md5 then
      raise exception 'Reviewed business-conflict body drifted: %',target.identity;
    end if;
    select count(*)::integer into assigned_codes
    from regexp_matches(original_source,code_pattern,'g');
    if assigned_codes <> target.raises or assigned_codes < 1 then
      raise exception 'Reviewed business-conflict clause count changed: %',target.identity;
    end if;
    expected_source := regexp_replace(original_source,code_pattern,'errcode = ''PT409''','g');
    execute regexp_replace(definition,code_pattern,'errcode = ''PT409''','g');
    select fn.prosrc into actual_source from pg_proc fn where fn.oid=target_oid;
    if actual_source is distinct from expected_source then
      raise exception 'Business-conflict replacement changed unexpected body text: %',target.identity;
    end if;
    changed_functions := changed_functions+1;
    changed_raises := changed_raises+assigned_codes;
  end loop;
  if changed_functions<>70 or changed_raises<>87 then
    raise exception 'Business-conflict replacement did not cover the reviewed inventory';
  end if;
  if exists (
    select 1 from pg_proc fn join pg_namespace ns on ns.oid=fn.pronamespace
    where ns.nspname in ('public','private') and fn.prokind='f'
      and fn.prosrc ~ code_pattern
  ) then
    raise exception 'An explicit business-conflict40001 raise remains';
  end if;
end
$business_conflicts$;

update private.runtime_schema_contract_expected expected
set migration_head='20261024174204',table_fingerprint=snapshot.value->>'tableFingerprint',
 function_fingerprint=snapshot.value->>'functionFingerprint',access_fingerprint=snapshot.value->>'accessFingerprint',captured_at=clock_timestamp()
from(select private.compute_runtime_schema_fingerprints() as value)snapshot
where expected.contract_version='runtime-schema-v2';
commit;
