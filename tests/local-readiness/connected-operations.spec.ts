import {test,expect,type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";

const fixture=JSON.parse(readFileSync(process.env.LOCAL_READINESS_FIXTURE_PATH!,"utf8"));
if(fixture.classification!=="isolated_local_synthetic_nonproduction"||fixture.api!=="http://127.0.0.1:55421") {
  throw new Error("Refusing a non-synthetic or non-loopback fixture.");
}
async function signIn(page:Page,role:string){
  const identity=fixture.users[role];
  await page.goto("/sign-in");
  await page.getByRole("heading",{name:"Welcome back."}).waitFor();
  await page.getByLabel("Username or work email").fill(identity.email);
  await page.locator('input[name="password"]').fill(identity.password);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page).toHaveURL(/\/today(?:\?|$)/);
  await expect(page.getByRole("heading",{name:"Today",level:1,exact:true})).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Playground");
}

test("isolated connected deployment reports an exact ready schema",async({request})=>{
  const response=await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({status:"ready",readiness:"ok"});
});

for(const role of Object.keys(fixture.users)){
  test(`${role} signs in through real local Auth, retains the right location and signs out`,async({page,context})=>{
    await signIn(page,role);
    await expect(page.getByText(role==="CrossLocation"?"Sandbox Other Room":"Sandbox Dining Room",{exact:true}).first()).toBeVisible();
    const storage=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes("readiness-session-sentinel")));
    expect(storage).toEqual([]);
    await page.evaluate(()=>localStorage.setItem("readiness-session-sentinel","one-context-only"));
    await page.reload();
    await expect(page).toHaveURL(/\/today(?:\?|$)/);
    await page.getByRole("button",{name:"Log out",exact:true}).click();
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
    expect((await context.cookies()).filter(c=>c.name.startsWith("sb-")&&c.name.includes("auth-token"))).toEqual([]);
    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  });
}

for(const [role,read,operate] of [
  ["Owner",true,true],["Manager",true,true],["Host",true,true],
  ["ViewOnly",true,false],["OperateOnly",true,true],
  ["Denied",false,false],["Expired",false,false],["Employee",false,false],["Chef",false,false],
] as const){
  test(`${role} has the exact reservation access assigned by the local fixture`,async({page})=>{
    await signIn(page,role);
    await page.goto("/reservations");
    if(!read){await expect(page).toHaveURL(/\/today(?:\?|$)/);return;}
    await expect(page).toHaveURL(/\/reservations(?:\?|$)/);
    const book=page.getByRole("button",{name:"Book",exact:true});
    if(operate)await expect(book).toBeEnabled();else await expect(book).toBeDisabled();
  });
}

test("Owner reads the connected operating workspaces without demo fallbacks",async({page})=>{
  await signIn(page,"Owner");
  for(const route of ["today","schedule","team","vendors","closeout","receipts","inventory","guests","tasks","reports","assistant","integrations","settings","service","time-clock","income","kitchen","phone"]){
    await test.step(route,async()=>{
      const response=await page.goto('/'+route,{waitUntil:"domcontentloaded"});
      expect(response?.status()).toBeLessThan(400);
      await expect(page.locator("main").first()).toBeVisible();
      await expect(page.locator("main").first()).not.toContainText("Something went wrong");
      await expect(page.locator("body")).not.toContainText("Synthetic preview");
    });
  }
});

test("a task saved by Owner reaches Manager through Realtime and survives a fresh session",async({browser},testInfo)=>{
  const a=await browser.newContext({baseURL:"http://localhost:3110",viewport:{width:1440,height:1000}});
  const b=await browser.newContext({baseURL:"http://localhost:3110",viewport:{width:1440,height:1000}});
  const owner=await a.newPage(),manager=await b.newPage();
  const title="READINESS ONLY — opening handoff "+randomUUID().slice(0,8);
  try{
    await signIn(owner,"Owner");await signIn(manager,"Manager");
    await owner.goto("/tasks");await manager.goto("/tasks");
    await owner.getByRole("button",{name:"Create task",exact:true}).first().click();
    const dialog=owner.getByRole("dialog",{name:"Create task"});
    await dialog.getByLabel("Task title").fill(title);
    await dialog.getByLabel("Description",{exact:true}).fill("Synthetic handoff: verify room reset and resolve before service. No real-world task.");
    const start=Date.now();
    await dialog.getByRole("button",{name:"Create task",exact:true}).click();
    await expect(dialog).toBeHidden();
    await expect(owner.getByText(title,{exact:true}).first()).toBeVisible();
    await expect(manager.getByText(title,{exact:true}).first()).toBeVisible({timeout:30_000});
    await testInfo.attach("realtime-observation",{body:JSON.stringify({elapsedMs:Date.now()-start,title,measured:true,localOnly:true}),contentType:"application/json"});
    await manager.reload();await expect(manager.getByText(title,{exact:true}).first()).toBeVisible();
    const fresh=await browser.newContext({baseURL:"http://localhost:3110"});
    try{const p=await fresh.newPage();await signIn(p,"Owner");await p.goto("/tasks");await expect(p.getByText(title,{exact:true}).first()).toBeVisible();}finally{await fresh.close();}
  }finally{await a.close();await b.close();}
});

test("mobile connected navigation and private session work at 390 pixels",async({page})=>{
  await page.setViewportSize({width:390,height:844});await signIn(page,"Manager");
  await page.getByRole("button",{name:"More",exact:true}).click();
  await expect(page.getByRole("navigation",{name:"Mobile navigation",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Close navigation",exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("Host books a synthetic guest, persists the record and cancels with an immutable revision",async({page})=>{
  await signIn(page,"Host");await page.goto("/reservations");
  const name="READINESS ONLY Guest "+randomUUID().slice(0,8);
  await page.getByRole("button",{name:"Book",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"New reservation"});
  await dialog.getByLabel("Guest name").fill(name);
  await dialog.getByLabel("Email",{exact:true}).fill("readiness.guest."+randomUUID().slice(0,8)+"@example.invalid");
  await dialog.getByRole("button",{name:"Save reservation",exact:true}).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  const row=page.getByRole("button",{name:new RegExp(name)}).first();
  await expect(row).toBeVisible();await row.click();
  await page.getByRole("button",{name:"Edit / reschedule",exact:true}).click();
  const edit=page.getByRole("dialog",{name:"Edit / reschedule",exact:true});
  await edit.getByLabel("Time",{exact:false}).first().fill("19:15");
  await expect(edit.getByLabel("Turn time",{exact:false})).toHaveValue("75");
  await expect(edit.getByLabel("Turn time",{exact:false})).toHaveAttribute("readonly", "");
  await edit.getByLabel("Reason for change").fill("Synthetic guest requests a later time; no actual guest contact.");
  await edit.getByRole("button",{name:"Review changes",exact:true}).click();
  const review=page.getByRole("dialog",{name:"Review reservation changes",exact:true});
  await review.getByRole("button",{name:"Save revision",exact:true}).click();
  await expect(review).toBeHidden();
  await expect(page.getByText(/Recorded edit revision 2/)).toBeVisible();
  await expect(page.getByText("Current record · version 2",{exact:true})).toBeVisible();
  await page.getByRole("group",{name:"Actions for "+name}).getByRole("button",{name:"Cancel",exact:true}).click();
  const cancel=page.getByRole("alertdialog",{name:"Cancel this reservation?"});
  await cancel.getByLabel("Cancellation reason").fill("Synthetic drill complete; no guest contact or physical booking.");
  await cancel.getByRole("button",{name:"Cancel reservation",exact:true}).click();
  await expect(cancel).toBeHidden();
  await expect(page.getByText(/Recorded cancellation revision 3/)).toBeVisible();
  await expect(page.getByText(/No guest message was queued/)).toBeVisible();
});

test("revised pre-shift reaches Employee and requires a fresh version-specific acknowledgement",async({browser},testInfo)=>{
  const a=await browser.newContext({baseURL:"http://localhost:3110"}),b=await browser.newContext({baseURL:"http://localhost:3110"});
  const owner=await a.newPage(),employee=await b.newPage(),note="READINESS brief "+randomUUID().slice(0,8),revision=note+" revised";
  try{
    await signIn(owner,"Owner");await signIn(employee,"Employee");await owner.goto("/service");await employee.goto("/service");
    await expect(employee).toHaveURL(/\/service(?:\?|$)/);
    async function publish(allergy:string){
      await owner.getByPlaceholder("Allergies",{exact:true}).fill(allergy);
      await owner.getByPlaceholder("Manager notes",{exact:true}).fill("READINESS PRIVATE "+note);
      await owner.getByLabel("Pre-shift publication status").selectOption("published");
      await owner.getByRole("button",{name:"Save pre-shift",exact:true}).click();await expect(owner.getByText(allergy,{exact:true})).toBeVisible();
    }
    const start=Date.now();await publish(note);
    const original=employee.locator("article").filter({has:employee.getByText(note,{exact:true})});
    await expect(original).toBeVisible({timeout:30000});
    await testInfo.attach("preshift-propagation",{body:JSON.stringify({elapsedMs:Date.now()-start,localOnly:true,measured:true}),contentType:"application/json"});
    await expect(original).toContainText(/Version \d+/);await expect(original).not.toContainText("You acknowledged this exact brief version.");
    await original.getByRole("button",{name:"I read this brief · Acknowledge",exact:true}).click();await expect(original).toContainText("You acknowledged this exact brief version.");
    await publish(revision);
    const latest=employee.locator("article").filter({has:employee.getByText(revision,{exact:true})});
    await expect(latest).toBeVisible({timeout:30000});await expect(latest).not.toContainText("You acknowledged this exact brief version.");
    await expect(latest.getByRole("button",{name:"I read this brief · Acknowledge",exact:true})).toBeEnabled();
    await expect(original).toContainText(/Replaced by version \d+/);await expect(original.getByRole("button",{name:"I read this brief · Acknowledge",exact:true})).toHaveCount(0);
    await expect(employee.locator("body")).not.toContainText("READINESS PRIVATE "+note);
    await latest.getByRole("button",{name:"I read this brief · Acknowledge",exact:true}).click();await expect(latest).toContainText("You acknowledged this exact brief version.");
    await employee.reload();await expect(employee.locator("article").filter({has:employee.getByText(revision,{exact:true})})).toContainText("You acknowledged this exact brief version.");
  }finally{await a.close();await b.close();}
});
