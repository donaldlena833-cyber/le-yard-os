"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileClock,
  Plus,
  ShieldAlert,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { demoIds, demoWorkspace as demoFixture } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type { Task } from "@/types";

type Tab = "tasks" | "checklists" | "sops" | "maintenance" | "incidents";

const tabLabels: Array<{ id: Tab; label: string }> = [
  { id: "tasks", label: "Tasks" },
  { id: "checklists", label: "Checklists" },
  { id: "sops", label: "SOPs" },
  { id: "maintenance", label: "Maintenance" },
  { id: "incidents", label: "Incidents" },
];

// Demo mode showcases a single-room synthetic operating day. Connected mode
// uses its own Supabase-backed workspace and never reads these fixtures.
const playgroundSopDocuments = demoFixture.sopDocuments;
const playgroundMaintenanceRequests = demoFixture.maintenanceRequests.filter(
  (request) => request.locationId === demoIds.locations.garden,
);
const playgroundIncidents = demoFixture.incidents.filter(
  (incident) => incident.locationId === demoIds.locations.garden,
);
const playgroundTasks = demoFixture.tasks.filter(
  (task) => task.locationId === null || task.locationId === demoIds.locations.garden,
);
const playgroundChecklists = demoFixture.checklists.filter(
  (checklist) => checklist.locationId === demoIds.locations.garden,
);
const playgroundChecklistRuns = demoFixture.checklistRuns.filter(
  (run) => run.locationId === demoIds.locations.garden,
);
const demoWorkspace = {
  ...demoFixture,
  sopDocuments: playgroundSopDocuments,
  maintenanceRequests: playgroundMaintenanceRequests,
  incidents: playgroundIncidents,
  tasks: playgroundTasks,
  checklists: playgroundChecklists,
  checklistRuns: playgroundChecklistRuns,
};

function EmployeeTasksWorkspace() {
  const [tab, setTab] = useState<"sops" | "maintenance" | "incidents">("sops");
  const [selectedSop, setSelectedSop] = useState(playgroundSopDocuments[0] || null);
  const [reportKind, setReportKind] = useState<"maintenance" | "incident" | null>(null);
  const [notice, setNotice] = useState("");

  function submitReport(kind: "maintenance" | "incident") {
    setReportKind(null);
    setNotice(kind === "maintenance" ? "Maintenance report sent to the managers." : "Incident report submitted to the restricted incident log.");
  }

  return (
    <PageFrame>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Your playbook</p><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">SOPs & reports</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">Read the current procedures and report anything that needs a manager’s attention.</p></div><div className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => setReportKind("maintenance")}><Wrench className="size-3.5" /> Report maintenance</Button><Button variant="danger" size="sm" onClick={() => setReportKind("incident")}><AlertTriangle className="size-3.5" /> Report incident</Button></div></div>
      {notice ? <p role="status" className="mt-4 rounded-xl bg-[var(--positive-soft)] px-3.5 py-3 text-[10px] text-[var(--positive)]">{notice}</p> : null}
      <div className="mt-7 flex items-center gap-1 overflow-x-auto border-b border-[var(--line)]">{([{ id: "sops", label: "SOPs" }, { id: "maintenance", label: "Maintenance" }, { id: "incidents", label: "Incidents" }] as const).map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={cn("focus-ring relative min-h-10 shrink-0 px-3 text-[11px] font-semibold", tab === item.id ? "text-[var(--ink)]" : "text-[var(--ink-faint)]")}>{item.label}{tab === item.id ? <motion.span layoutId="employee-task-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" /> : null}</button>)}</div>
      {tab === "sops" ? <section className="mt-6 grid gap-7 lg:grid-cols-[.8fr_1.2fr]"><div><SectionHeading title="Published procedures" detail="Read the latest approved version before service." /><div className="border-y border-[var(--line)]">{playgroundSopDocuments.map((sop) => <button key={sop.id} onClick={() => setSelectedSop(sop)} className={cn("focus-ring flex w-full items-center gap-3 border-t border-[var(--line)] px-3 py-4 text-left first:border-0 hover:bg-[var(--paper)]", selectedSop?.id === sop.id && "bg-[var(--paper)]")}><BookOpenText className="size-4 text-[var(--ink-faint)]" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{sop.title}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">v{sop.version} · {sop.category}</span></span><ChevronRight className="size-3.5 text-[var(--ink-faint)]" /></button>)}{!playgroundSopDocuments.length ? <p className="px-4 py-10 text-center text-[11px] text-[var(--ink-faint)]">No SOPs published yet. Managers can add the first procedure.</p> : null}</div></div>{selectedSop ? <article className="rounded-[20px] bg-[var(--paper)] p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">{selectedSop.category} · Version {selectedSop.version}</p><h3 className="mt-3 text-xl font-semibold tracking-[-0.04em]">{selectedSop.title}</h3></div><StatusPill tone="positive">Published</StatusPill></div><div className="mt-6 whitespace-pre-line text-[11px] leading-6 text-[var(--ink-soft)]">{selectedSop.body}</div><div className="mt-7 flex items-center justify-between border-t border-[var(--line)] pt-5"><p className="text-[10px] text-[var(--ink-faint)]">Acknowledgement is recorded to your profile.</p><Button variant="accent" size="sm" onClick={() => setNotice(`You acknowledged ${selectedSop.title}.`)}><Check className="size-3.5" /> Acknowledge</Button></div></article> : null}</section> : null}
      {tab === "maintenance" ? <section className="mt-6"><SectionHeading title="Maintenance reports" detail="Tell managers what needs attention in the room." action={<Button variant="accent" size="sm" onClick={() => setReportKind("maintenance")}><Wrench className="size-3.5" /> Report issue</Button>} /><div className="border-y border-[var(--line)]">{playgroundMaintenanceRequests.map((request) => <div key={request.id} className="flex items-start gap-3 border-t border-[var(--line)] px-3 py-4 first:border-0"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]"><Wrench className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{request.title}</p><p className="mt-1 text-[10px] leading-4 text-[var(--ink-faint)]">{request.asset} · {request.description}</p></div><StatusPill tone={request.status === "resolved" ? "positive" : "warning"}>{request.status.replaceAll("_", " ")}</StatusPill></div>)}{!playgroundMaintenanceRequests.length ? <p className="px-4 py-10 text-center text-[11px] text-[var(--ink-faint)]">No maintenance reports yet.</p> : null}</div></section> : null}
      {tab === "incidents" ? <section className="mt-6"><div className="mb-5 flex items-start gap-3 rounded-[16px] bg-[var(--warning-soft)] px-4 py-3 text-[10px] leading-4 text-[var(--warning)]"><ShieldAlert className="mt-0.5 size-4 shrink-0" /><span>Incident reports are sensitive and visible only to authorized managers and owners.</span></div><SectionHeading title="Incident reports" detail="Your report is added to the restricted incident log." action={<Button variant="danger" size="sm" onClick={() => setReportKind("incident")}><AlertTriangle className="size-3.5" /> Report incident</Button>} /><div className="border-y border-[var(--line)]">{playgroundIncidents.map((incident) => <div key={incident.id} className="flex items-start gap-3 border-t border-[var(--line)] px-3 py-4 first:border-0"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]"><ShieldAlert className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{incident.summary}</p><p className="numeric mt-1 text-[9px] text-[var(--ink-faint)]">{incident.kind} · {new Date(incident.occurredAt).toLocaleDateString()}</p></div><StatusPill tone={incident.status === "closed" ? "positive" : "warning"}>{incident.status}</StatusPill></div>)}{!playgroundIncidents.length ? <p className="px-4 py-10 text-center text-[11px] text-[var(--ink-faint)]">No incidents recorded.</p> : null}</div></section> : null}
      {reportKind ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setReportKind(null); }}><div role="dialog" aria-modal="true" className="w-full max-w-md rounded-[22px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)]"><div className="flex items-start justify-between"><div><p className="eyebrow">{reportKind === "maintenance" ? "Maintenance" : "Incident"}</p><h3 className="mt-2 text-lg font-semibold">{reportKind === "maintenance" ? "Report a maintenance issue" : "Report an incident"}</h3></div><Button variant="quiet" size="icon" aria-label="Close report" onClick={() => setReportKind(null)}><X className="size-4" /></Button></div><label className="mt-6 block"><span className="mb-1.5 block text-[10px] font-semibold">What happened?</span><textarea rows={4} autoFocus placeholder={reportKind === "maintenance" ? "Describe the equipment or room issue." : "Describe what happened and where."} className="w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs" /></label><div className="mt-4 flex justify-end gap-2"><Button variant="quiet" onClick={() => setReportKind(null)}>Cancel</Button><Button variant="accent" onClick={() => submitReport(reportKind)}>Send report</Button></div></div></div> : null}
    </PageFrame>
  );
}

export function TasksWorkspace() {
  const workspace = useWorkspaceContext();
  const currentUserId = workspace.identity.userId;
  const [tab, setTab] = useState<Tab>("tasks");
  const [tasks, setTasks] = useState(playgroundTasks);
  const [checkItems, setCheckItems] = useState<Record<string, string>>(() => {
    const run = playgroundChecklistRuns[0];
    return Object.fromEntries(run?.completedItems.map((item) => [item.itemId, item.completedBy]) || []);
  });
  const [selectedSop, setSelectedSop] = useState(playgroundSopDocuments[0] || null);
  const [createOpen, setCreateOpen] = useState(false);

  const openTasks = tasks.filter((task) => task.status !== "done");
  const dueBeforeService = openTasks.filter((task) => new Date(task.dueAt) < new Date("2026-08-01T18:00:00-04:00"));
  const checklist = playgroundChecklists[0];
  const completedCount = checklist?.items.filter((item) => Boolean(checkItems[item.id])).length || 0;

  if (workspace.role === "employee") return <EmployeeTasksWorkspace />;

  function cycleTask(task: Task) {
    const nextStatus: Task["status"] = task.status === "todo" ? "in_progress" : task.status === "in_progress" ? "done" : "todo";
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: nextStatus, completedBy: nextStatus === "done" ? currentUserId : null, completedAt: nextStatus === "done" ? new Date().toISOString() : null, updatedAt: new Date().toISOString() } : item));
  }

  function createTask(formData: FormData) {
    const created: Task = {
      id: `task-${Date.now()}`,
      organizationId: demoIds.organization,
      locationId: demoIds.locations.garden,
      title: String(formData.get("title") || "New task"),
      description: String(formData.get("description") || ""),
      category: "operations",
      priority: String(formData.get("priority") || "normal") as Task["priority"],
      assignedTo: currentUserId,
      assignedRole: null,
      dueAt: String(formData.get("dueAt") || "2026-08-01T18:00:00-04:00"),
      status: "todo",
      completedBy: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setTasks((current) => [created, ...current]);
    setCreateOpen(false);
  }

  return (
    <PageFrame>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="eyebrow">Operating standards</p><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Tasks & SOPs</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">One source of truth for routines, handoffs, and exceptions</p></div>
        <Button variant="accent" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Create task</Button>
      </div>

      <section className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Due before service" value={String(dueBeforeService.length)} detail={`Across ${workspace.activeLocation.name}`} trend={{ label: dueBeforeService.length ? "Active" : "Clear", tone: dueBeforeService.length ? "negative" : "positive" }} />
        <Metric label="Opening checklist" value={`${completedCount}/${checklist?.items.length || 0}`} detail="Required items complete" />
        <Metric label="SOP acknowledgements" value="—" detail="Publish SOPs to start tracking" />
        <Metric label="Open maintenance" value={String(playgroundMaintenanceRequests.filter((request) => request.status !== "resolved").length)} detail="No reports yet" />
      </section>

      <div className="mt-6 flex items-center gap-1 overflow-x-auto border-b border-[var(--line)]">{tabLabels.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={cn("focus-ring relative min-h-10 shrink-0 px-3 text-[11px] font-semibold", tab === item.id ? "text-[var(--ink)]" : "text-[var(--ink-faint)]")}>{item.label}{tab === item.id ? <motion.span layoutId="task-tab" className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" /> : null}</button>)}</div>

      {tab === "tasks" ? (
        <section className="mt-5"><SectionHeading title="Today’s work" detail="Select the status control to move a task forward." /><div className="border-y border-[var(--line)]">{tasks.map((task, index) => { const assignee = demoWorkspace.people.find((person) => person.id === task.assignedTo); return <div key={task.id} className="flex items-start gap-3 border-t border-[var(--line)] px-3 py-4 first:border-0"><button aria-label={`Change status for ${task.title}`} onClick={() => cycleTask(task)} className={cn("focus-ring mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", task.status === "done" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : task.status === "in_progress" ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)]")}>{task.status === "done" ? <Check className="size-3.5" /> : task.status === "in_progress" ? <FileClock className="size-3.5" /> : <Circle className="size-4" />}</button><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className={cn("text-xs font-semibold", task.status === "done" && "text-[var(--ink-faint)] line-through")}>{task.title}</p><StatusPill tone={task.priority === "urgent" ? "danger" : task.priority === "high" ? "warning" : "neutral"}>{task.priority}</StatusPill></div><p className="mt-1 text-[10px] leading-4 text-[var(--ink-faint)]">{task.description}</p><p className="numeric mt-2 text-[9px] text-[var(--ink-faint)]">Due {new Date(task.dueAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · {task.category}</p></div>{assignee ? <Avatar name={assignee.displayName} size="sm" index={index} /> : <StatusPill tone="neutral">{task.assignedRole || "Unassigned"}</StatusPill>}</div>; })}</div></section>
      ) : null}

      {tab === "checklists" ? (
        <section className="mt-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><SectionHeading title={checklist?.name || "Opening checklist"} detail={`Business date Aug 1 · ${completedCount} complete`} className="mb-0" /><StatusPill tone={completedCount === checklist?.items.length ? "positive" : "warning"} dot>{completedCount === checklist?.items.length ? "Complete" : "In progress"}</StatusPill></div><div className="mt-4 border-y border-[var(--line)]">{checklist?.items.map((item, index) => { const completedBy = demoWorkspace.people.find((person) => person.id === checkItems[item.id]); return <button key={item.id} onClick={() => setCheckItems((current) => { const next = { ...current }; if (next[item.id]) delete next[item.id]; else next[item.id] = currentUserId; return next; })} className="focus-ring flex w-full items-center gap-3 border-t border-[var(--line)] px-3 py-4 text-left first:border-0 hover:bg-[var(--paper)]"><span className={cn("flex size-7 items-center justify-center rounded-full border", checkItems[item.id] ? "border-[var(--positive)] bg-[var(--positive-soft)] text-[var(--positive)]" : "border-[var(--line-strong)] text-transparent")}><Check className="size-3.5" /></span><span className="min-w-0 flex-1"><span className={cn("block text-xs font-semibold", checkItems[item.id] && "text-[var(--ink-faint)] line-through")}>{item.label}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">{item.required ? "Required" : "Optional"}{item.sopId ? " · Linked SOP" : ""}</span></span>{completedBy ? <Avatar name={completedBy.displayName} size="sm" index={index} /> : <ChevronRight className="size-3.5 text-[var(--ink-faint)]" />}</button>; })}</div><div className="mt-5 flex justify-end"><Button variant="accent" disabled={completedCount !== checklist?.items.length}><CheckCircle2 className="size-4" /> Submit checklist</Button></div></section>
      ) : null}

      {tab === "sops" ? (
        <section className="mt-5 grid gap-7 lg:grid-cols-[.8fr_1.2fr]"><div><SectionHeading title="Published procedures" detail="Versioned and acknowledgement-tracked" /><div className="border-y border-[var(--line)]">{demoWorkspace.sopDocuments.map((sop) => <button key={sop.id} onClick={() => setSelectedSop(sop)} className={cn("focus-ring flex w-full items-center gap-3 border-t border-[var(--line)] px-3 py-4 text-left first:border-0 hover:bg-[var(--paper)]", selectedSop?.id === sop.id && "bg-[var(--paper)]")}><BookOpenText className="size-4 text-[var(--ink-faint)]" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{sop.title}</span><span className="mt-1 block text-[9px] text-[var(--ink-faint)]">v{sop.version} · {sop.category} · {sop.status}</span></span><ChevronRight className="size-3.5 text-[var(--ink-faint)]" /></button>)}</div></div>{selectedSop ? <article className="rounded-[20px] bg-[var(--paper)] p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">{selectedSop.category} · Version {selectedSop.version}</p><h3 className="mt-3 text-xl font-semibold tracking-[-0.04em]">{selectedSop.title}</h3></div><StatusPill tone="positive">Published</StatusPill></div><div className="mt-6 whitespace-pre-line text-[11px] leading-6 text-[var(--ink-soft)]">{selectedSop.body}</div><div className="mt-7 flex items-center gap-3 border-t border-[var(--line)] pt-5"><StatusPill tone="warning">{selectedSop.acknowledgements.length} acknowledgements</StatusPill><Button className="ml-auto" variant="accent" size="sm"><Check className="size-3.5" /> Acknowledge v{selectedSop.version}</Button></div></article> : null}</section>
      ) : null}

      {tab === "maintenance" ? (
        <section className="mt-5"><SectionHeading title="Maintenance requests" detail="Track restaurant assets from report to resolution." action={<Button variant="accent" size="sm"><Plus className="size-3.5" /> Report issue</Button>} /><div className="border-y border-[var(--line)]">{demoWorkspace.maintenanceRequests.map((request) => <div key={request.id} className="flex items-start gap-3 border-t border-[var(--line)] px-3 py-4 first:border-0"><span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", request.priority === "emergency" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--canvas-strong)] text-[var(--ink-faint)]")}><Wrench className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{request.title}</p><p className="mt-1 text-[10px] leading-4 text-[var(--ink-faint)]">{request.asset} · {request.description}</p></div><StatusPill tone={request.status === "resolved" ? "positive" : request.priority === "high" ? "warning" : "neutral"}>{request.status.replaceAll("_", " ")}</StatusPill></div>)}</div></section>
      ) : null}

      {tab === "incidents" ? (
        <section className="mt-5"><div className="mb-5 flex items-start gap-3 rounded-[16px] bg-[var(--warning-soft)] px-4 py-3 text-[10px] leading-4 text-[var(--warning)]"><ShieldAlert className="mt-0.5 size-4 shrink-0" /><span>Incident records are sensitive. Visibility is limited by role and location; audit access is recorded.</span></div><SectionHeading title="Incident log" detail="Structured records with immutable history" action={<Button variant="danger" size="sm"><AlertTriangle className="size-3.5" /> Report incident</Button>} /><div className="border-y border-[var(--line)]">{demoWorkspace.incidents.map((incident) => <div key={incident.id} className="flex items-start gap-3 border-t border-[var(--line)] px-3 py-4 first:border-0"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger)]"><ShieldAlert className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{incident.summary}</p><p className="numeric mt-1 text-[9px] text-[var(--ink-faint)]">{incident.kind} · {new Date(incident.occurredAt).toLocaleString()}</p></div><StatusPill tone={incident.status === "closed" ? "positive" : "warning"}>{incident.status}</StatusPill></div>)}</div></section>
      ) : null}

      <div className="mt-7 flex items-start gap-3 rounded-[16px] bg-[var(--accent-soft)]/50 px-4 py-3 text-[10px] leading-4 text-[var(--accent-strong)]"><Sparkles className="mt-0.5 size-4 shrink-0" /><span>Daily briefing can summarize overdue tasks and incomplete checklist items, but it cannot mark work complete or acknowledge an SOP for a person.</span></div>

      <AnimatePresence>{createOpen ? <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}><motion.div role="dialog" aria-modal="true" aria-label="Create task" className="w-full max-w-lg rounded-[22px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-6" initial={{ y: 12, scale: .98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, scale: .98 }}><div className="flex items-start justify-between"><div><p className="eyebrow">Operations</p><h3 className="mt-2 text-lg font-semibold">Create task</h3></div><Button variant="quiet" size="icon" onClick={() => setCreateOpen(false)}><X className="size-4" /></Button></div><form action={createTask} className="mt-6 grid gap-4"><label><span className="mb-1.5 block text-[10px] font-semibold">Task</span><input required name="title" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label><label><span className="mb-1.5 block text-[10px] font-semibold">Details</span><textarea name="description" rows={3} className="w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs" /></label><div className="grid gap-4 sm:grid-cols-2"><label><span className="mb-1.5 block text-[10px] font-semibold">Priority</span><select name="priority" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option>normal</option><option>high</option><option>urgent</option><option>low</option></select></label><label><span className="mb-1.5 block text-[10px] font-semibold">Due</span><input name="dueAt" type="datetime-local" defaultValue="2026-08-01T18:00" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label></div><div className="flex justify-end gap-2"><Button variant="quiet" onClick={() => setCreateOpen(false)}>Cancel</Button><Button type="submit" variant="accent"><Plus className="size-3.5" /> Create task</Button></div></form></motion.div></motion.div> : null}</AnimatePresence>
    </PageFrame>
  );
}
