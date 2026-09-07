import { requirePhoneAccess } from "@/lib/phone-access.server";
import { twilioAccountSid, twilioAuthToken, twilioPhoneNumber, twilioRestClient } from "@/lib/twilio.server";
export async function GET(request:Request) {
  try {
    await requirePhoneAccess();
    const query=new URL(request.url).searchParams;
    const recording=query.get("recording");const message=query.get("message");
    const c=twilioRestClient();const number=twilioPhoneNumber();
    let url:string;let contentType="audio/mpeg";
    if(recording && /^RE[0-9a-f]{32}$/i.test(recording)) {
      const r=await c.recordings(recording).fetch();const call=await c.calls(r.callSid).fetch();
      if(call.from!==number && call.to!==number) return new Response("Forbidden",{status:403});
      url=`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid()}/Recordings/${recording}.mp3`;
    } else if(message && /^(SM|MM)[0-9a-f]{32}$/i.test(message)) {
      const m=await c.messages(message).fetch();if(m.from!==number && m.to!==number) return new Response("Forbidden",{status:403});
      const media=await c.messages(message).media.list({limit:10});
      const index=Number(query.get("index")??0);if(!Number.isInteger(index)||index<0||!media[index]) return new Response("Not found",{status:404});
      const item=media[index];contentType=item.contentType;
      if(!/^(image\/(jpeg|png|gif|webp)|audio\/(mpeg|mp4|ogg|wav)|application\/pdf)$/.test(contentType)) return new Response("Unsupported attachment type",{status:415});
      url=`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid()}/Messages/${message}/Media/${item.sid}`;
    } else return new Response("Invalid media",{status:400});
    const result=await fetch(url,{headers:{Authorization:`Basic ${Buffer.from(`${twilioAccountSid()}:${twilioAuthToken()}`).toString("base64")}`},cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(!result.ok) return new Response("Media temporarily unavailable",{status:502});
    return new Response(result.body,{headers:{"content-type":contentType,"cache-control":"private, no-store","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; sandbox"}});
  } catch(error) { return error instanceof Response?error:new Response("Media unavailable",{status:503}); }
}
