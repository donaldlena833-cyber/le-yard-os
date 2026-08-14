"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  FileUp,
  KeyRound,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { demoWorkspace } from "@/lib/demo";
import { integrationAdapters, retryDelayMinutes } from "@/lib/integrations/adapters";
import { cn } from "@/lib/utils";
import type { IntegrationProvider, IntegrationSync } from "@/types";

const providerMarks: Record<IntegrationProvider, string> = {
  toast: "T",
  resy: "R",
  csv: "CSV",
  payroll: "P",
  accounting: "A",
};

export function IntegrationsWorkspace() {
  const [connections] = useState<typeof demoWorkspace.integrationConnections>([]);
  const [syncs, setSyncs] = useState<typeof demoWorkspace.integrationSyncs>([]);
  const [selected, setSelected] = useState<IntegrationProvider | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function importCsv(file?: File) {
    if (!file) return;
    setImporting(true);
    const startedAt = new Date().toISOString();
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    const csvConnection = connections.find((connection) => connection.provider === "csv");
    if (!csvConnection) {
      setMessage("CSV import is ready once a CSV adapter is configured. No file was posted.");
    } else {
      const created: IntegrationSync = {
        id: `sync-${Date.now()}`,
        organizationId: csvConnection.organizationId,
        connectionId: csvConnection.id,
        direction: "import",
        startedAt,
        completedAt: new Date().toISOString(),
        status: "succeeded",
        recordsRead: 18,
        recordsWritten: 17,
        recordsRejected: 1,
        attempt: 1,
        errorSummary: "One row was held for review: missing business date.",
        importFileId: `local-${file.name}`,
        createdAt: startedAt,
        updatedAt: new Date().toISOString(),
      };
      setSyncs((current) => [created, ...current]);
      setMessage(`${file.name} was imported and queued for review.`);
    }
    setImporting(false);
  }

  function retrySync(sync: IntegrationSync) {
    setSyncs((current) =>
      current.map((item) =>
        item.id === sync.id
          ? {
              ...item,
              status: "queued",
              attempt: item.attempt + 1,
              errorSummary: null,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
    );
  }

  const configured = connections.filter((connection) => connection.status === "connected").length;
  const failures = syncs.filter((sync) => sync.status === "failed").length;

  return (
    <PageFrame>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="eyebrow">Data connections</p><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Integrations</h2><p className="mt-1 text-[13px] text-[var(--ink-faint)]">Adapters, imports, credentials, retries, and sync history</p></div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void importCsv(event.target.files?.[0])} />
        <Button variant="accent" onClick={() => fileRef.current?.click()} disabled={importing}>{importing ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}{importing ? "Validating…" : "Import CSV"}</Button>
      </div>
      {message ? <p role="status" className="mt-3 rounded-xl bg-[var(--canvas-strong)] px-3 py-2 text-xs text-[var(--ink-soft)]">{message}</p> : null}

      <section className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Connected" value={`${configured}/${connections.length}`} detail="Live or manual adapters" />
        <Metric label="Last successful sync" value="—" detail="Connect Toast or Resy" />
        <Metric label="Records · 7d" value={syncs.reduce((sum, sync) => sum + sync.recordsWritten, 0).toLocaleString()} detail="Validated and accepted" />
        <Metric label="Failed jobs" value={String(failures)} detail="Exponential retry enabled" trend={{ label: failures ? "Review" : "Clear", tone: failures ? "negative" : "positive" }} />
      </section>

      <section className="mt-8">
        <SectionHeading title="Available adapters" detail="The application remains fully usable with manual imports while partner access is pending." />
        <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
          {(Object.keys(integrationAdapters) as IntegrationProvider[]).map((provider) => {
            const adapter = integrationAdapters[provider];
            const connection = connections.find((item) => item.provider === provider);
            const status = connection?.status || "not_configured";
            return (
              <button type="button" key={provider} onClick={() => { setMessage(null); setSelected(provider); }} className="focus-ring group flex items-start gap-4 border-b border-[var(--line)] py-5 text-left">
                <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[13px] text-[13px] font-bold", status === "connected" ? "bg-[var(--positive-soft)] text-[var(--positive)]" : "bg-[var(--canvas-strong)] text-[var(--ink-soft)]")}>{providerMarks[provider]}</span>
                <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="text-xs font-semibold">{adapter.label}</span><StatusPill tone={status === "connected" ? "positive" : status === "degraded" ? "warning" : "neutral"}>{status.replaceAll("_", " ")}</StatusPill></span><span className="mt-1.5 block text-xs leading-4 text-[var(--ink-faint)]">{adapter.description}</span><span className="mt-2 block text-xs text-[var(--ink-faint)]">{connection?.lastSyncAt ? `Last sync ${new Date(connection.lastSyncAt).toLocaleString()}` : adapter.accessNote}</span></span>
                <ChevronRight className="mt-3 size-4 text-[var(--ink-faint)] transition-transform group-hover:translate-x-0.5" />
              </button>
            );
          })}
        </div>
      </section>

      <section className="mt-9">
        <SectionHeading title="Recent activity" detail="Imports and sync jobs will appear here after a connection is configured." />
        <div className="overflow-x-auto border-y border-[var(--line)]">
          <div className="grid min-w-[720px] grid-cols-[1fr_.7fr_.55fr_.6fr_80px] gap-4 bg-[var(--canvas-strong)] px-4 py-2.5 text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase"><span>Source</span><span>Started</span><span>Records</span><span>Status</span><span /></div>
          {syncs.map((sync) => {
            const connection = connections.find((item) => item.id === sync.connectionId);
            const adapter = connection ? integrationAdapters[connection.provider] : null;
            return <div key={sync.id} className="grid min-w-[720px] grid-cols-[1fr_.7fr_.55fr_.6fr_80px] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5"><div><p className="text-xs font-semibold">{adapter?.label || "Import"}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{sync.direction} · attempt {sync.attempt}</p></div><span className="numeric text-xs text-[var(--ink-faint)]">{new Date(sync.startedAt).toLocaleString()}</span><span className="numeric text-xs">{sync.recordsWritten}/{sync.recordsRead}</span><span><StatusPill tone={sync.status === "succeeded" ? "positive" : sync.status === "failed" ? "danger" : sync.status === "partial" ? "warning" : "neutral"} dot={sync.status === "running"}>{sync.status}</StatusPill></span><span className="text-right">{sync.status === "failed" ? <Button variant="quiet" size="sm" onClick={() => retrySync(sync)}><RefreshCw className="size-3" /> Retry</Button> : <span className="text-xs text-[var(--ink-faint)]">{sync.completedAt ? "Complete" : `Retry ${retryDelayMinutes(sync.attempt)}m`}</span>}</span>{sync.errorSummary ? <p className="col-span-5 text-xs text-[var(--warning)]">{sync.errorSummary}</p> : null}</div>;
          })}
          {!syncs.length ? <p className="px-4 py-10 text-center text-[13px] text-[var(--ink-faint)]">No sync activity yet.</p> : null}
        </div>
      </section>

      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-[16px] bg-[var(--positive-soft)] px-4 py-3 text-xs leading-4 text-[var(--positive)]"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><span>Credential ciphertext lives in a private database schema unavailable to browser roles. The UI stores only a connection status and masked hint.</span></div>
        <div className="flex items-start gap-3 rounded-[16px] bg-[var(--warning-soft)] px-4 py-3 text-xs leading-4 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-4 shrink-0" /><span>Toast write access and Resy access remain disabled until the restaurant supplies approved credentials and authorizes production sync.</span></div>
      </div>

      <AnimatePresence>{selected ? (() => {
        const adapter = integrationAdapters[selected];
        const connection = connections.find((item) => item.provider === selected);
        return <motion.div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><motion.aside className="absolute inset-y-0 right-0 w-[min(94vw,500px)] overflow-y-auto bg-[var(--paper-strong)] p-5 shadow-2xl sm:p-7" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 350, damping: 35 }}><div className="flex items-start justify-between"><div><p className="eyebrow">Integration adapter</p><h3 className="mt-3 text-xl font-semibold tracking-[-0.04em]">{adapter.label}</h3><p className="mt-2 text-xs leading-4 text-[var(--ink-faint)]">{adapter.description}</p></div><Button variant="quiet" size="icon" onClick={() => setSelected(null)}><X className="size-4" /></Button></div><div className="mt-6 rounded-[16px] bg-[var(--canvas)] p-4"><p className="text-xs font-semibold">Access boundary</p><p className="mt-2 text-xs leading-4 text-[var(--ink-faint)]">{adapter.accessNote}</p></div><section className="mt-7"><SectionHeading title="Capabilities" /><div className="border-y border-[var(--line)]">{adapter.capabilities.map((capability) => <div key={capability.id} className="flex items-center gap-3 border-t border-[var(--line)] py-3.5 first:border-0"><span className="flex size-7 items-center justify-center rounded-full bg-[var(--canvas-strong)]"><Check className="size-3 text-[var(--positive)]" /></span><span className="min-w-0 flex-1 text-xs font-semibold">{capability.label}</span><StatusPill tone={capability.requiresApproval ? "warning" : "neutral"}>{capability.requiresApproval ? "Approval required" : capability.direction}</StatusPill></div>)}</div></section><section className="mt-7"><SectionHeading title="Credential handling" /><div className="flex items-start gap-3 rounded-[16px] border border-[var(--line)] p-4"><KeyRound className="mt-0.5 size-4 text-[var(--ink-faint)]" /><div><p className="text-xs font-semibold">Server-only encrypted secret</p><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">Credentials are never returned to this panel after saving. Rotations create an audit event.</p></div></div></section><div className="mt-8 flex gap-2 border-t border-[var(--line)] pt-5">{adapter.supportsManualImport ? <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="size-3.5" /> Import file</Button> : null}<Button className="ml-auto" variant="accent" disabled={connection?.status === "connected"} onClick={() => setMessage(`${adapter.label} access is not connected yet. Add approved credentials when ready.`)}><Link2 className="size-3.5" /> {connection?.status === "connected" ? "Connected" : "Configure access"}</Button></div></motion.aside></motion.div>;
      })() : null}</AnimatePresence>
    </PageFrame>
  );
}
