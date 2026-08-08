"use client";

import {
  Archive,
  BadgePercent,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Clock3,
  DatabaseBackup,
  Download,
  FileClock,
  FileSpreadsheet,
  Fingerprint,
  HandCoins,
  KeyRound,
  LockKeyhole,
  MapPin,
  MonitorCheck,
  ShieldAlert,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { MfaEnrollment } from "@/components/settings/mfa-enrollment";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { demoWorkspace } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/types";

type Tab = "organization" | "locations" | "operations" | "security" | "data";

const tabs: Array<{ id: Tab; label: string; icon: typeof Building2 }> = [
  { id: "organization", label: "Organization", icon: Building2 },
  { id: "locations", label: "Locations", icon: MapPin },
  { id: "operations", label: "Operating draft", icon: ClipboardList },
  { id: "security", label: "Security", icon: Fingerprint },
  { id: "data", label: "Data & audit", icon: DatabaseBackup },
];

const roleSummary: Array<{ role: AppRole; scope: string; people: string }> = [
  { role: "owner", scope: "All settings, financial approvals, and owner assignment", people: "2" },
  { role: "admin", scope: "Users, locations, integrations, exports, and operations", people: "0" },
  { role: "manager", scope: "Assigned-location schedules, purchasing, closeouts, and operations", people: "2" },
  { role: "employee", scope: "Own profile, shifts, chat, tasks, and own tips", people: "4" },
];

function downloadDemoExport() {
  const exportPayload = {
    generatedAt: new Date().toISOString(),
    mode: "le_yard_workspace",
    organization: demoWorkspace.organizations[0],
    locations: demoWorkspace.locations,
    people: demoWorkspace.people,
    auditEvents: demoWorkspace.auditEvents,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "le-yard-os-export.json";
  link.click();
  URL.revokeObjectURL(url);
}

function OrganizationPanel() {
  const organization = { ...demoWorkspace.organizations[0], name: "Le Yard" };
  const owners = demoWorkspace.people.filter((person) => organization.ownerIds.includes(person.id));
  return (
    <div className="space-y-9">
      <section>
        <SectionHeading title="Organization profile" detail="Le Yard’s tenant settings and owner controls." />
        <div className="grid gap-4 border-y border-[var(--line)] py-5 sm:grid-cols-2">
          <label><span className="mb-1.5 block text-[10px] font-semibold">Legal or operating name</span><input defaultValue={organization.name} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
          <label><span className="mb-1.5 block text-[10px] font-semibold">Workspace slug</span><input defaultValue={organization.slug} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
          <label><span className="mb-1.5 block text-[10px] font-semibold">Default timezone</span><select defaultValue={organization.timezone} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option>America/New_York</option></select></label>
          <label><span className="mb-1.5 block text-[10px] font-semibold">Currency</span><select defaultValue={organization.currency} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option>USD</option></select></label>
        </div>
        <div className="mt-4 flex flex-col justify-between gap-4 rounded-[18px] bg-[var(--ink)] p-5 text-[var(--paper)] sm:flex-row sm:items-center">
          <div className="flex items-start gap-3"><MapPin className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" /><div><p className="text-xs font-semibold">Le Yard · Ninth Avenue</p><p className="mt-1 text-[10px] leading-4 text-white/60">858 9th Ave, New York, NY 10019</p></div></div>
          <StatusPill className="bg-white/10 text-white">Primary location</StatusPill>
        </div>
        <p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-[var(--ink-faint)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />Donald, Maris, Irini, and Mateo are the current Le Yard accounts. Operational records remain empty until your team adds them.</p>
      </section>

      <section>
        <SectionHeading title="Owner accounts" detail="Production Owners require MFA. Passwords are never retrievable by the app." />
        <div className="border-y border-[var(--line)]">
          {owners.map((owner, index) => (
            <div key={owner.id} className="flex items-center gap-3 border-t border-[var(--line)] py-4 first:border-0">
              <Avatar name={owner.displayName} index={index} />
              <div className="min-w-0 flex-1"><p className="text-xs font-semibold">{owner.displayName}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">Owner operator · authenticated account</p></div>
              <StatusPill tone="accent"><ShieldCheck className="size-3" /> Owner</StatusPill>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="Role boundaries" detail="Permissions are additive by role and always constrained to tenant and assigned locations." />
        <div className="overflow-x-auto border-y border-[var(--line)]">
          <div className="grid min-w-[620px] grid-cols-[110px_1fr_70px] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-[9px] font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase"><span>Role</span><span>Maximum scope</span><span>People</span></div>
          {roleSummary.map((item) => <div key={item.role} className="grid min-w-[620px] grid-cols-[110px_1fr_70px] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5"><span className="text-xs font-semibold capitalize">{item.role}</span><span className="text-[10px] text-[var(--ink-faint)]">{item.scope}</span><span className="numeric text-xs">{item.people}</span></div>)}
        </div>
      </section>
    </div>
  );
}

function LocationsPanel() {
  return (
    <div>
      <SectionHeading title="Restaurant locations" detail="Each location has independent membership scope, operational records, and timezone handling." action={<Button variant="secondary" size="sm" disabled>Add location</Button>} />
      <div className="grid gap-4 sm:grid-cols-2">
        {demoWorkspace.locations.slice(0, 1).map((location, index) => (
          <article key={location.id} className="rounded-[20px] border border-[var(--line)] bg-[var(--paper)] p-5">
            <div className="flex items-start justify-between gap-3"><span className={cn("flex size-10 items-center justify-center rounded-[13px]", index === 0 ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--canvas-strong)] text-[var(--ink-faint)]")}><MapPin className="size-4" /></span><StatusPill tone={index === 0 ? "accent" : "neutral"} dot>{index === 0 ? "Owner supplied" : "Synthetic mock"}</StatusPill></div>
            <h3 className="mt-5 text-base font-semibold tracking-[-0.03em]">{index === 0 ? "Le Yard" : location.name}</h3>
            <p className="mt-2 text-[10px] leading-4 text-[var(--ink-faint)]">{location.address.line1}<br />{location.address.city}, {location.address.region} {location.address.postalCode}</p>
            <div className="mt-5 flex items-center justify-between border-t border-[var(--line)] pt-4"><span className="text-[9px] text-[var(--ink-faint)]">{location.timezone}</span><Button variant="quiet" size="sm">Review <ChevronRight className="size-3" /></Button></div>
          </article>
        ))}
      </div>
      <p className="mt-5 flex items-start gap-2 rounded-[16px] bg-[var(--warning-soft)] p-4 text-[10px] leading-4 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-4 shrink-0" />Le Yard is currently configured as one main dining room. Phone, service periods, and job codes remain mock values for testing.</p>
    </div>
  );
}

function DraftRuleRow({
  Icon,
  title,
  value,
  detail,
  status,
}: {
  Icon: typeof Archive;
  title: string;
  value: string;
  detail: string;
  status: string;
}) {
  return (
    <div className="group grid gap-3 border-t border-[var(--line)] px-1 py-4 first:border-0 sm:grid-cols-[38px_minmax(130px,.55fr)_minmax(220px,1fr)_auto] sm:items-center sm:gap-4">
      <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-soft)] transition-transform duration-200 group-hover:-translate-y-0.5"><Icon className="size-4" /></span>
      <div><p className="text-[9px] font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase">{title}</p><p className="mt-1 text-sm font-semibold tracking-[-0.025em] text-[var(--ink)]">{value}</p></div>
      <p className="text-[10px] leading-[1.55] text-[var(--ink-faint)]">{detail}</p>
      <StatusPill tone="warning">{status}</StatusPill>
    </div>
  );
}

function OperatingDraftPanel() {
  const assumptions = demoWorkspace.ownerDraftOperatingAssumptions;
  const eventFeePercent = assumptions.eventFee.rateBasisPoints / 100;
  const shiftHours = assumptions.break.scheduledShiftLongerThanMinutes / 60;

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[22px] bg-[var(--ink)] px-5 py-6 text-[var(--paper)] sm:px-7 sm:py-7">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div className="max-w-xl">
            <p className="text-[9px] font-semibold tracking-[.16em] text-white/45 uppercase">Owner draft · unpublished</p>
            <h3 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Reference only.</h3>
            <p className="mt-2 text-[11px] leading-5 text-white/58">These assumptions capture the owners’ current thinking for the playground. They do not claim legal compliance and cannot calculate schedules, payroll, tips, fees, or deletion dates.</p>
          </div>
          <StatusPill className="w-fit bg-white/10 text-white"><ShieldAlert className="size-3" /> No calculations</StatusPill>
        </div>
      </section>

      <section>
        <SectionHeading title="Draft operating assumptions" detail="Each item stays visibly pending until its details are reviewed and published through a future approval flow." />
        <div className="border-y border-[var(--line)]">
          <DraftRuleRow
            Icon={Clock3}
            title="Scheduled break"
            value={`>${shiftHours}h → ${assumptions.break.minimumUnpaidBreakMinutes} min unpaid`}
            detail="Every shift longer than six hours receives a 30-minute unpaid break. A manager approves whether it sits during, before, or after the shift."
            status="Manager approval"
          />
          <DraftRuleRow
            Icon={CalendarClock}
            title="Overtime"
            value={`${assumptions.overtime.multiplier}× owner input`}
            detail="Overtime is paid at 1.5× where applicable. Threshold, workweek, and exemptions are not configured in this demo; managers approve the schedule context and payroll remains a separate workflow."
            status="Manager approval"
          />
          <DraftRuleRow
            Icon={HandCoins}
            title="Gratuity"
            value="Customer choice"
            detail="No automatic gratuity is assumed. Customer tips are voluntary at payment and remain distinct from fees."
            status="Draft"
          />
          <DraftRuleRow
            Icon={BadgePercent}
            title="Events"
            value={`${eventFeePercent}% event fee`}
            detail="The fee is kept separate from tips. Accounting, tax, and payroll treatment still require review."
            status="Review treatment"
          />
          <DraftRuleRow
            Icon={FileSpreadsheet}
            title="Payroll export"
            value="Undecided"
            detail="Provider, format, approvals, and field mapping have not been selected. No payroll-ready export is enabled."
            status="Owner decision"
          />
          <DraftRuleRow
            Icon={Archive}
            title="Retention"
            value="Unset"
            detail="Retention means how long receipts, employee records, guest data, audit history, and backups are kept before archive or deletion. No automatic deletion is configured."
            status="Owner decision"
          />
        </div>
      </section>
    </div>
  );
}

function SecurityPanel() {
  const mfaEnabled = demoWorkspace.memberships.filter((membership) => membership.mfaEnabled).length;
  return (
    <div className="space-y-9">
      <section>
        <SectionHeading title="Multi-factor authentication" detail="Owners are blocked from production operations until a verified second factor is present." />
        <MfaEnrollment />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[16px] bg-[var(--canvas)] p-4"><p className="text-[9px] text-[var(--ink-faint)]">Required role</p><p className="mt-2 text-xs font-semibold">Owners</p></div>
          <div className="rounded-[16px] bg-[var(--canvas)] p-4"><p className="text-[9px] text-[var(--ink-faint)]">MFA status</p><p className="numeric mt-2 text-xs font-semibold">{mfaEnabled} of {demoWorkspace.memberships.length} marked</p></div>
          <div className="rounded-[16px] bg-[var(--canvas)] p-4"><p className="text-[9px] text-[var(--ink-faint)]">Other roles</p><p className="mt-2 text-xs font-semibold">Optional</p></div>
        </div>
      </section>

      <section>
        <SectionHeading title="Account controls" detail="Creation and role assignment are restricted to Owner and Admin accounts." />
        <div className="border-y border-[var(--line)]">
          {[
            [UsersRound, "User creation", "Invitation only · Owner or Admin"],
            [LockKeyhole, "Password custody", "User-controlled · not recoverable by admins"],
            [KeyRound, "Service credentials", "Server only · encrypted private schema"],
            [FileClock, "Session history", "Provider session logging"],
          ].map(([Icon, title, detail]) => {
            const RowIcon = Icon as typeof UsersRound;
            return <div key={String(title)} className="flex items-center gap-3 border-t border-[var(--line)] py-4 first:border-0"><span className="flex size-8 items-center justify-center rounded-xl bg-[var(--canvas-strong)]"><RowIcon className="size-3.5 text-[var(--ink-soft)]" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold">{String(title)}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">{String(detail)}</p></div><Check className="size-3.5 text-[var(--positive)]" /></div>;
          })}
        </div>
      </section>

      <form action={signOutAction} className="border-t border-[var(--line)] pt-5">
        <Button type="submit" variant="secondary">Sign out of this device</Button>
      </form>
    </div>
  );
}

function DataPanel() {
  const events = useMemo(() => demoWorkspace.auditEvents.slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), []);
  return (
    <div className="space-y-9">
      <section>
        <SectionHeading title="Retention & recovery" detail="Policies stay unset until the owners approve operational and legal requirements." />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[18px] border border-[var(--line)] p-4"><Archive className="size-4 text-[var(--warning)]" /><p className="mt-4 text-xs font-semibold">Retention policy</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">Not configured</p><StatusPill className="mt-3" tone="warning">Owner decision</StatusPill></div>
          <div className="rounded-[18px] border border-[var(--line)] p-4"><DatabaseBackup className="size-4 text-[var(--ink-soft)]" /><p className="mt-4 text-xs font-semibold">Database backups</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">Supabase-managed</p><StatusPill className="mt-3">Available</StatusPill></div>
          <div className="rounded-[18px] border border-[var(--line)] p-4"><MonitorCheck className="size-4 text-[var(--ink-soft)]" /><p className="mt-4 text-xs font-semibold">Error monitoring</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">Schema and boundaries ready</p><StatusPill className="mt-3">Needs destination</StatusPill></div>
        </div>
      </section>

      <section>
        <SectionHeading title="Tenant export" detail="Exports are generated server-side, permission-checked, and written to the audit log." action={<Button variant="secondary" size="sm" onClick={downloadDemoExport}><Download className="size-3.5" /> Export JSON</Button>} />
        <div className="flex items-start gap-3 rounded-[16px] bg-[var(--positive-soft)] p-4 text-[10px] leading-4 text-[var(--positive)]"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><span>Exports are tenant-scoped. Cross-tenant records are denied by membership checks and database RLS.</span></div>
      </section>

      <section>
        <SectionHeading title="Immutable audit trail" detail="Actor, scope, entity, and masked source are preserved for security-sensitive changes." />
        <div className="overflow-x-auto border-y border-[var(--line)]">
          <div className="grid min-w-[700px] grid-cols-[1fr_1fr_.8fr_.7fr] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-[9px] font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase"><span>Event</span><span>Record</span><span>Actor</span><span>Occurred</span></div>
          {events.map((event) => <div key={event.id} className="grid min-w-[700px] grid-cols-[1fr_1fr_.8fr_.7fr] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5"><span className="text-[10px] font-semibold">{event.action.replaceAll("_", " ")}</span><span className="font-mono text-[9px] text-[var(--ink-faint)]">{event.entityType} · {event.entityId}</span><span className="text-[9px] capitalize text-[var(--ink-faint)]">{event.actorType}</span><span className="numeric text-[9px] text-[var(--ink-faint)]">{new Date(event.occurredAt).toLocaleString()}</span></div>)}
        </div>
      </section>
    </div>
  );
}

export function SettingsWorkspace() {
  const [tab, setTab] = useState<Tab>("organization");
  return (
    <PageFrame width="standard">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="eyebrow">Le Yard playground</p><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Settings</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">Staff profiles, job codes, schedules, receipts, and operational records start empty here. synthetic mock data is off.</p></div>
        <StatusPill tone="accent"><CircleAlert className="size-3" /> Tenant workspace</StatusPill>
      </div>

      <section className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Owners" value="2" detail="Donald & Maris" />
        <Metric label="Primary location" value="858" detail="Ninth Avenue · owner supplied" />
        <Metric label="Operating rules" value="Draft" detail="Reference only" trend={{ label: "Unpublished", tone: "neutral" }} />
        <Metric label="Retention" value="Unset" detail="No automatic deletion" trend={{ label: "Review", tone: "negative" }} />
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[210px_1fr]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
          {tabs.map((item) => { const Icon = item.icon; const active = tab === item.id; return <button key={item.id} onClick={() => setTab(item.id)} aria-current={active ? "page" : undefined} className={cn("focus-ring flex min-h-10 shrink-0 items-center gap-2.5 rounded-xl px-3 text-left text-[11px] font-semibold transition-colors lg:w-full", active ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)]")}><Icon className="size-3.5" />{item.label}</button>; })}
        </nav>
        <div className="min-w-0">{tab === "organization" ? <OrganizationPanel /> : tab === "locations" ? <LocationsPanel /> : tab === "operations" ? <OperatingDraftPanel /> : tab === "security" ? <SecurityPanel /> : <DataPanel />}</div>
      </div>
    </PageFrame>
  );
}
