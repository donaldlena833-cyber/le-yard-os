"use client";

import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { PageFrame } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";

export function TimeClockWorkspace() {
  const workspace = useWorkspaceContext();
  return <PageFrame width="wide"><StatusPill tone="neutral">Demo · setup pending</StatusPill><h2 className="mt-3 text-2xl font-medium">Time clock</h2><p className="mt-2 text-sm text-[var(--ink-faint)]">{workspace.activeLocation.name}</p><section className="mt-5 rounded-[24px] bg-[var(--paper-strong)] p-6"><h3 className="text-lg font-medium">Attendance source not configured</h3><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--ink-faint)]">Confirm the timekeeping system and staff punch procedure before use. Square is the selected POS; this demo does not establish an attendance or payroll connection.</p></section></PageFrame>;
}
