import {test,afterAll} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import{randomUUID,createHash}from'node:crypto';
import{createClient}from'@supabase/supabase-js';
import pg from'pg';
import{requireAuthenticatedActor}from'@/data/actor';
import{configureInventoryCatalog,receiveInventoryDelivery,reviewDeliveryExceptions,submitWasteRecord,reviewWasteRecord,submitInventoryCount,approveInventoryCount}from'@/data/workflows/inventory';
import{createTask,transitionTask,createChecklistTemplateVersion,publishChecklistTemplate,startChecklistRun,recordChecklistResponse,completeChecklistRun}from'@/data/workflows/operations';
import{savePrepTask,transitionPrepTask,previewPrepCompletion,completePrepTask}from'@/data/workflows/prep';
import{savePreshift,acknowledgePreshift,recordServiceAvailability}from'@/data/workflows/service-control';
import{submitCloseout,approveCloseout}from'@/data/workflows/closeout';
import{configureTipPolicy,saveTipPolicyDraft,approveTipPolicyVersion}from'@/data/workflows/financial-configuration';
import{prepareTipRun,calculateTipRun,approveTipRun,exportTipPayroll}from'@/data/workflows/tips';
import{createEmployeeJobAssignment}from'@/data/workflows/people-configuration';
import{recordMissedTimeEntry}from'@/data/workflows/time';
import{isIsoCalendarDate,zonedLocalToIso}from'@/data/read-models/local-time';
import{buildConnectedServiceDayScorecard}from'../../scripts/service-day-v2-scorecard.mjs';
const required=k=>{if(!process.env[k])throw Error('Explicit '+k+' required');return process.env[k];};
const f=JSON.parse(readFileSync(required('LOCAL_READINESS_FIXTURE_PATH'))),s=JSON.parse(readFileSync(required('LOCAL_READINESS_STATUS_PATH'))),output=required('LOCAL_READINESS_EVIDENCE_PATH'),day=required('LOCAL_READINESS_SERVICE_DATE');
const planPath=new URL('./fixtures/service-day-v2.json',import.meta.url),plan=JSON.parse(readFileSync(planPath));
if(f.classification!==plan.classification||f.api!=='http://127.0.0.1:55421'||s.API_URL!==f.api)throw Error('Non-synthetic/nonlocal target refused');
const uri=new URL(s.DB_URL);if(uri.hostname!=='127.0.0.1'||uri.port!=='55422'||uri.pathname!=='/postgres')throw Error('Unsafe database');
const runId=randomUUID(),prefix='READINESS V2 '+runId.slice(0,8),db=new pg.Client({connectionString:s.DB_URL}),ctx={},checks=[],phases=[],issues=[],commands=[];
const scopeGaps=['Staffed physical-room/device acceptance','Approved restaurant safety, labor, cash and staff-exception procedures','POS-authoritative checks/tenders/consumption and actual provider acceptance','Physical food preparation/counting and actual elapsed turns/reset times','Call-out replacement qualifications/employee acceptance beyond the task handoff','Managed database/private-file recovery'];
const state={};
const assert=(v,m)=>{if(!v)throw Error(m);};
function check(id,passed,observed){checks.push({id,passed,observed});}
async function observed(label,role,body){const startedAt=new Date().toISOString(),began=performance.now();try{const result=await body();commands.push({label,role,startedAt,endedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-began),outcome:'returned'});return result;}catch(e){commands.push({label,role,startedAt,endedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-began),outcome:'refused_or_failed',code:e.code??null});throw e;}}
async function rpc(role,name,args){return observed(name,role,async()=>{const x=await ctx[role].supabase.rpc(name,args);if(x.error)throw x.error;return x.data;});}
const refusalCodes={'receiver-self-review-refused':'42501','missing-opening-response-refused':'23514','no-41st-concurrent-cover':'23P01','stale-availability-refused':'PT409','waste-self-review-refused':'42501','count-self-review-refused':'42501','closeout-self-approval-refused':'42501'};
async function refuse(id,role,name,args){const expectedCode=refusalCodes[id];assert(expectedCode,'An explicit expected SQLSTATE is required');const r=await observed(name+' refusal probe',role,()=>ctx[role].supabase.rpc(name,args));check(id,r.error?.code===expectedCode,{expectedCode,errorCode:r.error?.code??null,message:r.error?.message??null,httpStatus:r.status});}
async function phase(id,body,deps=[]){const startedAt=new Date().toISOString();if(deps.some(dep=>!phases.some(p=>p.id===dep&&p.status==='completed'))){phases.push({id,status:'blocked_by_prior_phase',dependencies:deps});return;}const start=checks.length;try{await body();phases.push({id,status:checks.slice(start).some(x=>!x.passed)?'failed_checks':'completed',checkIds:checks.slice(start).map(c=>c.id),startedAt,endedAt:new Date().toISOString()});}catch(e){phases.push({id,status:'interrupted',startedAt,endedAt:new Date().toISOString(),code:e.code??null,message:e.message});}}
async function onHand(item){return Number((await db.query('select coalesce(sum(quantity_delta),0) q from public.inventory_transactions where location_id=$1 and inventory_item_id=$2',[f.location,item])).rows[0].q);}
const at=time=>{const x=zonedLocalToIso(day,time,'America/New_York');assert(x,'Invalid local time');return x;};
async function tableState(){return(await db.query("select distinct on(t.id)t.id,t.label,t.max_capacity,e.status from public.reservation_tables t left join public.table_status_events e on e.table_id=t.id where t.location_id=$1 and t.is_active order by t.id,e.occurred_at desc,e.id desc",[f.location])).rows;}
async function reset(table){await rpc('Host','set_reservation_table_status',{p_request_id:randomUUID(),p_table_id:table,p_status:'available',p_note:prefix+' synthetic reset; no physical inspection',p_reservation_id:null});}
async function move(id,status){return rpc('Host','transition_reservation',{p_request_id:randomUUID(),p_reservation_id:id,p_target_status:status,p_note:prefix+' compressed command, not elapsed service'});}
async function seat(reservation){await move(reservation.id,'arrived');await move(reservation.id,'seated');}
async function finish(reservation){await move(reservation.id,'completed');await reset(reservation.tableId);}
async function book(meal){const rows=[];for(let wave=0;wave<meal.waves.length;wave++)for(let i=0;i<meal.partiesPerWave;i++){const index=wave*meal.partiesPerWave+i,table=state.tables[(index)%20];const args={p_request_id:randomUUID(),p_location_id:f.location,p_display_name:prefix+' '+(meal===plan.lunch?'lunch':'dinner')+' '+index,p_email:null,p_phone:null,p_reserved_at:at(meal.waves[wave]),p_duration_minutes:plan.turnMinutes,p_party_size:2,p_special_requests:prefix+' no guest contact',p_source:'manual',p_table_ids:[table.id]};const saved=await rpc('Host','save_reservation_with_guest',args);rows.push({...saved,tableId:table.id,args});}return rows;}
async function brief(period,covers){const args={requestId:randomUUID(),locationId:f.location,businessDate:day,servicePeriod:period,status:'published',bookedCovers:covers,projectedCovers:covers,allergyNotes:prefix+' synthetic allergy: chef/guest verification still required',specials:prefix+' recipe batch',staffingNotes:'Synthetic staffing only',serviceGoal:'Keep unresolved work owned',managerNotes:prefix+' private manager note'};const saved=await observed('savePreshift','Owner',()=>savePreshift(ctx.Owner,args));for(const role of['Host','Chef','Employee'])await observed('acknowledgePreshift',role,()=>acknowledgePreshift(ctx[role],{requestId:randomUUID(),preshiftId:saved.id,comment:prefix+' read this exact version'}));const n=(await db.query('select count(*)::int n from public.preshift_acknowledgements where preshift_id=$1',[saved.id])).rows[0].n;check(period+'-brief-principals',n===3,{preshiftId:saved.id,version:saved.version_number,acknowledgements:n});return saved;}

afterAll(async()=>{
  const scorecard=buildConnectedServiceDayScorecard({requiredPhases:plan.requiredPhases,phases,checks,issues,scopeGaps});
  writeFileSync(output,JSON.stringify({at:new Date().toISOString(),runId,scenario:plan.id,classification:plan.classification,businessDate:day,sourcePlanSha256:createHash('sha256').update(readFileSync(planPath)).digest('hex'),recordIds:{locationId:f.location,deliveryId:state.delivery?.id,ingredientId:state.raw?.id,outputId:state.output,recipeId:state.recipe,prepId:state.prep?.id,creditTaskId:state.creditTask?.id,closeoutId:state.closeout?.id,tipRunId:state.tipRun?.id,lunchReservations:state.lunch?.map(r=>r.id),dinnerReservations:state.dinner?.map(r=>r.id),noShowId:state.noShowId},execution:'Actual local Auth/application workflow and database commands; no provider/physical action; synthetic past service date with real current write timestamps',phases,checks,issues,commands,scopeGaps,scorecard,summary:{passed:checks.filter(x=>x.passed).length,total:checks.length,completedPhases:phases.filter(p=>p.status==='completed').length,requiredPhases:plan.requiredPhases.length}},null,2)+'\n');
  await db.end();
});

test('connected current-floor service day records actual cross-domain outcomes',async()=>{
  await db.connect();
  for(const role of['Owner','Owner2','Manager','Host','Chef','Employee']){
    const c=createClient(f.api,s.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),a=await c.auth.signInWithPassword({email:f.users[role].email,password:f.users[role].password});if(a.error)throw a.error;
    ctx[role]={supabase:c,actor:await requireAuthenticatedActor(c)};
  }
  await phase('preflight',async()=>{
    assert(isIsoCalendarDate(day),'Explicit ISO calendar service date required');
    const fixtureClock=(await db.query("select (clock_timestamp() at time zone 'America/New_York')::date::text d, ((clock_timestamp()+interval '1 day') at time zone 'America/New_York')::date::text due_day")).rows[0],date=fixtureClock.d;assert(day<date,'Use a past date for coherent manual labor/closeout vectors');
    const existing=(await db.query("select (select count(*)::int from public.reservations where location_id=$1 and (reserved_at at time zone 'America/New_York')::date=$2) reservations,(select count(*)::int from public.shift_closeouts where location_id=$1 and business_date=$2) closeouts,(select count(*)::int from public.time_entries where location_id=$1 and (clocked_in_at at time zone 'America/New_York')::date=$2) labor",[f.location,day])).rows[0];assert(!existing.reservations&&!existing.closeouts&&!existing.labor,'Rehearsal date already has records; retain history and use a clean date');
    state.tables=(await tableState()).sort((a,b)=>a.label.localeCompare(b.label));
    const floor=JSON.parse(readFileSync(new URL('../../src/lib/reservations/dd08-floor.json',import.meta.url)));
    assert(state.tables.every(t=>!t.status||t.status==='available'),'Unrelated physical floor work is still active; do not clear it automatically');
    check('DD08-floor',floor.revision===plan.floorRevision&&state.tables.length===plan.tables&&state.tables.reduce((n,t)=>n+t.max_capacity,0)===plan.seats&&state.tables.map(t=>t.label).sort().join()===floor.tables.map(t=>t.label).sort().join(),{tables:state.tables.length,seats:state.tables.reduce((n,t)=>n+t.max_capacity,0),revision:floor.revision});
    state.raw=(await db.query('select id,base_unit_id from public.inventory_items where organization_id=$1 and name=$2 and is_active and track_inventory order by id limit 1',[f.org,'Demo Tomatoes'])).rows[0];assert(state.raw,'Synthetic ingredient missing');state.rawBefore=await onHand(state.raw.id);
    state.employees=(await db.query('select id,user_id from public.employees where organization_id=$1',[f.org])).rows;
    state.owner2Employee=state.employees.find(e=>e.user_id===f.users.Owner2.id);assert(state.owner2Employee,'Second owner employee fixture missing');
    state.roles=(await db.query('select id,name from public.job_roles where organization_id=$1',[f.org])).rows;
    for(const [role,jobName,from,to] of [['Employee','Server',day,day],['Host','Server',day,day],['Chef','Cook',day,day],['Owner2','Server',date,fixtureClock.due_day]]) {
      const employee=state.employees.find(e=>e.user_id===f.users[role].id),job=state.roles.find(j=>j.name===jobName);assert(employee&&job,'Qualification fixture missing');
      const existing=(await db.query('select effective_from::text,effective_to::text from public.employee_job_roles where employee_id=$1 and job_role_id=$2 and location_id=$3 and effective_from<=$5::date and (effective_to is null or effective_to>=$4::date)',[employee.id,job.id,f.location,from,to])).rows;
      // Preserve earlier fixture assignments. Fill only uncovered calendar days;
      // extending a partly covered range would correctly hit the overlap guard.
      for(let dateCursor=from;dateCursor<=to;dateCursor=new Date(Date.parse(dateCursor+'T12:00:00Z')+86400000).toISOString().slice(0,10)){
        if(existing.some(x=>x.effective_from<=dateCursor&&(!x.effective_to||x.effective_to>=dateCursor)))continue;
        const requiredDate=dateCursor;
        await observed('qualify rehearsal '+role+' '+requiredDate,'Owner',()=>createEmployeeJobAssignment(ctx.Owner,{requestId:randomUUID(),employeeId:employee.id,jobRoleId:job.id,locationId:f.location,hourlyRateCents:null,effectiveFrom:requiredDate,effectiveTo:requiredDate,isPrimary:false}));
      }
    }
    state.output=randomUUID();state.recipe=randomUUID();
    await observed('configure output item','Owner',()=>configureInventoryCatalog(ctx.Owner,{requestId:randomUUID(),workspaceLocationId:f.location,command:'item.save',id:state.output,name:prefix+' tomato component',sku:prefix.replaceAll(' ','-'),description:'Test-only output, no physical food',categoryId:null,baseUnitId:state.raw.base_unit_id,trackInventory:true,isActive:true}));
    await observed('configure recipe','Owner',()=>configureInventoryCatalog(ctx.Owner,{requestId:randomUUID(),workspaceLocationId:f.location,command:'recipe.save',id:state.recipe,name:prefix+' test batch',yieldQuantity:2,yieldUnitId:state.raw.base_unit_id,menuPriceCents:100,isActive:true,ingredients:[{inventoryItemId:state.raw.id,unitId:state.raw.base_unit_id,quantity:1,wasteFactor:0}]}));
    const priorPeriod=(await db.query("select id,starts_local,ends_local,default_duration_minutes,pacing_cover_limit from public.reservation_service_periods where location_id=$1 and effective_from=$2 and effective_to=$2 and name like 'READINESS V2% Lunch' and is_active",[f.location,day])).rows[0];
    if(priorPeriod){assert(priorPeriod.default_duration_minutes===75&&priorPeriod.pacing_cover_limit===12&&priorPeriod.starts_local==='11:30:00'&&priorPeriod.ends_local==='15:00:00','Existing rehearsal period differs');state.lunchPeriod=priorPeriod.id;}
    else {
    state.lunchPeriod=randomUUID();await db.query("insert into public.reservation_service_periods(id,organization_id,location_id,name,days_of_week,starts_local,ends_local,default_duration_minutes,pacing_interval_minutes,pacing_cover_limit,min_party_size,max_party_size,effective_from,effective_to,online_enabled,is_active) values($1,$2,$3,$4,array[0,1,2,3,4,5,6],$5,$6,75,15,12,1,10,$7,$7,false,true)",[state.lunchPeriod,f.org,f.location,prefix+' Lunch',plan.lunch.starts,plan.lunch.ends,day]);
    }
    const sourcePeriod=(await db.query("select * from public.reservation_service_periods where location_id=$1 and name='Dinner' and is_active order by effective_from desc limit 1",[f.location])).rows[0];assert(sourcePeriod,'Original synthetic DD08 Dinner period missing');
    const existingDinner=(await db.query("select id from public.reservation_service_periods where location_id=$1 and effective_from=$2 and effective_to=$2 and name like 'READINESS V2% Dinner' and is_active",[f.location,day])).rows[0];
    state.dinnerPeriod=existingDinner?.id??randomUUID();
    if(!existingDinner){
      await db.query("insert into public.reservation_service_periods(id,organization_id,location_id,name,days_of_week,starts_local,ends_local,default_duration_minutes,pacing_interval_minutes,pacing_cover_limit,min_party_size,max_party_size,effective_from,effective_to,online_enabled,is_active) values($1,$2,$3,$4,array[0,1,2,3,4,5,6],$5,$6,$7,$8,$9,$10,$11,$12,$12,false,true)",[state.dinnerPeriod,f.org,f.location,prefix+' Dinner',sourcePeriod.starts_local,sourcePeriod.ends_local,sourcePeriod.default_duration_minutes,sourcePeriod.pacing_interval_minutes,sourcePeriod.pacing_cover_limit,sourcePeriod.min_party_size,sourcePeriod.max_party_size,day]);
      await db.query('insert into public.reservation_turn_rules(organization_id,service_period_id,min_party_size,max_party_size,duration_minutes) select organization_id,$2,min_party_size,max_party_size,duration_minutes from public.reservation_turn_rules where service_period_id=$1',[sourcePeriod.id,state.dinnerPeriod]);
    }
    const fixturePeriods=(await db.query('select id,online_enabled,effective_from,effective_to from public.reservation_service_periods where id=any($1::uuid[])',[[state.lunchPeriod,state.dinnerPeriod]])).rows;
    check('fixture-only-configuration',fixturePeriods.length===2&&fixturePeriods.every(p=>!p.online_enabled),{outputItemId:state.output,recipeId:state.recipe,lunchPeriodId:state.lunchPeriod,onlineBookingEnabled:false,physicalApproval:false});
  });
  await phase('receiving',async()=>{
    const vendor=(await db.query('select id from public.vendors where organization_id=$1 and is_active order by id limit 1',[f.org])).rows[0];assert(vendor,'Vendor fixture missing');
    const args={requestId:randomUUID(),locationId:f.location,vendorId:vendor.id,purchaseOrderId:null,deliveredAt:new Date().toISOString(),invoiceNumber:prefix,notes:prefix+' damaged delivery; no vendor contact',lines:[{inventoryItemId:state.raw.id,unitId:state.raw.base_unit_id,quantity:3,acceptedQuantity:2,unitPriceCents:100,lotCode:prefix,expiresOn:null,exceptionKind:'damaged',exceptionNote:'Reject one synthetic unit'}]};
    state.delivery=await observed('receive damaged delivery','Owner',()=>receiveInventoryDelivery(ctx.Owner,args));
    const replay=await observed('receive exact retry','Owner',()=>receiveInventoryDelivery(ctx.Owner,args));check('delivery-retry',replay.id===state.delivery.id,{sameRecord:replay.id===state.delivery.id});
    check('unreviewed-receipt-not-stock',await onHand(state.raw.id)===state.rawBefore,{before:state.rawBefore,after:await onHand(state.raw.id)});
    await refuse('receiver-self-review-refused','Owner','review_delivery_receiving_exceptions',{p_request_id:randomUUID(),p_posting_request_id:randomUUID(),p_delivery_id:state.delivery.id,p_approve:true,p_note:prefix+' self approval probe'});
    const review={requestId:randomUUID(),postingRequestId:randomUUID(),deliveryId:state.delivery.id,approve:true,note:prefix+' independently accepted two / rejected one'};
    await observed('independent receipt review','Owner2',()=>reviewDeliveryExceptions(ctx.Owner2,review));await observed('receipt-review exact retry','Owner2',()=>reviewDeliveryExceptions(ctx.Owner2,review));
    check('accepted-only-stock',await onHand(state.raw.id)===state.rawBefore+2,{accepted:2,rejected:1,before:state.rawBefore,after:await onHand(state.raw.id),deliveryId:state.delivery.id});
    state.creditDue=new Date(Date.now()+86400000).toISOString();
    const task=await observed('vendor-credit follow-up','Owner',()=>createTask(ctx.Owner,{requestId:randomUUID(),locationId:f.location,title:prefix+' vendor credit',description:'Delivery '+state.delivery.id+': one damaged unit; no credit received; owner must follow up through approved channel',priority:'normal',assignedEmployeeId:state.owner2Employee.id,dueAt:state.creditDue}));state.creditTask=task;
    issues.push({id:'vendor-credit',status:'open',recordId:task.id,ownerId:f.users.Owner2.id,dueAt:state.creditDue,nextAction:'Reconcile one rejected unit with a real vendor credit or replacement; not contacted by this rehearsal'});
  },['preflight']);
  await phase('opening',async()=>{
    const template=await observed('create opening checklist','Owner',()=>createChecklistTemplateVersion(ctx.Owner,{requestId:randomUUID(),locationId:f.location,name:prefix+' opening',checklistType:'opening',items:[{label:'Synthetic room ready',instructions:'No physical approval is implied',responseType:'checkbox',required:true,validation:{}},{label:'Synthetic gauge reading',instructions:'Test scale only; a human reviews exceptions',responseType:'number',required:true,validation:{}}]}));
    await observed('publish opening checklist','Owner',()=>publishChecklistTemplate(ctx.Owner,{requestId:randomUUID(),templateId:template.id}));
    state.checklist=await observed('start opening checklist','Employee',()=>startChecklistRun(ctx.Employee,{requestId:randomUUID(),locationId:f.location,templateId:template.id,businessDate:day,assignedEmployeeId:state.employees.find(e=>e.user_id===f.users.Employee.id).id}));
    await refuse('missing-opening-response-refused','Employee','complete_checklist_run',{p_request_id:randomUUID(),p_run_id:state.checklist.id,p_note:prefix+' omission probe'});
    const items=(await db.query('select id,response_type from public.checklist_template_items where template_id=$1 order by position',[template.id])).rows;
    for(const item of items)await observed('record opening response','Employee',()=>recordChecklistResponse(ctx.Employee,{requestId:randomUUID(),runId:state.checklist.id,templateItemId:item.id,response:item.response_type==='checkbox'?true:5,notes:prefix+' synthetic evidence, no physical measurement'}));
    const done=await observed('complete opening checklist','Employee',()=>completeChecklistRun(ctx.Employee,{requestId:randomUUID(),runId:state.checklist.id,note:prefix+' synthetic control only'}));check('opening-required-responses',done.status==='completed',{status:done.status,runId:done.id,physicalSafetyVerified:false});
  },['preflight']);
  await phase('prep',async()=>{
    const taskId=randomUUID(),draft=await observed('save recipe prep draft','Chef',()=>savePrepTask(ctx.Chef,{requestId:randomUUID(),taskId,locationId:f.location,businessDate:day,servicePeriod:'lunch',station:prefix,recipeId:state.recipe,outputInventoryItemId:state.output,targetQuantity:2,targetUnitId:state.raw.base_unit_id,dueAt:at('11:00'),assigneeUserId:f.users.Chef.id,note:prefix+' recipe-traced batch',expectedVersion:null}));
    const published=await observed('publish prep','Chef',()=>transitionPrepTask(ctx.Chef,{requestId:randomUUID(),taskId,expectedVersion:draft.version,command:'publish'}));
    state.prepPreview=await observed('preview recipe movements','Chef',()=>previewPrepCompletion(ctx.Chef,{taskId,actualYield:2}));
    const args={requestId:randomUUID(),taskId,expectedVersion:published.version,actualYield:2,overrideInsufficient:false,completionNote:prefix+' no physical preparation'};
    state.prep=await observed('post recipe prep','Chef',()=>completePrepTask(ctx.Chef,args));await observed('prep exact retry','Chef',()=>completePrepTask(ctx.Chef,args));
    check('recipe-input-output-once',Math.abs(await onHand(state.raw.id)-(state.rawBefore+1))<.00001&&await onHand(state.output)===2,{ingredientDelta:await onHand(state.raw.id)-state.rawBefore,output:await onHand(state.output),taskId});
  },['receiving']);
  await phase('lunch_brief',async()=>{state.lunchBrief=await brief('lunch',plan.lunch.covers);},['opening','prep']);
  await phase('lunch',async()=>{
    state.lunch=await book(plan.lunch);for(const res of state.lunch)await seat(res);
    const peak=(await tableState()).filter(t=>t.status==='occupied').reduce((n,t)=>n+t.max_capacity,0);check('lunch-36-actual-states',state.lunch.length===18&&peak===36,{reservations:state.lunch.length,physicalStateCovers:peak,simulatedMealCovers:36});
    for(const res of state.lunch)await finish(res);
    const active=(await db.query('select count(*)::int n from public.reservation_table_allocations where reservation_id=any($1::uuid[]) and is_active',[state.lunch.map(x=>x.id)])).rows[0].n;check('lunch-released-reset',active===0&&(await tableState()).every(t=>!t.status||t.status==='available'),{activeAllocations:active});
  },['lunch_brief']);
  await phase('handoff',async()=>{
    const acceptanceRequestId=randomUUID();
    await observed('incoming owner accepts credit task','Owner2',()=>transitionTask(ctx.Owner2,{requestId:acceptanceRequestId,taskId:state.creditTask.id,status:'in_progress',note:prefix+' I accept follow-up for delivery '+state.delivery.id+'; credit remains outstanding'}));
    const task=(await db.query('select status,assigned_employee_id,due_at,last_transition_note from public.tasks where id=$1',[state.creditTask.id])).rows[0];
    const acceptance=(await db.query('select actor_id,completed_at from private.operation_requests where request_id=$1 and record_id=$2',[acceptanceRequestId,state.creditTask.id])).rows[0];
    issues[0].status='accepted_handoff';check('unresolved-credit-carried',acceptance?.actor_id===f.users.Owner2.id&&!!acceptance.completed_at&&task.last_transition_note?.includes('I accept')&&task.status==='in_progress'&&task.assigned_employee_id===state.owner2Employee.id&&!!task.due_at,{taskId:state.creditTask.id,status:task.status,owner:f.users.Owner2.id,dueAt:task.due_at,financialCreditSettled:false});
  },['receiving','lunch']);
  await phase('dinner_brief',async()=>{state.dinnerBrief=await brief('dinner',plan.dinner.covers);},['handoff']);
  await phase('dinner',async()=>{
    state.dinner=await book(plan.dinner);for(const res of state.dinner.slice(0,20))await seat(res);
    const peak=(await tableState()).filter(t=>t.status==='occupied').reduce((n,t)=>n+t.max_capacity,0);check('dinner-40-peak',peak===40,{physicalStateCovers:peak});
    const low=await observed('component running low at synthetic peak','Owner',()=>recordServiceAvailability(ctx.Owner,{requestId:randomUUID(),locationId:f.location,subjectType:'component',subjectId:state.output,expectedEventId:null,status:'running_low',estimatedPortions:2,reason:prefix,effectiveAt:at('19:30'),notes:'Internal only; no POS menu change'}));
    state.eightySix=await observed('component 86 at synthetic peak','Owner',()=>recordServiceAvailability(ctx.Owner,{requestId:randomUUID(),locationId:f.location,subjectType:'component',subjectId:state.output,expectedEventId:low.id,status:'eighty_sixed',estimatedPortions:0,reason:prefix,effectiveAt:at('19:45'),notes:'Internal only; no POS menu change'}));
    const staff=await ctx.Employee.supabase.from('service_availability_events').select('id,status').eq('subject_id',state.output).order('effective_at',{ascending:false}).limit(1);
    check('86-visible-to-staff',!staff.error&&staff.data?.[0]?.status==='eighty_sixed',{errorCode:staff.error?.code??null,status:staff.data?.[0]?.status??null,providerMenuChanged:false});
    const invalid={...state.dinner[0].args,p_request_id:randomUUID(),p_display_name:prefix+' capacity refusal',p_reserved_at:at('18:00'),p_party_size:1};await refuse('no-41st-concurrent-cover','Host','save_reservation_with_guest',invalid);
    const orphan=(await db.query('select count(*)::int n from public.guests where display_name=$1',[invalid.p_display_name])).rows[0].n;check('capacity-refusal-no-orphan',orphan===0,{orphanGuests:orphan});
    for(const res of state.dinner.slice(0,5))await finish(res);for(const res of state.dinner.slice(20,25))await seat(res);
    for(const res of state.dinner.slice(5,10))await finish(res);
    const absent=state.dinner[25];await move(absent.id,'no_show');
    const replacement=await rpc('Host','save_reservation_with_guest',{...absent.args,p_request_id:randomUUID(),p_display_name:prefix+' replacement walk-in',p_source:'walk_in'});state.dinner[25]={...replacement,tableId:absent.tableId};state.noShowId=absent.id;
    for(const res of state.dinner.slice(25))await seat(res);
    const afterTurnPeak=(await tableState()).filter(t=>t.status==='occupied').reduce((n,t)=>n+t.max_capacity,0);check('turnover-stays-within-40',afterTurnPeak===40,{physicalStateCovers:afterTurnPeak,noShowId:absent.id,replacementId:replacement.id});
    for(const res of state.dinner.slice(10))await finish(res);
    const completed=(await db.query("select coalesce(sum(party_size),0)::int covers,count(*)::int parties from public.reservations where id=any($1::uuid[]) and status='completed'",[state.dinner.map(x=>x.id)])).rows[0];
    const noShow=(await db.query('select status from public.reservations where id=$1',[absent.id])).rows[0];check('dinner-60-completed-and-no-show-retained',completed.covers===60&&completed.parties===30&&noShow.status==='no_show',{...completed,noShowStatus:noShow.status});
  },['dinner_brief']);
  await phase('availability',async()=>{
    assert(state.eightySix,'Peak 86 event missing');
    await refuse('stale-availability-refused','Owner2','record_canonical_service_availability_event',{p_request_id:randomUUID(),p_organization_id:f.org,p_location_id:f.location,p_subject_type:'component',p_subject_id:state.output,p_expected_event_id:null,p_status:'restored',p_estimated_portions:2,p_reason:prefix,p_effective_at:at('21:00'),p_expected_restoration_at:null,p_notes:'Stale writer probe'});
    const restored=await observed('restore component','Owner2',()=>recordServiceAvailability(ctx.Owner2,{requestId:randomUUID(),locationId:f.location,subjectType:'component',subjectId:state.output,expectedEventId:state.eightySix.id,status:'restored',estimatedPortions:2,reason:prefix,effectiveAt:at('21:00'),notes:'Test-only restoration, not physical food or POS menu'}));
    const history=(await db.query('select status from public.service_availability_events where subject_id=$1 order by effective_at',[state.output])).rows.map(r=>r.status);check('availability-history-retained',history.join()===['running_low','eighty_sixed','restored'].join(),{history,lastId:restored.id});
  },['dinner']);
  await phase('closing_inventory',async()=>{
    const waste=await observed('submit component waste','Owner',()=>submitWasteRecord(ctx.Owner,{requestId:randomUUID(),locationId:f.location,inventoryItemId:state.output,unitId:state.raw.base_unit_id,quantity:.25,reasonCode:'spoilage',occurredAt:new Date().toISOString(),notes:prefix+' synthetic waste; not sale consumption'}));
    await refuse('waste-self-review-refused','Owner','review_waste_record',{p_request_id:randomUUID(),p_waste_record_id:waste.id,p_approve:true,p_note:prefix});
    await observed('independent waste review','Owner2',()=>reviewWasteRecord(ctx.Owner2,{requestId:randomUUID(),wasteRecordId:waste.id,approve:true,note:prefix+' no actual goods'}));
    const beforeCount=await onHand(state.output);check('waste-distinct-from-consumption',beforeCount===1.75,{componentRemaining:beforeCount,postedWaste:.25,salesConsumptionImported:false});
    const count=await observed('submit blind cycle count','Owner',()=>submitInventoryCount(ctx.Owner,{submissionId:randomUUID(),locationId:f.location,countType:'cycle',notes:prefix+' synthetic count finds .25 unexplained shortage',lines:[{inventoryItemId:state.output,unitId:state.raw.base_unit_id,expectedQuantity:null,countedQuantity:1.5,unitCostCents:null,notes:prefix}]}));
    await refuse('count-self-review-refused','Owner','approve_inventory_count',{p_request_id:randomUUID(),p_count_id:count.id,p_approve:true,p_note:prefix});
    const approval={requestId:randomUUID(),countId:count.id,approve:true,note:prefix+' independent review; variance distinct from recorded waste'};
    await observed('independent count review','Owner2',()=>approveInventoryCount(ctx.Owner2,approval));await observed('count review exact retry','Owner2',()=>approveInventoryCount(ctx.Owner2,approval));
    check('count-adjustment-once',await onHand(state.output)===1.5,{before:beforeCount,after:await onHand(state.output),unexplainedVariance:-.25,countId:count.id});
  },['availability','prep']);
  await phase('financial',async()=>{
    const roles=(await db.query('select id,name from public.job_roles where organization_id=$1',[f.org])).rows,server=roles.find(r=>r.name==='Server');assert(server,'Server role missing');
    for(const[role,from,to]of[['Employee','16:00','20:00'],['Host','18:00','20:00']]){
      const employee=state.employees.find(e=>e.user_id===f.users[role].id);
      await observed('record synthetic missed shift '+role,'Owner',()=>recordMissedTimeEntry(ctx.Owner,{requestId:randomUUID(),locationId:f.location,employeeId:employee.id,jobRoleId:server.id,scheduledShiftId:null,clockedInLocal:day+'T'+from,clockedOutLocal:day+'T'+to,reason:prefix+' synthetic labor; F33 policy acceptance still required'}));
    }
    const vector=plan.manualFinancialVector,args={submissionId:randomUUID(),locationId:f.location,businessDate:day,shiftLabel:prefix,...vector,expectedCashCents:vector.cashSalesCents,covers:96,serviceChargesCents:0,cashTipsCents:0,notes:prefix+' MANUAL SYNTHETIC totals: no POS/check import. $5 shortage explained for test only; not cash custody evidence.'};
    state.closeout=await observed('submit manual synthetic day closeout','Owner',()=>submitCloseout(ctx.Owner,args));const replay=await observed('closeout exact retry','Owner',()=>submitCloseout(ctx.Owner,args));check('closeout-same-record',replay.id===state.closeout.id&&replay.alreadyApplied,{sameRecord:replay.id===state.closeout.id,source:'manual synthetic control totals'});
    await refuse('closeout-self-approval-refused','Owner','approve_closeout',{p_closeout_id:state.closeout.id,p_approved:true,p_note:prefix});
    await observed('approve synthetic closeout','Owner2',()=>approveCloseout(ctx.Owner2,{closeoutId:state.closeout.id,approved:true,note:prefix+' independent arithmetic/variance review only'}));
    const policy=await observed('configure test-only tip policy','Owner',()=>configureTipPolicy(ctx.Owner,{requestId:randomUUID(),policyId:randomUUID(),organizationId:f.org,locationId:f.location,name:prefix,description:'No restaurant wage or legal policy approval',isActive:true}));
    const version=await saveTipPolicyDraft(ctx.Owner,{requestId:randomUUID(),policyId:policy.id,policyVersionId:randomUUID(),distributionMethod:'hours',effectiveFrom:day,effectiveTo:day,closeoutSources:['card_tips'],eligibilityRules:roles.map(r=>({jobRoleId:r.id,eligible:r.id===server.id,points:1,minimumMinutes:0}))});
    await approveTipPolicyVersion(ctx.Owner2,{requestId:randomUUID(),policyVersionId:version.id});
    state.tipRun=await prepareTipRun(ctx.Owner,{requestId:randomUUID(),closeoutId:state.closeout.id,policyVersionId:version.id});await calculateTipRun(ctx.Owner,{tipRunId:state.tipRun.id});await approveTipRun(ctx.Owner2,{tipRunId:state.tipRun.id});
    const allocations=(await db.query('select p.worked_minutes,a.final_amount_cents from public.tip_allocations a join public.tip_run_participants p on p.tip_run_id=a.tip_run_id and p.employee_id=a.employee_id where a.tip_run_id=$1 order by p.worked_minutes desc',[state.tipRun.id])).rows;
    check('tip-source-cents-reconcile',allocations.length===2&&allocations.reduce((n,x)=>n+Number(x.final_amount_cents),0)===vector.cardTipsCents,{allocations,sourceCents:vector.cardTipsCents});
    const exportId=randomUUID(),exported=await exportTipPayroll(ctx.Owner2,{requestId:exportId,tipRunId:state.tipRun.id}),exportReplay=await exportTipPayroll(ctx.Owner2,{requestId:exportId,tipRunId:state.tipRun.id});
    const exportRows=(await db.query('select count(*)::int n from public.payroll_exports where id=$1',[exportId])).rows[0].n;
    check('support-export-not-payroll-submission',exported.csv===exportReplay.csv&&exportRows===1,{auditRecords:exportRows,payrollProviderSubmitted:false});
  },['dinner','closing_inventory']);
  await phase('final_reconciliation',async()=>{
    const ids=[...state.lunch,...state.dinner].map(r=>r.id),totals=(await db.query("select coalesce(sum(party_size),0)::int covers,count(*)::int parties from public.reservations where id=any($1::uuid[]) and status='completed'",[ids])).rows[0];
    check('96-completed-covers',totals.covers===96&&totals.parties===48,{...totals,lunchExpected:36,dinnerExpected:60});
    const allocations=(await db.query('select count(*)::int n from public.reservation_table_allocations where reservation_id=any($1::uuid[]) and is_active',[ids])).rows[0].n;check('day-allocations-released',allocations===0,{activeAllocations:allocations});
    const cash=(await db.query('select status,covers,net_sales_cents,expected_cash_cents,actual_cash_cents from public.shift_closeouts where id=$1',[state.closeout.id])).rows[0];check('closeout-covers-and-variance',cash.status==='approved'&&cash.covers===96&&Number(cash.net_sales_cents)===546000&&Number(cash.expected_cash_cents)-Number(cash.actual_cash_cents)===500,{...cash,totalsAreManual:true,upstreamPOSReconciled:false});
    const task=(await db.query('select status,due_at,assigned_employee_id from public.tasks where id=$1',[state.creditTask.id])).rows[0];check('credit-remains-open-and-owned',task.status==='in_progress'&&!!task.due_at&&task.assigned_employee_id===state.owner2Employee.id,{status:task.status,owner:f.users.Owner2.id,externalCreditReceived:false});
    const room=await tableState();
    check('room-reset-at-end',room.every(t=>t.status==='available'),{tableStates:room.map(t=>({label:t.label,status:t.status})),actualPhysicalResetObserved:false});
  },['financial']);
  const score=buildConnectedServiceDayScorecard({requiredPhases:plan.requiredPhases,phases,checks,issues,scopeGaps});
  assert(score.mechanicalStatus==='passed','Integrated rehearsal did not complete: '+JSON.stringify({missing:score.missingOrFailedPhases,failed:score.failedChecks,phases}));
},120000);
