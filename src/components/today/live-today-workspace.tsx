import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Megaphone,
  PackageSearch,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { LiveTodayModel } from "@/data/read-models/today";

function dollars(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function ErrorState({ message }: { message: string }) {
  return (
    <PageFrame>
      <section className="mx-auto mt-[8svh] max-w-xl rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-7 text-center shadow-[var(--shadow-card)]">
        <AlertCircle className="mx-auto size-6 text-[var(--danger)]" />
        <h2 className="mt-4 text-xl font-medium tracking-[-0.04em]">Today is temporarily unavailable</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">{message}</p>
      </section>
    </PageFrame>
  );
}

export function LiveTodayWorkspace({
  workspace,
  model,
}: {
  workspace: WorkspaceContextValue;
  model: { ok: true; data: LiveTodayModel } | { ok: false; message: string };
}) {
  if (!model.ok) return <ErrorState message={model.message} />;
  const data = model.data;
  const firstName = workspace.identity.displayName.split(" ")[0];

  return (
    <PageFrame>
      <section className="relative overflow-hidden rounded-[26px] bg-[var(--graphite)] px-5 py-7 text-white sm:px-8">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="positive" dot className="bg-white/[0.08] text-[#93d0ad]">
                Live · {workspace.activeLocation.name}
              </StatusPill>
              <span className="text-[10px] text-white/55">Tenant-scoped operations</span>
            </div>
            <h2 className="mt-5 text-[clamp(2rem,4vw,3.75rem)] leading-none font-medium tracking-[-0.06em]">
              Welcome back, {firstName}.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/55">
              {data.scheduledCount
                ? `${data.scheduledCount} shift${data.scheduledCount === 1 ? "" : "s"} are visible today. ${data.openShiftCount ? `${data.openShiftCount} still need coverage.` : "No open shifts need coverage."}`
                : "No shifts are on the visible schedule for today."}
            </p>
          </div>
          <div className="border-t border-white/10 pt-5 lg:border-0 lg:pt-0 lg:text-right">
            <p className="text-[9px] tracking-[0.14em] text-white/50 uppercase">Business date</p>
            <p className="numeric mt-2 text-xl font-medium">{data.date}</p>
            <p className="mt-1 text-[9px] text-white/45">{data.timeZone}</p>
          </div>
        </div>
      </section>

      <section aria-label="Today’s live metrics" className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-b border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Scheduled" value={String(data.scheduledCount)} detail={`${data.openShiftCount} open for coverage`} />
        <Metric label="Clocked in" value={String(data.openPunchCount)} detail={`${data.clockedInCount} linked to today’s shifts`} />
        <Metric label="Open tasks" value={String(data.openTaskCount)} detail="Visible in your access scope" />
        <Metric
          label="Closeout"
          value={data.closeout ? dollars(data.closeout.netSalesCents, data.currencyCode) : "Not filed"}
          detail={data.closeout ? `${data.closeout.covers} covers · ${data.closeout.status}` : "No live sales summary yet"}
        />
      </section>

      <div className="mt-8 grid gap-9 xl:grid-cols-[1.35fr_.8fr]">
        <section>
          <SectionHeading
            eyebrow="Live service"
            title="Who’s on today"
            detail="Latest published schedule for this business week"
            action={<Link href="/schedule" className="focus-ring inline-flex min-h-8 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-[var(--ink-soft)] hover:bg-[var(--canvas-strong)]">Open schedule <ArrowRight className="size-3" /></Link>}
          />
          <div className="overflow-hidden border-y border-[var(--line)]">
            {data.shifts.map((shift, index) => (
              <div key={shift.id} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-[var(--line)] px-3 py-3.5 last:border-0 sm:grid-cols-[1fr_120px_120px]">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={shift.employeeName} index={index} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{shift.employeeName}</span>
                    <span className="mt-1 block truncate text-[10px] text-[var(--ink-faint)]">{shift.jobName}</span>
                  </span>
                </span>
                <span className="numeric hidden text-[10px] text-[var(--ink-faint)] sm:block">{shift.startLabel}–{shift.endLabel}</span>
                <span className="flex justify-end">
                  <StatusPill tone={shift.clockedIn ? "positive" : shift.isOpen ? "warning" : "neutral"} dot={shift.clockedIn}>
                    {shift.clockedIn ? "Clocked in" : shift.isOpen ? "Open" : shift.status.replaceAll("_", " ")}
                  </StatusPill>
                </span>
              </div>
            ))}
            {!data.shifts.length ? (
              <div className="px-5 py-12 text-center">
                <UsersRound className="mx-auto size-5 text-[var(--ink-faint)]" />
                <p className="mt-3 text-xs font-semibold">No visible shifts today</p>
                <p className="mt-1 text-[10px] text-[var(--ink-faint)]">Publish a schedule or check another business date.</p>
              </div>
            ) : null}
          </div>

          <section className="mt-9">
            <SectionHeading eyebrow="Accountability" title="Open tasks" detail="No completion is inferred from missing data" />
            <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {data.tasks.map((task) => (
                <div key={task.id} className="flex items-start gap-3 px-2 py-4">
                  <ClipboardCheck className="mt-0.5 size-4 text-[var(--ink-faint)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">{task.title}</p>
                    <p className="mt-1 text-[9px] text-[var(--ink-faint)]">
                      {task.assigneeName ?? "Unassigned"}{task.dueAt ? ` · due ${new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(task.dueAt))}` : " · no due time"}
                    </p>
                  </div>
                  <StatusPill tone={task.priority === "urgent" ? "danger" : task.status === "blocked" ? "warning" : "neutral"}>{task.status.replaceAll("_", " ")}</StatusPill>
                </div>
              ))}
              {!data.tasks.length ? <div className="px-5 py-9 text-center text-[10px] text-[var(--ink-faint)]">No open tasks are visible in this location scope.</div> : null}
            </div>
          </section>
        </section>

        <aside className="space-y-9">
          <section>
            <SectionHeading eyebrow="Team messages" title="Announcements" detail="Latest messages you are allowed to read" />
            <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {data.announcements.map((announcement) => (
                <div key={announcement.id} className="py-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><Megaphone className="size-3.5" /></span>
                    <div>
                      <p className="text-[11px] leading-5">{announcement.body}</p>
                      <p className="mt-2 text-[9px] text-[var(--ink-faint)]">{announcement.authorName} · {new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(announcement.createdAt))}</p>
                    </div>
                  </div>
                </div>
              ))}
              {!data.announcements.length ? <div className="px-4 py-9 text-center text-[10px] text-[var(--ink-faint)]">No live announcements yet.</div> : null}
            </div>
            <Link href="/messages" className="focus-ring mt-3 inline-flex min-h-8 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-[var(--ink-soft)] hover:bg-[var(--canvas-strong)]">Open messages <ArrowRight className="size-3" /></Link>
          </section>

          <section>
            <SectionHeading eyebrow="Control points" title="Closeout & inventory" />
            <div className="space-y-3">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4">
                <div className="flex items-center gap-3"><Clock3 className="size-4 text-[var(--accent-strong)]" /><p className="text-xs font-semibold">Today’s closeout</p></div>
                <p className="mt-3 text-[10px] leading-4 text-[var(--ink-faint)]">{data.closeout ? `${data.closeout.status} · ${dollars(data.closeout.netSalesCents, data.currencyCode)} net sales · ${data.closeout.covers} covers` : "No closeout has been filed for this business date."}</p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4">
                <div className="flex items-center gap-3"><PackageSearch className="size-4 text-[var(--accent-strong)]" /><p className="text-xs font-semibold">Inventory review</p></div>
                <p className="mt-3 text-[10px] leading-4 text-[var(--ink-faint)]">{data.pendingInventoryCounts ? `${data.pendingInventoryCounts} count${data.pendingInventoryCounts === 1 ? "" : "s"} await review.` : "No inventory counts await review."} {data.configuredParLevels ? `${data.configuredParLevels} inventory item${data.configuredParLevels === 1 ? " has" : "s have"} a current par configuration.` : "No par records are visible; below-par status cannot be calculated."}</p>
              </div>
              {!data.openShiftCount && !data.pendingInventoryCounts ? (
                <div className="flex items-start gap-2 rounded-2xl bg-[var(--positive-soft)] px-4 py-3 text-[10px] leading-4 text-[var(--positive)]"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />No visible staffing or inventory-review exceptions.</div>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </PageFrame>
  );
}
