import type {
  AIInsightKind,
  ChatChannel,
  ConsentRecord,
  DocumentReviewStatus,
  IntegrationSyncStatus,
  ReportKind,
  TaskStatus,
  TimecardCorrection,
  TipDistributionMethod,
} from "@/types";
import type { EnumValue } from "@/types/database.generated";

export type DatabaseReportType =
  | "labor"
  | "attendance"
  | "overtime"
  | "tips"
  | "payroll"
  | "sales_labor"
  | "receipts"
  | "expenses"
  | "inventory_variance"
  | "cogs"
  | "waste"
  | "vendor_pricing"
  | "shift_performance"
  | "guest_activity";

export type DatabaseReceiptReviewStatus = EnumValue<"review_status">;
export type DatabaseCorrectionDecisionStatus = Extract<
  EnumValue<"request_status">,
  "pending" | "approved" | "denied"
>;
export type DatabaseConsentStatus = EnumValue<"consent_status">;
export type DatabaseTaskStatus = EnumValue<"task_status">;
export type DatabaseIntegrationSyncStatus = EnumValue<"job_status">;
export type DatabaseTipDistributionMethod = EnumValue<"tip_distribution_method">;
export type DatabaseChatChannelKind = EnumValue<"channel_kind">;
export type DatabaseAiRunKind = EnumValue<"ai_run_kind">;

const reportToDatabase = {
  labor: "labor",
  attendance: "attendance",
  overtime: "overtime",
  tips: "tips",
  payroll: "payroll",
  sales_to_labor: "sales_labor",
  receipts: "receipts",
  expenses: "expenses",
  inventory_variance: "inventory_variance",
  cogs: "cogs",
  waste: "waste",
  vendor_pricing: "vendor_pricing",
  shift_performance: "shift_performance",
  guest_activity: "guest_activity",
} as const satisfies Record<ReportKind, DatabaseReportType>;

const reportToDomain = {
  labor: "labor",
  attendance: "attendance",
  overtime: "overtime",
  tips: "tips",
  payroll: "payroll",
  sales_labor: "sales_to_labor",
  receipts: "receipts",
  expenses: "expenses",
  inventory_variance: "inventory_variance",
  cogs: "cogs",
  waste: "waste",
  vendor_pricing: "vendor_pricing",
  shift_performance: "shift_performance",
  guest_activity: "guest_activity",
} as const satisfies Record<DatabaseReportType, ReportKind>;

export function toDatabaseReportType(value: ReportKind): DatabaseReportType {
  return reportToDatabase[value];
}

export function toDomainReportKind(value: DatabaseReportType): ReportKind {
  return reportToDomain[value];
}

export interface DatabaseReceiptReview {
  reviewStatus: DatabaseReceiptReviewStatus;
  /** Duplicate evidence is a separate database relationship, not an enum value. */
  requiresConfirmedDuplicate: boolean;
}

export function toDatabaseReceiptReview(
  value: DocumentReviewStatus,
): DatabaseReceiptReview {
  switch (value) {
    case "processing":
      return { reviewStatus: "pending", requiresConfirmedDuplicate: false };
    case "needs_review":
      return { reviewStatus: "in_review", requiresConfirmedDuplicate: false };
    case "verified":
      return { reviewStatus: "approved", requiresConfirmedDuplicate: false };
    case "rejected":
      return { reviewStatus: "rejected", requiresConfirmedDuplicate: false };
    case "duplicate":
      return { reviewStatus: "rejected", requiresConfirmedDuplicate: true };
  }
}

export function toDomainReceiptReviewStatus(
  value: DatabaseReceiptReviewStatus,
  options: { hasConfirmedDuplicate?: boolean } = {},
): DocumentReviewStatus {
  if (value === "pending") return "processing";
  if (value === "in_review") return "needs_review";
  if (value === "approved") return "verified";
  return options.hasConfirmedDuplicate ? "duplicate" : "rejected";
}

const correctionToDatabase = {
  pending: "pending",
  approved: "approved",
  declined: "denied",
} as const satisfies Record<
  TimecardCorrection["status"],
  DatabaseCorrectionDecisionStatus
>;

const correctionToDomain = {
  pending: "pending",
  approved: "approved",
  denied: "declined",
} as const satisfies Record<
  DatabaseCorrectionDecisionStatus,
  TimecardCorrection["status"]
>;

export function toDatabaseCorrectionDecision(
  value: TimecardCorrection["status"],
): DatabaseCorrectionDecisionStatus {
  return correctionToDatabase[value];
}

export function toDomainCorrectionDecision(
  value: DatabaseCorrectionDecisionStatus,
): TimecardCorrection["status"] {
  return correctionToDomain[value];
}

const consentToDatabase = {
  unknown: "unknown",
  granted: "granted",
  withdrawn: "revoked",
} as const satisfies Record<ConsentRecord["status"], DatabaseConsentStatus>;

const consentToDomain = {
  unknown: "unknown",
  granted: "granted",
  revoked: "withdrawn",
} as const satisfies Record<DatabaseConsentStatus, ConsentRecord["status"]>;

export function toDatabaseConsentStatus(
  value: ConsentRecord["status"],
): DatabaseConsentStatus {
  return consentToDatabase[value];
}

export function toDomainConsentStatus(
  value: DatabaseConsentStatus,
): ConsentRecord["status"] {
  return consentToDomain[value];
}

const taskToDatabase = {
  todo: "open",
  in_progress: "in_progress",
  blocked: "blocked",
  done: "completed",
  cancelled: "cancelled",
} as const satisfies Record<TaskStatus, DatabaseTaskStatus>;

const taskToDomain = {
  open: "todo",
  in_progress: "in_progress",
  blocked: "blocked",
  completed: "done",
  cancelled: "cancelled",
} as const satisfies Record<DatabaseTaskStatus, TaskStatus>;

export function toDatabaseTaskStatus(value: TaskStatus): DatabaseTaskStatus {
  return taskToDatabase[value];
}

export function toDomainTaskStatus(value: DatabaseTaskStatus): TaskStatus {
  return taskToDomain[value];
}

const integrationSyncToDatabase = {
  queued: "queued",
  running: "running",
  succeeded: "succeeded",
  partial: "partially_succeeded",
  failed: "failed",
  cancelled: "cancelled",
} as const satisfies Record<
  IntegrationSyncStatus,
  DatabaseIntegrationSyncStatus
>;

const integrationSyncToDomain = {
  queued: "queued",
  running: "running",
  succeeded: "succeeded",
  partially_succeeded: "partial",
  failed: "failed",
  cancelled: "cancelled",
} as const satisfies Record<
  DatabaseIntegrationSyncStatus,
  IntegrationSyncStatus
>;

export function toDatabaseIntegrationSyncStatus(
  value: IntegrationSyncStatus,
): DatabaseIntegrationSyncStatus {
  return integrationSyncToDatabase[value];
}

export function toDomainIntegrationSyncStatus(
  value: DatabaseIntegrationSyncStatus,
): IntegrationSyncStatus {
  return integrationSyncToDomain[value];
}

const tipMethodToDatabase = {
  hours: "hours",
  weighted_points: "weighted_hours",
} as const satisfies Record<
  TipDistributionMethod,
  DatabaseTipDistributionMethod
>;

const tipMethodToDomain = {
  hours: "hours",
  weighted_hours: "weighted_points",
} as const satisfies Record<
  Exclude<DatabaseTipDistributionMethod, "points">,
  TipDistributionMethod
>;

export function toDatabaseTipDistributionMethod(
  value: TipDistributionMethod,
): DatabaseTipDistributionMethod {
  return tipMethodToDatabase[value];
}

export function toDomainTipDistributionMethod(
  value: DatabaseTipDistributionMethod,
): TipDistributionMethod {
  if (value === "points") {
    throw new Error(
      "The database points-only tip method has no domain equivalent; select hours or weighted hours.",
    );
  }
  return tipMethodToDomain[value];
}

const chatKindToDatabase = {
  all_staff: "all_staff",
  location: "location",
  management: "management",
  direct: "private",
} as const satisfies Record<ChatChannel["kind"], DatabaseChatChannelKind>;

const chatKindToDomain = {
  all_staff: "all_staff",
  location: "location",
  management: "management",
  private: "direct",
} as const satisfies Record<DatabaseChatChannelKind, ChatChannel["kind"]>;

export function toDatabaseChatChannelKind(
  value: ChatChannel["kind"],
): DatabaseChatChannelKind {
  return chatKindToDatabase[value];
}

export function toDomainChatChannelKind(
  value: DatabaseChatChannelKind,
): ChatChannel["kind"] {
  return chatKindToDomain[value];
}

const aiKindToDatabase = {
  extraction: "receipt_extraction",
  search: "natural_language_search",
  summary: "report_summary",
  anomaly: "anomaly_detection",
  forecast: "forecast",
} as const satisfies Record<AIInsightKind, DatabaseAiRunKind>;

const aiKindToDomain = {
  receipt_extraction: "extraction",
  natural_language_search: "search",
  report_summary: "summary",
  anomaly_detection: "anomaly",
  forecast: "forecast",
} as const satisfies Record<DatabaseAiRunKind, AIInsightKind>;

export function toDatabaseAiRunKind(value: AIInsightKind): DatabaseAiRunKind {
  return aiKindToDatabase[value];
}

export function toDomainAiInsightKind(value: DatabaseAiRunKind): AIInsightKind {
  return aiKindToDomain[value];
}
