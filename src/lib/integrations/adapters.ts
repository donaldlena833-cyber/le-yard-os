import type { IntegrationProvider } from "@/types";

export type IntegrationCapability = {
  id: string;
  label: string;
  direction: "read" | "write" | "export";
  requiresApproval: boolean;
};

export type IntegrationAdapterDefinition = {
  provider: IntegrationProvider;
  label: string;
  description: string;
  accessNote: string;
  capabilities: IntegrationCapability[];
  supportsManualImport: boolean;
};

export const integrationAdapters: Record<IntegrationProvider, IntegrationAdapterDefinition> = {
  toast: {
    provider: "toast",
    label: "Toast",
    description: "Sales, checks, labor, menus, and restaurant configuration.",
    accessNote: "Standard API access is read-only. Write operations require approved custom or partner access.",
    capabilities: [
      { id: "sales", label: "Read sales & checks", direction: "read", requiresApproval: false },
      { id: "labor", label: "Read labor records", direction: "read", requiresApproval: false },
      { id: "write-labor", label: "Write schedules or punches", direction: "write", requiresApproval: true },
    ],
    supportsManualImport: true,
  },
  resy: {
    provider: "resy",
    label: "Resy",
    description: "Reservations, guest profiles, pacing, and visit context.",
    accessNote: "Connection availability depends on the restaurant’s Resy plan and approved integration access.",
    capabilities: [
      { id: "reservations", label: "Read reservations", direction: "read", requiresApproval: true },
      { id: "guests", label: "Read guest context", direction: "read", requiresApproval: true },
    ],
    supportsManualImport: true,
  },
  csv: {
    provider: "csv",
    label: "CSV imports",
    description: "Auditable manual imports that keep the app useful before API access.",
    accessNote: "Available now. Every row is validated and rejected rows remain reviewable.",
    capabilities: [
      { id: "import", label: "Import validated records", direction: "read", requiresApproval: false },
    ],
    supportsManualImport: true,
  },
  payroll: {
    provider: "payroll",
    label: "Payroll export",
    description: "Approved hours and tip allocations exported to a dedicated payroll provider.",
    accessNote: "Export only. Le Yard OS does not calculate taxes or transmit payroll in v1.",
    capabilities: [
      { id: "export", label: "Export approved payroll CSV", direction: "export", requiresApproval: false },
    ],
    supportsManualImport: false,
  },
  accounting: {
    provider: "accounting",
    label: "Accounting export",
    description: "Verified receipts, expenses, and closeout summaries for accounting workflows.",
    accessNote: "Provider selection and chart-of-accounts mapping are not configured.",
    capabilities: [
      { id: "export", label: "Export verified expenses", direction: "export", requiresApproval: true },
    ],
    supportsManualImport: false,
  },
};

export function retryDelayMinutes(attempt: number) {
  const boundedAttempt = Math.max(0, Math.min(attempt, 8));
  return Math.min(5 * 2 ** boundedAttempt, 12 * 60);
}

export function sanitizeIntegrationError(message: string) {
  return message
    .replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /((?:access[_ -]?|refresh[_ -]?)?token|secret|password|api[_ -]?key)["']?\s*[:=]\s*["']?[^"'\s,;}&]+/gi,
      "$1=[redacted]",
    )
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .slice(0, 500);
}
