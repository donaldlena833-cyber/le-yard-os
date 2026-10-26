import{test}from'vitest';import{readFileSync,writeFileSync}from'node:fs';import{randomUUID}from'node:crypto';import{createClient}from'@supabase/supabase-js';import pg from'pg';
import{requireAuthenticatedActor}from'@/data/actor';import{submitInventoryCount,approveInventoryCount}from'@/data/workflows/inventory';
const need=k=>{if(!process.env[k])throw Error(k+' required');return process.env[k];};
const f=JSON.parse(readFileSync(need('LOCAL_READINESS_FIXTURE_PATH'))),s=JSON.parse(readFileSync(need('LOCAL_READINESS_STATUS_PATH')));if(f.api!=='http://127.0.0.1:55421'||f.classification!=='isolated_local_synthetic_nonproduction')throw Error('Unsafe test scope');
test('connected spot-count subset, exact retry and full-count coverage guard',async()=>{
 const url=new URL(s.DB_URL);if(url.hostname!=='127.0.0.1'||url.port!=='55422')throw Error('Unsafe database');const db=new pg.Client({connectionString:s.DB_URL});await db.connect();const checks=[];
 const check=(id,passed,observed)=>{checks.push({id,passed,observed});if(!passed)throw Error(id);};
 try{
 const ctx={};for(const role of['Owner','Owner2']){const client=createClient(f.api,s.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}}),a=await client.auth.signInWithPassword({email:f.users[role].email,password:f.users[role].password});if(a.error)throw a.error;ctx[role]={supabase:client,actor:await requireAuthenticatedActor(client)};}
 const items=(await db.query('select id,base_unit_id,name from public.inventory_items where organization_id=$1 and is_active and track_inventory',[f.org])).rows,item=items.find(i=>i.name==='Demo Tomatoes');if(!item||items.length<2)throw Error('Multi-item synthetic catalog required');
 const stock=Number((await db.query('select coalesce(sum(quantity_delta),0) q from public.inventory_transactions where location_id=$1 and inventory_item_id=$2',[f.location,item.id])).rows[0].q);
 const args={submissionId:randomUUID(),locationId:f.location,countType:'spot',notes:'READINESS ONLY bounded spot count; no physical stock',lines:[{inventoryItemId:item.id,unitId:item.base_unit_id,expectedQuantity:999999,countedQuantity:stock,unitCostCents:999999,notes:'Synthetic test does not trust supplied expected/cost values'}]};
 const saved=await submitInventoryCount(ctx.Owner,args),retry=await submitInventoryCount(ctx.Owner,args);const rows=(await db.query('select expected_quantity,unit_cost_cents from public.inventory_count_lines where inventory_count_id=$1',[saved.id])).rows;
 check('one-line-spot-and-retry',saved.id===retry.id&&retry.alreadyApplied&&rows.length===1&&Number(rows[0].expected_quantity)===stock,{sameRecord:saved.id===retry.id,submittedLines:rows.length,activeCatalogItems:items.length,serverExpected:Number(rows[0].expected_quantity),clientExpectedIgnored:true});
 await approveInventoryCount(ctx.Owner2,{requestId:randomUUID(),countId:saved.id,approve:true,note:'Independent synthetic no-variance spot review'});
 const status=(await db.query('select status,count_type from public.inventory_counts where id=$1',[saved.id])).rows[0];check('spot-independently-reviewed',status.status==='approved'&&status.count_type==='spot',status);
 let refused=false;try{await submitInventoryCount(ctx.Owner,{...args,submissionId:randomUUID(),countType:'full'});}catch(e){refused=e.code==='conflict';}check('full-subset-still-refused',refused,{refused});
 }finally{await db.end();writeFileSync(need('LOCAL_READINESS_EVIDENCE_PATH'),JSON.stringify({at:new Date().toISOString(),classification:f.classification,finding:'F40',checks,summary:{passed:checks.filter(c=>c.passed).length,total:checks.length},productionChanged:false},null,2)+'\n');}
});
