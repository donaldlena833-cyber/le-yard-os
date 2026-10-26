import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import AxeBuilder from '@axe-core/playwright';
const f=JSON.parse(readFileSync(process.env.LOCAL_READINESS_FIXTURE_PATH!,'utf8'));
const s=JSON.parse(readFileSync(process.env.LOCAL_READINESS_STATUS_PATH!,'utf8'));
const a=JSON.parse(readFileSync(process.env.LOCAL_READINESS_ACCESS_FIXTURE_PATH!,'utf8'));
if(f.classification!=='isolated_local_synthetic_nonproduction'||a.classification!==f.classification||f.api!=='http://127.0.0.1:55421'||s.API_URL!==f.api||a.org!==f.org||a.location!==f.location||!a.identity.email.startsWith('readiness.access.'))throw Error('Unsafe scope');
const owner=createClient(f.api,s.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=createClient(f.api,s.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let overrideId:string|null=null;
const observations:Record<string,unknown>[]=[];
async function rpc(name:string,args:Record<string,unknown>){const r=await owner.rpc(name as never,args as never);if(r.error)throw Error(name+': '+r.error.code);return r.data as Record<string,unknown>;}
async function member(role='manager',status='active',location=f.location){return rpc('administer_organization_member',{p_request_id:randomUUID(),p_membership_id:a.memberId,p_role:role,p_status:status,p_location_ids:[location],p_primary_location_id:location});}
async function capability(effect='grant'){if(!overrideId){const existing=await owner.from('user_capability_overrides').select('id').eq('organization_id',f.org).eq('user_id',a.userId).eq('location_id',f.location).eq('capability_key','reservations.view');if(existing.error||existing.data.length>1)throw Error('Synthetic override identity unavailable');overrideId=existing.data[0]?.id??null;}const x=await rpc('configure_user_capability_override',{p_request_id:randomUUID(),p_organization_id:f.org,p_override_id:overrideId,p_user_id:a.userId,p_capability_key:'reservations.view',p_location_id:f.location,p_effect:effect,p_reason:'READINESS ONLY — automatic workspace context test',p_effective_from:'2026-10-01',p_effective_to:null,p_is_active:true});overrideId=String(x.id);}
async function login(page:Page,identity=a.identity){await page.goto('/sign-in');await page.getByLabel('Username or work email').fill(identity.email);await page.locator('input[name="password"]').fill(identity.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Today',level:1,exact:true})).toBeVisible({timeout:30000});}
async function access(page:Page){const r=await page.request.get('/api/workspace/access');return {httpStatus:r.status(),body:await r.json()};}
test.beforeAll(async()=>{const identity=await admin.auth.admin.getUserById(a.userId);if(identity.error||identity.data.user.email!==a.identity.email)throw Error('Synthetic identity mismatch');const unbanned=await admin.auth.admin.updateUserById(a.userId,{ban_duration:'none'});if(unbanned.error)throw Error('Synthetic fixture cannot resume');const login=await owner.auth.signInWithPassword({email:f.users.Owner.email,password:f.users.Owner.password});if(login.error)throw Error('Owner sign-in unavailable');});
test.beforeEach(async()=>{await member();await capability();});
test.afterAll(async()=>{
 const cleanup:Record<string,unknown>={};
 try{await member('employee','suspended');cleanup.membershipSuspended=true;}catch{cleanup.membershipSuspended=false;}
 const banned=await admin.auth.admin.updateUserById(a.userId,{ban_duration:'876000h'});cleanup.syntheticAccountBanned=!banned.error;
 await owner.auth.signOut({scope:'local'});
 writeFileSync('/Users/donaldlena/Documents/Codex/2026-10-24/g/outputs/workspace-access-observations.json',JSON.stringify({at:new Date().toISOString(),classification:f.classification,migrationHead:a.migrationHead,observations,cleanup,productionChanged:false,physicalDeviceAccepted:false,maximumConfiguredVisiblePollingIntervalMs:30000,requestTimeoutMs:8000},null,2)+'\n');
 expect(cleanup).toEqual({membershipSuspended:true,syntheticAccountBanned:true});
});

test('a capability withdrawn between server render and initial verification never opens the old screen',async({page})=>{
 await login(page);const original=await access(page);expect(original.httpStatus).toBe(200);expect(Object.keys(original.body).sort()).toEqual(['revision','status']);
 let release!:()=>void;let intercepted!:()=>void;const captured=new Promise<void>(resolve=>{intercepted=resolve;});const barrier=new Promise<void>(resolve=>{release=resolve;});let held=false;
 await page.route('**/api/workspace/access',async route=>{if(held){await route.continue();return;}held=true;intercepted();await barrier;await route.continue();});
 await page.goto('/reservations',{waitUntil:'domcontentloaded'});await captured;
 await expect(page.getByRole('heading',{name:'Checking workspace access',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Reservations',level:1,exact:true})).toHaveCount(0);
 const start=Date.now();await capability('deny');release();await expect(page).toHaveURL(/\/today(?:\?|$)/,{timeout:30000});await expect(page.getByText('Your workspace access was updated. Review the current restaurant, location and available actions.',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Reservations',exact:true})).toHaveCount(0);const current=await access(page);expect(current.body.revision).not.toBe(original.body.revision);
 observations.push({case:'initial-render capability withdrawal',elapsedMs:Date.now()-start,currentRevisionChanged:true,oldScreenNeverExposed:true,automaticDocumentReplacement:true});
});

test('a retained visible page detects role and location withdrawal through the regular poll',async({page})=>{
 await login(page);const initial=await access(page);const start=Date.now();await member('employee','active',f.otherLocation);
 await expect(page.getByText(a.locationNames[f.otherLocation],{exact:true}).first()).toBeVisible({timeout:45000});await expect(page.getByText('Employee · Signed in',{exact:true}).first()).toBeVisible();
 const current=await access(page);expect(current.httpStatus).toBe(200);expect(current.body.revision).not.toBe(initial.body.revision);
 observations.push({case:'automatic visible poll role/location withdrawal',elapsedMs:Date.now()-start,explicitFocusOrReloadAfterChange:false,currentRevisionChanged:true,authoritativeNewLocation:true});
});

test('suspension retires a retained view and shows the actual no-membership state',async({page})=>{
 await login(page);const start=Date.now();await member('manager','suspended');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByRole('heading',{name:'No active workspace membership',exact:true})).toBeVisible({timeout:30000});await expect(page.getByRole('heading',{name:'Today',level:1,exact:true})).toHaveCount(0);
 const r=await access(page);expect(r.httpStatus).toBe(403);expect(r.body).toEqual({status:'access_changed'});
 await page.screenshot({path:'/Users/donaldlena/Documents/Codex/2026-10-24/g/outputs/evidence/workspace-access-suspended.png',fullPage:true});observations.push({case:'membership suspension',elapsedMs:Date.now()-start,workspaceWithdrawn:true,httpStatus:r.httpStatus});
});

test('network loss covers the screen and reconnect verifies current scope before resuming',async({page,context})=>{
 await login(page);const before=await access(page);await context.setOffline(true);
 await expect(page.getByRole('heading',{name:'Workspace access could not be verified',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Today',level:1,exact:true})).toHaveCount(0);
 await context.setOffline(false);await expect(page.getByRole('heading',{name:'Today',level:1,exact:true})).toBeVisible({timeout:30000});expect((await access(page)).body.revision).toBe(before.body.revision);
 observations.push({case:'offline/reconnect',oldContextCoveredOffline:true,matchingAuthoritativeRevisionRequired:true});
});

test('sign-out in another local tab removes an already-open workspace without a manual refresh',async({page,context})=>{
 await login(page);const other=await context.newPage();await other.goto('/today');await expect(other.getByRole('heading',{name:'Today',level:1,exact:true})).toBeVisible();const start=Date.now();await other.getByRole('button',{name:'Log out',exact:true}).click();await expect(other).toHaveURL(/\/sign-in/);
 await expect(page).toHaveURL(/\/sign-in/,{timeout:45000});expect((await page.request.get('/api/workspace/access')).status()).toBe(401);observations.push({case:'second-tab sign-out',elapsedMs:Date.now()-start,manualRefresh:false,firstTabReturnedToSignIn:true});
});

test('connected Closeout has one main landmark in its shell',async({page})=>{
 await login(page,f.users.Owner);await page.goto('/closeout');await expect(page.getByRole('heading',{name:'Money',level:1,exact:true})).toBeVisible();await expect(page.getByRole('main')).toHaveCount(1);
 const result=await new AxeBuilder({page}).withRules(['landmark-main-is-top-level','landmark-no-duplicate-main']).analyze();expect(result.violations).toEqual([]);
 await page.screenshot({path:'/Users/donaldlena/Documents/Codex/2026-10-24/g/outputs/evidence/closeout-single-main-browser.png',fullPage:true});observations.push({case:'Closeout semantics',mainLandmarks:1,testedRules:['landmark-main-is-top-level','landmark-no-duplicate-main'],violations:result.violations.length});
});
