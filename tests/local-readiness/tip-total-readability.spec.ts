import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const f=JSON.parse(readFileSync(process.env.LOCAL_READINESS_FIXTURE_PATH!,'utf8'));
const c=JSON.parse(readFileSync(process.env.LOCAL_READINESS_TIP_CONTROL_PATH!,'utf8'));
if(f.classification!=='isolated_local_synthetic_nonproduction'||c.classification!==f.classification||f.api!=='http://127.0.0.1:55421'||c.selectedControl.currencyCode!=='USD')throw Error('Unsafe fixture');
const control=c.selectedControl;
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:cents%100===0?0:2}).format(cents/100);
for(const width of [390,768,1440,1920]){
 test.describe(`${width}px`,()=>{
  test.use({viewport:{width,height:1000}});
  for(const stress of [false,true])test(stress?'long synthetic DOM values remain fully visible without changing records':'retained approved tip control totals remain fully visible',async({page},info)=>{
   await page.goto('/sign-in');await page.getByLabel('Username or work email').fill(f.users.Owner.email);await page.locator('input[name="password"]').fill(f.users.Owner.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Today',level:1,exact:true})).toBeVisible();await page.goto('/closeout');await expect(page.getByRole('heading',{name:'Money',level:1,exact:true})).toBeVisible();
   const totals=page.locator('dl[aria-label="Tip run control totals"]');await expect(totals).toBeVisible();await expect(totals.locator('dt')).toHaveText(['Distributable','Allocated','Participants','Service charge']);
   const values=totals.locator('[data-slot="tip-control-value"]');const retained=[money(control.distributableCents),money(control.allocatedCents),String(control.participants),money(control.serviceChargeCents)];await expect(values).toHaveText(retained);
   const expected=stress?['$90,071,992,547,409.91','$75,000,001.23','999,999','$1,234,567.89']:retained;
   // This changes only rendered text to stress the real component's layout.
   // No source totals, approvals, employee records or API responses are altered.
   if(stress)await values.evaluateAll((elements,amounts)=>{elements.forEach((element,index)=>{element.textContent=amounts[index];});},expected);
   await page.evaluate(async()=>{await document.fonts.ready;});await expect(values).toHaveText(expected);
   const geometry=await values.evaluateAll(elements=>elements.map(element=>{
    const value=element as HTMLElement,rect=value.getBoundingClientRect(),style=getComputedStyle(value),range=document.createRange();range.selectNodeContents(value);const textRects=Array.from(range.getClientRects()).map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom}));return{text:value.textContent,width:rect.width,height:rect.height,clientWidth:value.clientWidth,scrollWidth:value.scrollWidth,clientHeight:value.clientHeight,scrollHeight:value.scrollHeight,textOverflow:style.textOverflow,whiteSpace:style.whiteSpace,textFits:textRects.every(r=>r.left>=rect.left-2&&r.right<=rect.right+2&&r.top>=rect.top-2&&r.bottom<=rect.bottom+2),fitsViewport:textRects.every(r=>r.left>=-2&&r.right<=window.innerWidth+2),hasLayout:rect.width>0&&rect.height>0};
   }));
   for(const measurement of geometry){expect(measurement.hasLayout).toBe(true);expect(measurement.textFits,JSON.stringify(measurement)).toBe(true);expect(measurement.fitsViewport,JSON.stringify(measurement)).toBe(true);expect(measurement.scrollWidth).toBeLessThanOrEqual(measurement.clientWidth+2);expect(measurement.scrollHeight).toBeLessThanOrEqual(measurement.clientHeight+2);expect(measurement.textOverflow).not.toBe('ellipsis');}
   const allocationGeometry=[];
   for(const allocation of c.allocations){
    const row=page.getByRole('group',{name:`Tip allocation for ${allocation.employeeName}`,exact:true});await expect(row).toBeVisible();await expect(row.locator('dd')).toHaveText([money(allocation.finalCents),`${money(allocation.baseCents)} base`]);
    const name=await row.getByText(allocation.employeeName,{exact:true}).evaluate(element=>{const r=element.getBoundingClientRect(),style=getComputedStyle(element);return{text:element.textContent,width:r.width,height:r.height,lineHeight:parseFloat(style.lineHeight),clientWidth:element.clientWidth,scrollWidth:element.scrollWidth};});
    expect(name.height).toBeLessThanOrEqual(name.lineHeight*2+2);expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth+2);
    const amounts=await row.locator('dd').evaluateAll(elements=>elements.map(element=>({text:element.textContent,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,textOverflow:getComputedStyle(element).textOverflow})));for(const amount of amounts){expect(amount.scrollWidth).toBeLessThanOrEqual(amount.clientWidth+2);expect(amount.textOverflow).not.toBe('ellipsis');}allocationGeometry.push({name,amounts});
   }
   await expect(page.getByRole('main')).toHaveCount(1);await info.attach('tip-total-geometry',{body:JSON.stringify({classification:f.classification,width,dataset:stress?'synthetic_rendered_text_only':'actual_retained_database_controls',selectedTipRunId:control.tipRunId,expected,geometry,allocationGeometry,financialPosting:false}),contentType:'application/json'});
   if(!stress)await page.screenshot({path:`/Users/donaldlena/Documents/Codex/2026-10-24/g/outputs/evidence/tip-total-readability-${width}.png`,fullPage:true});
   if(stress&&width===1440)await page.screenshot({path:'/Users/donaldlena/Documents/Codex/2026-10-24/g/work/tip-total-readability-large-1440.private.png',fullPage:true});
  });
 });
}
