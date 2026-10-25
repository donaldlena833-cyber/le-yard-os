import {describe,it,expect,vi} from 'vitest';
import type{WorkflowContext}from'@/data/execute';
import{submitInventoryCount}from'@/data/workflows/inventory';
vi.mock('server-only',()=>({}));
const id={org:'20000000-0000-4000-8000-000000000001',loc:'30000000-0000-4000-8000-000000000001',one:'40000000-0000-4000-8000-000000000001',two:'40000000-0000-4000-8000-000000000002',unit:'50000000-0000-4000-8000-000000000001',request:'60000000-0000-4000-8000-000000000001',actor:'70000000-0000-4000-8000-000000000001'};
function setup(){
 const data:Record<string,unknown>={locations:{id:id.loc,organization_id:id.org,is_active:true},inventory_counts:null,inventory_items:[{id:id.one,base_unit_id:id.unit},{id:id.two,base_unit_id:id.unit}],inventory_on_hand:[{inventory_item_id:id.one,quantity_on_hand:8},{inventory_item_id:id.two,quantity_on_hand:3}],item_price_history:[{inventory_item_id:id.one,unit_id:id.unit,price_quantity:1,unit_price_cents:100,effective_at:'2026-10-01T00:00:00Z'}]};
 const from=vi.fn((table:string)=>{const q={select:vi.fn(),eq:vi.fn(),order:vi.fn(),in:vi.fn(),limit:vi.fn(),maybeSingle:async()=>({data:data[table],error:null}),then:(resolve:(x:unknown)=>unknown)=>Promise.resolve({data:data[table],error:null}).then(resolve)};for(const key of ['select','eq','order','in','limit'] as const)q[key].mockReturnValue(q);return q;});
 const rpc=vi.fn(async(name:string)=>({data:name==='has_capability'?true:{id:id.request,status:'submitted',counted_at:'2026-10-24T12:00:00Z'},error:null}));
 const context={supabase:{from,rpc},actor:{userId:id.actor,aal:'aal2',memberships:[{organizationId:id.org,role:'owner',organizationWide:true,locationIds:[]}]}} as unknown as WorkflowContext;
 return{context,rpc};
}
const line=(item=id.one,unit=id.unit)=>({inventoryItemId:item,unitId:unit,countedQuantity:2,expectedQuantity:999,unitCostCents:999,notes:null});
const input=(countType:'full'|'cycle'|'spot',lines=[line()])=>({submissionId:id.request,locationId:id.loc,countType,notes:null,lines});
describe('inventory count catalog scope',()=>{
 for(const type of ['cycle','spot'] as const)it(`accepts a bounded ${type} subset and derives stock/cost on the server`,async()=>{const{context,rpc}=setup();await submitInventoryCount(context,input(type));expect(rpc).toHaveBeenCalledWith('submit_inventory_count',expect.objectContaining({p_count_type:type,p_lines:[{inventory_item_id:id.one,unit_id:id.unit,counted_quantity:2,expected_quantity:8,unit_cost_cents:100,notes:null}]}));});
 it('keeps full catalog coverage mandatory for a full count',async()=>{const{context,rpc}=setup();await expect(submitInventoryCount(context,input('full'))).rejects.toMatchObject({code:'conflict'});expect(rpc).not.toHaveBeenCalledWith('submit_inventory_count',expect.anything());await submitInventoryCount(context,input('full',[line(),line(id.two)]));expect(rpc).toHaveBeenCalledWith('submit_inventory_count',expect.objectContaining({p_lines:expect.arrayContaining([expect.objectContaining({inventory_item_id:id.two,expected_quantity:3})])}));});
 for(const [label,lines]of [['unknown or other-tenant item',[line('90000000-0000-4000-8000-000000000001')]],['wrong base unit',[line(id.one,'90000000-0000-4000-8000-000000000001')]],['duplicate item',[line(),line()]]] as const)it(`rejects ${label} without posting`,async()=>{const{context,rpc}=setup();await expect(submitInventoryCount(context,input('cycle',[...lines]))).rejects.toMatchObject({code:'conflict'});expect(rpc).not.toHaveBeenCalledWith('submit_inventory_count',expect.anything());});
});
