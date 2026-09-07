"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessageSquare, Phone, Plus, RefreshCw, Send, Voicemail } from "lucide-react";
import { Button } from "@/components/ui/button";

type Message={sid:string;from:string;to:string;body:string;status:string;direction:string;at:string;mediaCount:number;errorCode:number|null};
type Call={sid:string;from:string;to:string;status:string;duration:string;at:string};
type Voice={id:string;from?:string;recordingSid?:string;durationSeconds?:number;at:string};
type Model={business:string;smsEnabled:boolean;callsEnabled:boolean;messages:Message[];calls:Call[];voicemails:Voice[]};
const field="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";
function number(value:string){const digits=value.replace(/\D/g,"");return digits.length===10?`+1${digits}`:value.startsWith("+")?`+${digits}`:`+${digits}`;}
function date(at:string){return new Date(at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZone:"America/New_York"});}
export function PhoneWorkspace({live,defaultStaff}:{live:boolean;defaultStaff:"donald"|"maris"}) {
  const [model,setModel]=useState<Model|null>(null);const [selected,setSelected]=useState("");
  const [tab,setTab]=useState<"texts"|"calls"|"voicemail">("texts");const [draft,setDraft]=useState("");
  const [newNumber,setNewNumber]=useState("");const [creating,setCreating]=useState(false);
  const [consent,setConsent]=useState(false);const [staff,setStaff]=useState(defaultStaff);
  const [notice,setNotice]=useState("");const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(false);
  const [threadMessages,setThreadMessages]=useState<Message[]|null>(null);
  const history=useRef<HTMLDivElement>(null);
  const pending=useRef<{fingerprint:string;id:string}|null>(null);
  const mounted=useRef(true);
  const refresh=useCallback(async()=>{
    if(!live) return;
    try {const response=await fetch("/api/phone",{cache:"no-store"});if(!response.ok) throw Error("Phone history is unavailable. Check your sign-in and try again.");const data=await response.json();if(mounted.current)setModel(data);}
    catch(e){if(mounted.current)setNotice(e instanceof Error?e.message:"Could not refresh.");}
  },[live]);
  useEffect(()=>{mounted.current=true;const initial=setTimeout(()=>void refresh(),0);const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},15000);return()=>{mounted.current=false;clearTimeout(initial);clearInterval(timer);};},[refresh]);
  useEffect(()=>{if(!selected||!live)return;let active=true;fetch(`/api/phone?phone=${encodeURIComponent(selected)}`,{cache:"no-store"}).then(async r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(active)setThreadMessages(data.messages);}).catch(()=>{});return()=>{active=false;};},[selected,live,model]);
  const conversations=useMemo(()=>{const map=new Map<string,Message>();for(const m of model?.messages??[]){map.set(m.direction==="outbound"?m.to:m.from,m);}return [...map.entries()].sort((a,b)=>b[1].at.localeCompare(a[1].at));},[model]);
  const messages=threadMessages??(model?.messages??[]).filter(m=>m.from===selected||m.to===selected);
  const lastMessage=messages.at(-1)?.sid;
  useEffect(()=>{if(history.current)history.current.scrollTop=history.current.scrollHeight;},[selected,lastMessage]);
  async function submit(action:"sms"|"call") {
    if(busy||!selected)return;
    const input={action,to:selected,...(action==="sms"?{body:draft,consent}:{staff})};
    const fingerprint=JSON.stringify(input);if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,id:crypto.randomUUID()};
    setBusy(true);setNotice("");
    try {const response=await fetch("/api/phone",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...input,requestId:pending.current.id})});const data=await response.json();
      if(!response.ok) throw Error(data.error||"Request failed. Check history before retrying.");
      if(data.status==="pending"||data.status==="uncertain"){setNotice("This request is still being checked. Refresh history before starting another.");return;}
      pending.current=null;
      setNotice(action==="call"?"Your cellphone will ring. Answer and press 1 to connect. The recipient sees Le Yard.":`Text ${data.status}. Delivery status updates in this conversation.`);
      if(action==="sms")setDraft("");await refresh();
    }catch(e){setNotice(e instanceof Error?e.message:"Request result uncertain. Check history before retrying.");}finally{setBusy(false);}
  }
  function openConversation(phone:string){setThreadMessages(null);setSelected(phone);setConsent(false);setDraft("");setCreating(false);setTab("texts");setNotice("");pending.current=null;}
  return <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-7 sm:py-7">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-6">
      <div><p className="eyebrow">Le Yard · Shared phone</p><h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">(332) 877-9035</h1><p className="mt-2 max-w-xl text-sm text-[var(--ink-faint)]">Calls ring your cellphones. Send texts and make business calls here.</p></div>
      <div className="flex gap-2"><Button variant="quiet" aria-label="Refresh phone history" disabled={loading} onClick={async()=>{setLoading(true);await refresh();setLoading(false);}}><RefreshCw className={`size-4 ${loading?"animate-spin":""}`}/></Button><Button variant="accent" onClick={()=>{setCreating(true);setSelected("");setTab("texts");}}><Plus className="size-4"/>New conversation</Button></div>
    </header>
    {!live?<p className="my-5 text-sm">The phone is available in the live owner workspace. Demo mode cannot send calls or texts.</p>:null}
    <nav aria-label="Phone views" className="flex gap-2 border-b border-[var(--line)] py-3">{([["texts","Texts",MessageSquare],["calls","Calls",Phone],["voicemail","Voicemail",Voicemail]] as const).map(([key,label,Icon])=><Button key={key} variant={tab===key?"primary":"quiet"} onClick={()=>setTab(key)} aria-pressed={tab===key}><Icon className="size-4"/>{label}</Button>)}</nav>
    {notice?<p role="status" className="my-3 rounded-xl bg-[var(--canvas-strong)] px-4 py-3 text-sm">{notice}</p>:null}
    {creating?<form className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] py-5" onSubmit={e=>{e.preventDefault();const normalized=number(newNumber);if(!/^\+1[2-9]\d{9}$/.test(normalized)){setNotice("Enter a valid US or Canadian phone number.");return;}if(normalized===model?.business){setNotice("Enter the other person's number.");return;}openConversation(normalized);}}><label className="min-w-56 flex-1 text-sm">Phone number<input className={`${field} mt-2`} type="tel" autoFocus value={newNumber} onChange={e=>setNewNumber(e.target.value)} placeholder="(212) 555-0123" required/></label><Button type="submit">Open conversation</Button><Button variant="quiet" onClick={()=>setCreating(false)}>Cancel</Button></form>:null}
    {tab==="texts"?<div className="grid min-h-[480px] md:grid-cols-[280px_minmax(0,1fr)]">
      <aside aria-label="Conversations" className={`${selected?"hidden md:block":""} border-[var(--line)] md:border-r`}>
        <p className="px-3 py-4 text-xs text-[var(--ink-faint)]">Recent conversations · shared by Donald and Maris</p>
        {conversations.map(([phone,m])=><button key={phone} className={`block w-full border-b border-[var(--line)] px-3 py-4 text-left transition-colors hover:bg-[var(--canvas-strong)] ${selected===phone?"bg-[var(--canvas-strong)]":""}`} onClick={()=>openConversation(phone)}><span className="block text-sm font-semibold">{phone}</span><span className="mt-1 block truncate text-sm text-[var(--ink-faint)]">{m.direction==="outbound"?"You: ":""}{m.body||"Attachment"}</span><span className="mt-2 block text-xs text-[var(--ink-faint)]">{date(m.at)}</span></button>)}
        {!conversations.length?<p className="px-3 py-7 text-sm text-[var(--ink-faint)]">{model?"No texts yet. Start a conversation above.":"Loading shared history…"}</p>:null}
      </aside>
      <section aria-label="Selected conversation" className={`${!selected?"hidden md:flex md:items-center md:justify-center":"flex"} min-w-0 flex-col md:pl-6`}>
        {!selected?<p className="text-sm text-[var(--ink-faint)]">Choose a conversation or start a new one.</p>:<>
          <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] py-4"><Button variant="quiet" size="icon" className="md:hidden" aria-label="Back to conversations" onClick={()=>setSelected("")}><ArrowLeft className="size-4"/></Button><h2 className="flex-1 text-lg font-semibold">{selected}</h2><label className="text-xs">Ring<select className="ml-2 min-h-11 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 text-sm" value={staff} onChange={e=>setStaff(e.target.value as "donald"|"maris")}><option value="donald">Donald</option><option value="maris">Maris</option></select></label><Button disabled={busy||!model?.callsEnabled} variant="secondary" onClick={()=>void submit("call")}><Phone className="size-4"/>Call from Le Yard</Button></div>
          <div ref={history} className="flex max-h-[52svh] min-h-52 flex-1 flex-col gap-4 overflow-y-auto py-5" aria-label="Text history">{messages.map(m=><article key={m.sid} className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm ${m.direction==="outbound"?"ml-auto bg-[var(--accent-soft)]":"mr-auto bg-[var(--canvas-strong)]"}`}><p className="whitespace-pre-wrap break-words">{m.body}</p>{Array.from({length:Math.min(m.mediaCount,10)},(_,i)=><a key={i} className="mt-2 block underline" href={`/api/phone/media?message=${m.sid}&index=${i}`} target="_blank" rel="noreferrer">Open attachment {i+1}</a>)}<p className="mt-2 text-xs text-[var(--ink-faint)]">{date(m.at)} · {m.status}{m.errorCode?` · error ${m.errorCode}`:""}</p></article>)}{!messages.length?<p className="text-sm text-[var(--ink-faint)]">No texts with this number yet.</p>:null}</div>
          <form className="border-t border-[var(--line)] py-4" onSubmit={e=>{e.preventDefault();void submit("sms");}}><label className="sr-only" htmlFor="phone-message">Message</label><textarea id="phone-message" className={`${field} min-h-24 resize-y`} value={draft} onChange={e=>setDraft(e.target.value)} maxLength={1200} placeholder="Message from Le Yard…" required/><label className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--ink-faint)]"><input type="checkbox" className="mt-1 size-4" checked={consent} onChange={e=>setConsent(e.target.checked)}/>The recipient agreed to guest-care texts about this request. Required for a new conversation; never use this number for unsolicited marketing.</label><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-[var(--ink-faint)]">From Le Yard · {draft.length}/1200</p><Button type="submit" variant="accent" disabled={busy||!draft.trim()||!model?.smsEnabled}><Send className="size-4"/>{busy?"Submitting…":"Send text"}</Button></div>{!model?.smsEnabled?<p className="mt-2 text-xs text-[var(--ink-faint)]">Text sending is awaiting activation.</p>:null}</form>
        </>}
      </section>
    </div>:tab==="calls"?<section aria-label="Call history" className="divide-y divide-[var(--line)]">{model?.calls.map(c=><div key={c.sid} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="text-sm font-semibold">{c.to===model.business?"Incoming from":"Outgoing to"} {c.to===model.business?c.from:c.to}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{date(c.at)} · {c.status} · {c.duration}s</p></div><Button variant="quiet" onClick={()=>openConversation(c.to===model.business?c.from:c.to)}>Open conversation</Button></div>)}{!model?.calls.length?<p className="py-8 text-sm text-[var(--ink-faint)]">No calls in the recent history.</p>:null}</section>:<section aria-label="Voicemail" className="divide-y divide-[var(--line)]">{model?.voicemails.map(v=><div key={v.id} className="py-5"><p className="text-sm font-semibold">{v.from||"Unknown caller"}</p><p className="my-2 text-xs text-[var(--ink-faint)]">{date(v.at)} · {v.durationSeconds??0}s</p>{v.recordingSid?<audio controls preload="none" src={`/api/phone/media?recording=${v.recordingSid}`} className="max-w-full"/>:null}</div>)}{!model?.voicemails.length?<p className="py-8 text-sm text-[var(--ink-faint)]">No voicemail yet.</p>:null}</section>}
    <footer className="mt-6 border-t border-[var(--line)] pt-4 text-xs leading-5 text-[var(--ink-faint)]">Save this page to your phone’s Home Screen. Use this workspace for outgoing calls and texts; your regular Phone and Messages apps use your personal number. History refreshes every 15 seconds while open.</footer>
  </div>;
}
