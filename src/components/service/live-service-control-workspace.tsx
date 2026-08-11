"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BookOpenCheck, Check, ClipboardPenLine, LoaderCircle, Plus, Radio } from "lucide-react";
import { acknowledgePreshiftAction, recordServiceAvailabilityAction, saveManagerLogAction, savePreshiftAction } from "@/app/actions/workflows/service-control";
import { Button } from "@/components/ui/button";
import { ConversationLog } from "@/components/ui/conversation-log";
import { PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveServiceControlModel } from "@/data/read-models/service-control";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/client";

const field = "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs outline-none focus:border-[var(--accent)]";
const area = `${field} min-h-24 py-3`;
const optional = (value: FormDataEntryValue | null) => String(value ?? "").trim() || null;
const numberOrNull = (value: FormDataEntryValue | null) => String(value ?? "").trim() ? Number(value) : null;
const sentence = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function LiveServiceControlWorkspace({ workspace, result }: { workspace: WorkspaceContextValue; result: LiveReadResult<LiveServiceControlModel> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (workspace.mode !== "live") return;
    const supabase = createClient();
    const channel = supabase.channel(`service-control:${workspace.activeLocation.id}`);
    for (const table of ["service_availability_events", "manager_log_entries", "preshifts", "preshift_acknowledgements"] as const) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `location_id=eq.${workspace.activeLocation.id}` }, () => router.refresh());
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [router, workspace.activeLocation.id, workspace.mode]);

  if (!result.ok) return <PageFrame><p role="alert" className="rounded-2xl bg-[var(--danger-soft)] p-5 text-sm text-[var(--danger)]">{result.message}</p></PageFrame>;
  const model = result.data;
  async function perform(action: Promise<{ ok: boolean; message?: string }>, success: string) {
    setBusy(true); setNotice("");
    try { const response = await action; if (!response.ok) setNotice(response.message ?? "The change could not be saved."); else { setNotice(success); router.refresh(); } }
    finally { setBusy(false); }
  }
  function availabilitySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void perform(recordServiceAvailabilityAction({ requestId: crypto.randomUUID(), locationId: workspace.activeLocation.id, subjectType: form.get("subjectType"), subjectLabel: form.get("subjectLabel"), status: form.get("status"), estimatedPortions: numberOrNull(form.get("estimatedPortions")), reason: optional(form.get("reason")), effectiveAt: new Date().toISOString(), expectedRestorationAt: null, notes: optional(form.get("notes")) }), "Availability updated for the whole team.");
  }
  function managerLogSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void perform(saveManagerLogAction({ requestId: crypto.randomUUID(), entryId: null, locationId: workspace.activeLocation.id, businessDate: model.date, servicePeriod: form.get("servicePeriod"), category: form.get("category"), severity: form.get("severity"), title: form.get("title"), narrative: form.get("narrative"), status: form.get("status"), resolution: null, dueDate: null }), "Manager handoff saved with version history.");
  }
  function preshiftSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void perform(savePreshiftAction({ requestId: crypto.randomUUID(), preshiftId: null, locationId: workspace.activeLocation.id, businessDate: model.date, servicePeriod: form.get("servicePeriod"), status: form.get("status"), bookedCovers: numberOrNull(form.get("bookedCovers")), projectedCovers: null, vipNotes: optional(form.get("vipNotes")), allergyNotes: optional(form.get("allergyNotes")), largePartyNotes: optional(form.get("largePartyNotes")), specials: optional(form.get("specials")), staffingNotes: optional(form.get("staffingNotes")), serviceGoal: optional(form.get("serviceGoal")), trainingPoint: optional(form.get("trainingPoint")), managerNotes: optional(form.get("managerNotes")) }), `Pre-shift ${form.get("status") === "published" ? "published" : "draft saved"}.`);
  }

  return <PageFrame>
    <section className="rounded-[26px] bg-[var(--graphite)] p-6 text-white sm:p-8"><div className="flex flex-wrap items-center gap-2"><StatusPill tone="positive" dot className="bg-white/[0.08] text-white">Realtime</StatusPill><span className="text-xs text-white/50">{workspace.activeLocation.name}</span></div><h2 className="mt-4 text-3xl font-medium tracking-[-0.05em]">Service control</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">Availability, shift handoff, and the published pre-shift—one shared operating picture without invented reservation data.</p></section>
    {notice ? <p role="status" className="mt-4 rounded-xl bg-[var(--accent-soft)] px-4 py-3 text-xs text-[var(--accent-strong)]">{notice}</p> : null}
    <section className="mt-8"><SectionHeading eyebrow="Live availability" title="Running low & 86" detail="Internal status only; Toast is not changed." />
      {model.canManageAvailability ? <form onSubmit={availabilitySubmit} className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 md:grid-cols-6"><select aria-label="Availability item type" name="subjectType" className={field}><option value="menu_item">Menu item</option><option value="component">Component</option></select><input required name="subjectLabel" placeholder="Item or component" className={`${field} md:col-span-2`} /><select aria-label="Availability status" name="status" className={field}><option value="running_low">Running low</option><option value="eighty_sixed">86</option><option value="restored">Restored</option><option value="available">Available</option></select><input name="estimatedPortions" type="number" min="0" step="0.001" placeholder="Portions" className={field} /><Button type="submit" variant="accent" disabled={busy}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Radio className="size-4" />}Update</Button><input name="reason" placeholder="Reason (optional)" className={`${field} md:col-span-3`} /><input name="notes" placeholder="Team note (optional)" className={`${field} md:col-span-3`} /></form> : null}
      <div className="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">{model.availability.map((item) => <div key={item.id} className="flex items-center gap-3 py-3"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{item.subjectLabel}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{item.reason || item.notes || "No note"}</span></span>{item.estimatedPortions != null ? <span className="numeric text-xs">{item.estimatedPortions} portions</span> : null}<StatusPill tone={item.status === "eighty_sixed" ? "danger" : item.status === "running_low" ? "warning" : "positive"}>{item.status === "eighty_sixed" ? "86" : sentence(item.status)}</StatusPill></div>)}{!model.availability.length ? <p className="py-8 text-center text-xs text-[var(--ink-faint)]">No availability events yet.</p> : null}</div>
    </section>
    <div className={`mt-9 grid gap-9 ${model.canManageLog ? "xl:grid-cols-2" : "max-w-3xl"}`}>
      {model.canManageLog ? <section><SectionHeading eyebrow="Handoff" title="Manager Log" detail="Unresolved entries carry into the next service." />
        <form onSubmit={managerLogSubmit} className="grid gap-3 rounded-2xl border border-[var(--line)] p-4 sm:grid-cols-2"><input required name="title" placeholder="Handoff title" className={`${field} sm:col-span-2`} /><textarea required name="narrative" placeholder="What happened and what needs follow-up?" className={`${area} sm:col-span-2`} /><select aria-label="Manager log service period" name="servicePeriod" className={field}><option value="dinner">Dinner</option><option value="lunch">Lunch</option><option value="all_day">All day</option><option value="other">Other</option></select><select aria-label="Manager log category" name="category" className={field}><option value="foh">FOH</option><option value="boh">BOH</option><option value="guest">Guest</option><option value="equipment">Equipment</option><option value="inventory">Inventory</option><option value="maintenance">Maintenance</option><option value="other">Other</option></select><select aria-label="Manager log severity" name="severity" className={field}><option value="awareness">Awareness</option><option value="action_required">Action required</option><option value="critical">Critical</option><option value="informational">Informational</option></select><select aria-label="Manager log status" name="status" className={field}><option value="needs_follow_up">Needs follow-up</option><option value="informational">Informational</option><option value="in_progress">In progress</option></select><Button type="submit" variant="secondary" disabled={busy} className="sm:col-span-2"><Plus className="size-4" />Add handoff</Button></form>
        <ConversationLog className="mt-4" label="Unresolved manager handoffs" entries={model.managerLog.map((entry) => ({ id: entry.id, summary: entry.title, body: entry.narrative, leading: <ClipboardPenLine className="size-4 text-[var(--accent-strong)]" />, context: <><span>{sentence(entry.category)}</span><span aria-hidden="true">·</span><span>{sentence(entry.servicePeriod)}</span><span aria-hidden="true">·</span><span>{entry.businessDate}</span></>, trailing: <StatusPill tone={entry.severity === "critical" ? "danger" : entry.severity === "action_required" ? "warning" : "neutral"}>{sentence(entry.severity)}</StatusPill> }))} empty="No unresolved handoffs." />
      </section> : null}
      <section><SectionHeading eyebrow="Before service" title="Pre-shift" detail="Publish facts; employees acknowledge what they read." />
        {model.canManagePreshift ? <form onSubmit={preshiftSubmit} className="grid gap-3 rounded-2xl border border-[var(--line)] p-4 sm:grid-cols-2"><select aria-label="Pre-shift service period" name="servicePeriod" className={field}><option value="dinner">Dinner</option><option value="lunch">Lunch</option><option value="all_day">All day</option></select><input name="bookedCovers" type="number" min="0" placeholder="Booked covers (if known)" className={field} /><textarea name="vipNotes" placeholder="VIP notes" className={area} /><textarea name="allergyNotes" placeholder="Allergies" className={area} /><textarea name="largePartyNotes" placeholder="Large parties" className={area} /><textarea name="specials" placeholder="Specials and 86 context" className={area} /><textarea name="staffingNotes" placeholder="Staffing notes" className={area} /><textarea name="serviceGoal" placeholder="Service goal" className={area} /><input name="trainingPoint" placeholder="Training point" className={`${field} sm:col-span-2`} /><textarea name="managerNotes" placeholder="Manager notes" className={`${area} sm:col-span-2`} /><select aria-label="Pre-shift publication status" name="status" className={field}><option value="draft">Save draft</option><option value="published">Publish now</option></select><Button type="submit" variant="accent" disabled={busy}><BookOpenCheck className="size-4" />Save pre-shift</Button></form> : null}
        <div className="mt-4 space-y-3">{model.preshifts.map((preshift) => <article key={preshift.id} className="rounded-2xl border border-[var(--line)] p-4"><div className="flex items-center gap-3"><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{sentence(preshift.servicePeriod)} · {preshift.businessDate}</span><span className="mt-1 block text-xs text-[var(--ink-faint)]">{preshift.bookedCovers == null ? "No reservation total connected" : `${preshift.bookedCovers} booked covers`} · {preshift.acknowledgementCount} acknowledged</span></span><StatusPill tone={preshift.status === "published" ? "positive" : "neutral"}>{sentence(preshift.status)}</StatusPill></div>{preshift.status === "published" && !preshift.acknowledgedByCurrentEmployee ? <Button size="sm" variant="secondary" disabled={busy} className="mt-4" onClick={() => void perform(acknowledgePreshiftAction({ requestId: crypto.randomUUID(), preshiftId: preshift.id, comment: null }), "Pre-shift acknowledged.")}><Check className="size-4" />Acknowledge</Button> : null}</article>)}{!model.preshifts.length ? <div className="flex items-center gap-2 rounded-xl bg-[var(--warning-soft)] p-4 text-xs text-[var(--warning)]"><AlertTriangle className="size-4" />No pre-shift has been created for this service.</div> : null}</div>
      </section>
    </div>
  </PageFrame>;
}
