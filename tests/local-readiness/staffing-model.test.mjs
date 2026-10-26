import{test,expect,vi}from'vitest';
import{readFileSync,writeFileSync}from'node:fs';
import{createClient}from'@supabase/supabase-js';
const boundary=vi.hoisted(()=>({client:null}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>boundary.client}));
import{loadLiveSchedule}from'@/data/read-models/schedule';
test('actual schedule read model requires the current replacement acknowledgement',async()=>{
 const fixture=JSON.parse(readFileSync(process.env.LOCAL_READINESS_FIXTURE_PATH)),status=JSON.parse(readFileSync(process.env.LOCAL_READINESS_STATUS_PATH)),scenario=JSON.parse(readFileSync(process.env.STAFFING_SCENARIO_PATH));
 if(fixture.classification!=='isolated_local_synthetic_nonproduction'||fixture.api!=='http://127.0.0.1:55421'||status.API_URL!==fixture.api)throw Error('Unsafe target');
 const client=createClient(fixture.api,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const login=await client.auth.signInWithPassword({email:fixture.users.Owner.email,password:fixture.users.Owner.password});if(login.error)throw login.error;boundary.client=client;
 const expected=process.env.STAFFING_EXPECTED_ACK==='true';
 const result=await loadLiveSchedule({mode:'live',identity:{userId:fixture.users.Owner.id},organization:{id:fixture.org},activeLocation:{id:fixture.location},capabilities:['schedule.manage','schedule.publish']},scenario.weekStart);expect(result.ok).toBe(true);const shift=result.data.shifts.find(x=>x.id===scenario.swapShift);expect(shift).toBeDefined();
 const report={at:new Date().toISOString(),classification:fixture.classification,realAuthService:true,realDataAPI:true,actualApplicationReadModel:true,serverClientFactoryInjectedForHarness:true,scenario:scenario.stage,shiftId:shift.id,currentEmployeeId:shift.employeeId,currentAcknowledged:shift.acknowledged,priorAcknowledgements:scenario.afterReplacement.acknowledgements,expectedCurrentAcknowledged:expected,accepted:shift.acknowledged===expected,productionChanged:false};writeFileSync(process.env.STAFFING_MODEL_REPORT_PATH,JSON.stringify(report,null,2)+'\n');expect(shift.acknowledged).toBe(expected);
});
