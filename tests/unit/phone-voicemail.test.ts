import {expect,it,vi} from "vitest";
vi.mock("@/lib/communications.server",()=>({logCommunicationEvent:vi.fn()}));
vi.mock("@/lib/twilio.server",()=>({readTwilioForm:async(r:Request)=>({params:new URLSearchParams(await r.text())}),validateTwilioRequest:()=>true,twilioSmsEnabled:()=>false,twilioAbsoluteUrl:(p:string)=>`https://operations.leyardny.com${p}`,xmlResponse:(x:string)=>new Response(x)}));
import {POST} from "@/app/api/twilio/voice/result/route";
function request(bridged:string,status:string){return new Request('https://operations.leyardny.com/api/twilio/voice/result',{method:'POST',body:new URLSearchParams({DialBridged:bridged,DialCallStatus:status})});}
it('offers voicemail if a completed dial leg did not bridge a human',async()=>{expect(await (await POST(request('false','completed'))).text()).toContain('<Record');});
it('does not offer voicemail after a successfully bridged call',async()=>{const text=await (await POST(request('true','completed'))).text();expect(text).not.toContain('<Record');expect(text).toContain('<Hangup');});
