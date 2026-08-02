"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Check,
  Download,
  Mail,
  Merge,
  MessageSquareText,
  Phone,
  Search,
  Sparkles,
  Star,
  Tag,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { StatusPill } from "@/components/ui/status-pill";
import { demoWorkspace } from "@/lib/demo";
import { buildGuestCsv } from "@/lib/exports/guest-csv";
import { cn, formatMoney } from "@/lib/utils";
import type { Guest } from "@/types";

type Filter = "all" | "vip" | "allergies" | "recent";

export function GuestsWorkspace() {
  const workspace = useWorkspaceContext();
  const [guests, setGuests] = useState(demoWorkspace.guests);
  const [selected, setSelected] = useState<Guest | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [duplicates, setDuplicates] = useState(demoWorkspace.duplicateGuestCandidates);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return guests.filter((guest) => {
      const searchText = `${guest.firstName} ${guest.lastName} ${guest.contact.email || ""} ${guest.contact.phone || ""} ${guest.preferences.join(" ")} ${guest.allergies.join(" ")} ${guest.tags.join(" ")}`.toLowerCase();
      const matchesQuery = !needle || searchText.includes(needle);
      const matchesFilter =
        filter === "all" ||
        (filter === "vip" && guest.vip) ||
        (filter === "allergies" && guest.allergies.length > 0) ||
        (filter === "recent" && guest.lastVisitAt && new Date(guest.lastVisitAt) > new Date("2026-07-01"));
      return matchesQuery && matchesFilter && !guest.mergedIntoId;
    });
  }, [filter, guests, query]);

  function updateGuest(next: Guest) {
    setGuests((current) => current.map((guest) => (guest.id === next.id ? next : guest)));
    setSelected(next);
  }

  function exportGuests() {
    if (workspace.mode !== "demo") return;

    const url = URL.createObjectURL(
      new Blob([buildGuestCsv(filtered)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "le-yard-guests-demo.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const openDuplicates = duplicates.filter((candidate) => candidate.status === "open");

  return (
    <PageFrame>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Guest intelligence</p>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Guestbook</h2>
          <p className="mt-1 text-[11px] text-[var(--ink-faint)]">Unified profiles with consent, preferences, and visit history</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-2"><Button variant="secondary" onClick={exportGuests} disabled={workspace.mode !== "demo"} aria-describedby={workspace.mode === "live" ? "guest-export-readiness" : undefined}><Download className="size-4" /> Export filtered</Button><Button variant="accent"><UserRoundPlus className="size-4" /> Add guest</Button></div>
          {workspace.mode === "live" ? <p id="guest-export-readiness" role="status" className="max-w-xs text-right text-[10px] leading-4 text-[var(--ink-faint)]">Guest export is disabled until the tenant-scoped live CRM export passes connected acceptance.</p> : null}
        </div>
      </div>

      <section className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Guest profiles" value={guests.filter((guest) => !guest.mergedIntoId).length.toLocaleString()} detail="Across both locations" />
        <Metric label="Returning · 90d" value="68%" detail="At least two visits" trend={{ label: "+4.2pt", tone: "positive" }} />
        <Metric label="VIP guests" value={String(guests.filter((guest) => guest.vip).length)} detail="Flagged by an owner or manager" />
        <Metric label="Possible duplicates" value={String(openDuplicates.length)} detail="Never auto-merged" trend={{ label: openDuplicates.length ? "Review" : "Clear", tone: openDuplicates.length ? "negative" : "positive" }} />
      </section>

      {openDuplicates.length ? (
        <div className="mt-5 flex flex-col gap-3 rounded-[16px] bg-[var(--warning-soft)] px-4 py-3 text-[10px] text-[var(--warning)] sm:flex-row sm:items-center">
          <Merge className="size-4 shrink-0" /><span className="flex-1"><strong>{openDuplicates.length} possible duplicate</strong> matched on phone and similar name. Human review is required before merging.</span><Button variant="secondary" size="sm" onClick={() => setDuplicates((current) => current.map((candidate) => ({ ...candidate, status: "dismissed" })))}>Review matches</Button>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block w-full lg:max-w-md"><Search className="absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, contact, allergy, preference, or tag" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pr-4 pl-10 text-xs outline-none focus:border-[var(--accent)]" /></label>
        <div className="flex items-center gap-1 overflow-x-auto">{(["all", "vip", "allergies", "recent"] as Filter[]).map((item) => <button key={item} onClick={() => setFilter(item)} className={cn("focus-ring rounded-lg px-3 py-2 text-[10px] font-semibold capitalize", filter === item ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)]")}>{item}</button>)}</div>
      </div>

      <section className="mt-5 overflow-x-auto border-y border-[var(--line)]">
        <div className="grid min-w-[760px] grid-cols-[1.25fr_.8fr_.7fr_.6fr_.55fr] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-[9px] font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase"><span>Guest</span><span>Last visit</span><span>Lifetime</span><span>Preferences</span><span>Consent</span></div>
        {filtered.map((guest, index) => {
          const consent = demoWorkspace.consentRecords.filter((record) => record.guestId === guest.id);
          return <button key={guest.id} onClick={() => setSelected(guest)} className="focus-ring grid min-w-[760px] w-full grid-cols-[1.25fr_.8fr_.7fr_.6fr_.55fr] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5 text-left hover:bg-[var(--paper)]"><span className="flex min-w-0 items-center gap-3"><Avatar name={`${guest.firstName} ${guest.lastName}`} index={index} /><span className="min-w-0"><span className="flex items-center gap-1.5"><span className="truncate text-xs font-semibold">{guest.firstName} {guest.lastName}</span>{guest.vip ? <Star className="size-3 fill-[var(--accent)] text-[var(--accent)]" /> : null}</span><span className="mt-1 block truncate text-[9px] text-[var(--ink-faint)]">{guest.visitCount} visits · {guest.contact.email || guest.contact.phone || "No contact"}</span></span></span><span className="numeric text-[10px] text-[var(--ink-soft)]">{guest.lastVisitAt ? new Date(guest.lastVisitAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Never"}</span><span className="numeric text-xs font-semibold">{formatMoney(guest.lifetimeSpendCents)}</span><span className="flex flex-wrap gap-1">{guest.allergies.length ? <StatusPill tone="danger">{guest.allergies[0]}</StatusPill> : guest.preferences.length ? <StatusPill tone="neutral">{guest.preferences[0]}</StatusPill> : <span className="text-[9px] text-[var(--ink-faint)]">—</span>}</span><span className="text-[9px] text-[var(--ink-faint)]">{consent.some((record) => record.status === "granted") ? "Opted in" : "Unknown"}</span></button>;
        })}
        {!filtered.length ? <div className="px-5 py-12 text-center"><UsersRound className="mx-auto size-6 text-[var(--ink-faint)]" /><p className="mt-3 text-xs font-semibold">No matching guests</p><p className="mt-1 text-[10px] text-[var(--ink-faint)]">Try another filter or search phrase.</p></div> : null}
      </section>

      <div className="mt-7 flex items-start gap-3 rounded-[16px] bg-[var(--accent-soft)]/50 px-4 py-3 text-[10px] leading-4 text-[var(--accent-strong)]"><Sparkles className="mt-0.5 size-4 shrink-0" /><span><strong>Service note:</strong> Two tonight’s reservations include known allergies. This summary cites the guest and reservation records and cannot edit them.</span></div>

      <AnimatePresence>
        {selected ? (
          <motion.div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
            <motion.aside className="absolute inset-y-0 right-0 w-[min(95vw,560px)] overflow-y-auto bg-[var(--paper-strong)] p-5 shadow-2xl sm:p-7" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 350, damping: 35 }}>
              <div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><Avatar name={`${selected.firstName} ${selected.lastName}`} size="lg" /><div><p className="flex items-center gap-2 text-lg font-semibold tracking-[-0.035em]">{selected.firstName} {selected.lastName}{selected.vip ? <Star className="size-4 fill-[var(--accent)] text-[var(--accent)]" /> : null}</p><p className="mt-1 text-[10px] text-[var(--ink-faint)]">{selected.visitCount} visits · {formatMoney(selected.lifetimeSpendCents)} lifetime</p></div></div><Button variant="quiet" size="icon" onClick={() => setSelected(null)}><X className="size-4" /></Button></div>
              <div className="mt-6 flex flex-wrap gap-2"><Button variant={selected.vip ? "accent" : "secondary"} size="sm" onClick={() => updateGuest({ ...selected, vip: !selected.vip, updatedAt: new Date().toISOString() })}><Star className="size-3.5" /> {selected.vip ? "VIP" : "Mark VIP"}</Button><Button variant="secondary" size="sm"><MessageSquareText className="size-3.5" /> Add note</Button><Button variant="quiet" size="sm"><Tag className="size-3.5" /> Add tag</Button></div>
              <section className="mt-7 border-y border-[var(--line)] py-5"><SectionHeading title="Contact & consent" className="mb-4" /><div className="grid gap-3 text-[10px] sm:grid-cols-2"><div className="flex items-center gap-2"><Mail className="size-3.5 text-[var(--ink-faint)]" /><span className="truncate">{selected.contact.email || "No email"}</span></div><div className="flex items-center gap-2"><Phone className="size-3.5 text-[var(--ink-faint)]" /><span>{selected.contact.phone || "No phone"}</span></div></div><div className="mt-4 flex flex-wrap gap-2">{demoWorkspace.consentRecords.filter((record) => record.guestId === selected.id).map((record) => <StatusPill key={record.id} tone={record.status === "granted" ? "positive" : record.status === "withdrawn" ? "danger" : "neutral"}>{record.channel}: {record.status}</StatusPill>)}{!demoWorkspace.consentRecords.some((record) => record.guestId === selected.id) ? <StatusPill tone="neutral">Consent unknown</StatusPill> : null}</div></section>
              <section className="mt-6"><SectionHeading title="Hospitality notes" detail="Visible to authorized service staff" /><div className="space-y-4"><div><p className="eyebrow mb-2">Allergies</p><div className="flex flex-wrap gap-1.5">{selected.allergies.length ? selected.allergies.map((allergy) => <StatusPill key={allergy} tone="danger"><AlertTriangle className="size-3" /> {allergy}</StatusPill>) : <span className="text-[10px] text-[var(--ink-faint)]">None recorded</span>}</div></div><div><p className="eyebrow mb-2">Preferences</p><div className="flex flex-wrap gap-1.5">{selected.preferences.map((preference) => <StatusPill key={preference} tone="accent">{preference}</StatusPill>)}</div></div><div><p className="eyebrow mb-2">Notes</p><p className="text-[11px] leading-5 text-[var(--ink-soft)]">{selected.notes || "No notes yet."}</p></div></div></section>
              <section className="mt-7"><SectionHeading title="Visit history" detail="Reservation and spend context" /><div className="border-y border-[var(--line)]">{demoWorkspace.guestVisits.filter((visit) => visit.guestId === selected.id).map((visit) => <div key={visit.id} className="flex items-center gap-3 border-t border-[var(--line)] py-3.5 first:border-0"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><Check className="size-3.5 text-[var(--positive)]" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold">{new Date(visit.visitedAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })} · party of {visit.partySize}</p><p className="mt-1 truncate text-[9px] text-[var(--ink-faint)]">{visit.source} · {visit.notes || "No visit note"}</p></div><span className="numeric text-xs font-semibold">{formatMoney(visit.spendCents)}</span></div>)}{!demoWorkspace.guestVisits.some((visit) => visit.guestId === selected.id) ? <p className="py-5 text-center text-[10px] text-[var(--ink-faint)]">No visit records yet.</p> : null}</div></section>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </PageFrame>
  );
}
