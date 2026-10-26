import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(process.env.LOCAL_READINESS_FIXTURE_PATH!,'utf8'));
if(fixture.classification!=='isolated_local_synthetic_nonproduction'||fixture.api!=='http://127.0.0.1:55421')throw Error('Unsafe fixture');
test('Square appears as a separate source adapter with honest setup and reconciliation boundaries',async({page,request})=>{
 const health=await request.get('/api/health');expect(health.status()).toBe(200);expect(await health.json()).toMatchObject({status:'ready',readiness:'ok'});
 await page.goto('/sign-in');await page.getByLabel('Username or work email').fill(fixture.users.Owner.email);await page.locator('input[name="password"]').fill(fixture.users.Owner.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Today',level:1,exact:true})).toBeVisible();
 await page.goto('/integrations');const square=page.getByRole('button',{name:'Square integration details',exact:true});await expect(square).toBeVisible();await expect(square).toContainText('Disabled');await expect(page.getByRole('button',{name:'Toast integration details',exact:true})).toHaveCount(0);await square.click();
 const drawer=page.getByRole('dialog',{name:'Square',exact:true});await expect(drawer).toBeVisible();await expect(drawer).toContainText('Sandbox rehearsal only');await expect(drawer).toContainText('financial reconciliation');await expect(drawer).toContainText('Read source evidence');await expect(drawer).not.toContainText('Write schedules or punches');
 const unauthorized=await request.post('/api/internal/integrations/square-source',{data:{}});expect(unauthorized.status()).toBe(401);const retired=await request.post('/api/internal/integrations/toast-labor',{data:{}});expect(retired.status()).toBe(410);expect(unauthorized.headers()['cache-control']?.split(',').map(value=>value.trim())).toContain('no-store');
 await page.screenshot({path:'/Users/donaldlena/Documents/Codex/2026-10-24/g/outputs/evidence/square-integration-browser.png',fullPage:true});
 await page.goto('/time-clock');await expect(page.getByRole('heading',{name:'Attendance source not configured',exact:true})).toBeVisible();await expect(page.locator('main')).not.toContainText('Toast');await page.screenshot({path:'/Users/donaldlena/Documents/Codex/2026-10-24/g/outputs/evidence/attendance-source-pending-browser.png',fullPage:true});
});
