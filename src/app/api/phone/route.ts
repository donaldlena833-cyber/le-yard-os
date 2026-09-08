import { setCommunicationThreadMode } from "@/lib/communication-groups.server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { requirePhoneAccess } from "@/lib/phone-access.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasServiceSmsConsent, recordServiceSmsConsent } from "@/lib/communications.server";
import { createTwilioCall, normalizeE164, sendTwilioMessage, twilioAbsoluteUrl, twilioForwardNumbers, twilioPhoneNumber, twilioRestClient, twilioSmsEnabled } from "@/lib/twilio.server";

const headers = { "cache-control": "private, no-store" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
function failure(error: unknown) {
  if (error instanceof Response) return error;
  return json({ error: "The phone service could not complete this request. Refresh the history before retrying." }, 503);
}
export async function GET(request: Request) {
  try {
    const w = await requirePhoneAccess();
    const business = twilioPhoneNumber();
    const selected = new URL(request.url).searchParams.get("phone");
    const phone = selected ? normalizeE164(selected) : undefined;
    const client = twilioRestClient();
    const [incoming, outgoing, callsIn, callsOut, voicemail] = await Promise.all([
      client.messages.list({ to: business, ...(phone ? { from: phone } : {}), limit: 60 }),
      client.messages.list({ from: business, ...(phone ? { to: phone } : {}), limit: 60 }),
      phone ? Promise.resolve([]) : client.calls.list({ to: business, limit: 40 }),
      phone ? Promise.resolve([]) : client.calls.list({ from: business, limit: 40 }),
      phone ? Promise.resolve({ data: [], error: null }) : createAdminClient().from("integration_events").select("id,metadata,occurred_at")
        .eq("organization_id", w.organization.id).eq("event_type", "voice.voicemail")
        .order("occurred_at", { ascending: false }).limit(30),
    ]);
    if (voicemail.error) throw new Error("Voicemail history unavailable");
    return json({ business, smsEnabled: twilioSmsEnabled(), callsEnabled: process.env.TWILIO_OUTBOUND_ENABLED === "true",
      messages: [...incoming, ...outgoing].map(m => ({ sid: m.sid, from: m.from, to: m.to, body: m.body,
        status: m.status, errorCode: m.errorCode, direction: m.from === business ? "outbound" : "inbound",
        at: (m.dateSent ?? m.dateCreated)?.toISOString(), mediaCount: Number(m.numMedia) || 0,
      })).sort((a,b) => (a.at ?? "").localeCompare(b.at ?? "")),
      calls: [...callsIn,...callsOut].filter(c => !c.parentCallSid).map(c => ({ sid:c.sid,from:c.from,to:c.to,status:c.status,duration:c.duration,at:c.dateCreated?.toISOString() })).sort((a,b)=>(b.at??"").localeCompare(a.at??"")),
      voicemails: voicemail.data.map(v => ({id:v.id,at:v.occurred_at,...(v.metadata as Record<string,unknown>)})),
    });
  } catch(error) { return failure(error); }
}
const schema = z.object({ action:z.enum(["sms","call"]), requestId:z.string().uuid(), to:z.string().max(32),
  body:z.string().trim().max(1200).optional(), staff:z.enum(["donald","maris"]).optional(), consent:z.boolean().optional(), attachments:z.array(z.string().max(200)).max(3).optional() }).strict();

export async function POST(request: Request) {
  let claimed = false;
  let requestId = "";
  try {
    if (request.headers.get("origin") !== new URL(process.env.NEXT_PUBLIC_APP_URL!).origin) return json({error:"Forbidden"},403);
    const w = await requirePhoneAccess();
    const parsed = schema.safeParse(await request.json().catch(()=>null));
    if (!parsed.success) return json({error:"Check the phone number and message."},400);
    const input = parsed.data;
    let to: string;
    try { to=normalizeE164(input.to); } catch { return json({error:"Enter a number with its country code."},400); }
    if (!/^\+1[2-9]\d{9}$/.test(to) || to===twilioPhoneNumber()) return json({error:"Use a +1 destination other than the Le Yard number."},400);
    if (input.action==="sms" && (!twilioSmsEnabled() || (!input.body && !input.attachments?.length))) return json({error:"Texting is not enabled or the message is empty."},400);
    if (input.action==="call" && (process.env.TWILIO_OUTBOUND_ENABLED!=="true" || !input.staff)) return json({error:"Calling is not enabled or no cellphone was selected."},400);
    if (input.action==="call" && input.staff && twilioForwardNumbers()[input.staff]===to) return json({error:"Choose a destination different from the cellphone receiving your callback."},400);
    const admin = createAdminClient();
    const organizationId=w.organization.id; requestId=input.requestId;
    const fingerprint=createHash("sha256").update(JSON.stringify({...input,to,requestId:undefined})).digest("hex");
    // Private Storage provides atomic create-if-absent claims without a schema change.
    const bucket = admin.storage.from("phone-outbox");
    const path = `${organizationId}/${requestId}.json`;
    const {data:previous,error:lookupError}=await bucket.download(path);
    if (lookupError && !/not found|does not exist/i.test(lookupError.message)) throw new Error("Outbox unavailable");
    if(previous) {
      const meta=JSON.parse(await previous.text()) as Record<string,unknown>;
      if(meta.fingerprint!==fingerprint || meta.userId!==w.identity.userId) return json({error:"This request ID was already used."},409);
      return json({status:meta.status,sid:meta.sid??null,replayed:true,error:meta.status==="uncertain"?"Check the history before sending again.":undefined},meta.status==="uncertain"?409:200);
    }
    const {count,error:rateError}=await admin.from("integration_events").select("id",{count:"exact",head:true}).eq("organization_id",organizationId).eq("event_type","phone.outbound.request")
      .contains("metadata",{userId:w.identity.userId}).gte("occurred_at",new Date(Date.now()-60000).toISOString());
    if(rateError) throw new Error("Request history unavailable");
    if((count??0)>=10) return json({error:"Please wait a minute before sending more."},429);
    if(input.action==="sms" && !await hasServiceSmsConsent(to)) {
      if(!input.consent) return json({error:"Record the recipient's permission before sending guest-care texts."},400);
      await recordServiceSmsConsent({phone:to,evidence:`Explicit guest-care permission confirmed by operator ${w.identity.userId}; request ${requestId}.`});
    }
    const mediaUrls: string[] = [];
    let mediaBytes = 0;
    for (const path of input.attachments ?? []) {
      const prefix = `${organizationId}/${w.identity.userId}/`;
      if (!path.startsWith(prefix) || !/^[0-9a-f-]{36}\.(png|jpg)$/.test(path.slice(prefix.length))) return json({error:"Attachment does not belong to this operator."},403);
      const attachment = await admin.storage.from("phone-attachments").info(path);
      if (attachment.error || !attachment.data || !attachment.data.size || !['image/png','image/jpeg'].includes(attachment.data.contentType ?? '')) return json({error:"Attachment unavailable or unsupported."},400);
      mediaBytes += attachment.data.size;
      if(mediaBytes>4_000_000)return json({error:"Combined MMS images must be smaller than 4 MB."},400);
      const result = await admin.storage.from("phone-attachments").createSignedUrl(path, 3600);
      if (result.error || !result.data) throw new Error("Attachment unavailable");
      mediaUrls.push(result.data.signedUrl);
    }
    const meta={fingerprint,userId:w.identity.userId,to,action:input.action,status:"pending"};
    const {error:claimError}=await bucket.upload(path,JSON.stringify(meta),{contentType:"application/json",upsert:false});
    if(claimError) return json({error:"Request already submitted or history unavailable. Refresh before retrying."},409);
    claimed=true;
    const {error:logError}=await admin.from("integration_events").insert({organization_id:organizationId,event_type:"phone.outbound.request",severity:"info",message:"Staff phone request",metadata:{...meta,requestId}});
    if(logError) throw new Error("Request log unavailable");
    let result:{sid:string,status:string};
    if(input.action==="sms") {
      await setCommunicationThreadMode(to,"human","An operator replied from Le Yard OS.");
      result=await sendTwilioMessage(to,input.body??"",{actorId:w.identity.userId,...(mediaUrls.length?{mediaUrls}:{})});
    }
    else {
      const url=new URL(twilioAbsoluteUrl("/api/twilio/voice/outbound-bridge"));
      url.searchParams.set("to",to);url.searchParams.set("staff",input.staff!);
      result=await createTwilioCall({to:twilioForwardNumbers()[input.staff!],url:url.toString()});
    }
    // Never report a carrier-accepted operation as failed because local bookkeeping failed.
    await bucket.upload(path,JSON.stringify({...meta,status:result.status,sid:result.sid}),{contentType:"application/json",upsert:true});
    return json({sid:result.sid,status:result.status},201);
  } catch(error) {
    if(claimed) {
      // Preserve the claim: an ambiguous network result must not generate a duplicate SMS/call.
      console.error("phone_outbound_result_uncertain");
      return json({error:"Delivery result is uncertain. Check history before starting a new request.",status:"uncertain",requestId},503);
    }
    return failure(error);
  }
}
