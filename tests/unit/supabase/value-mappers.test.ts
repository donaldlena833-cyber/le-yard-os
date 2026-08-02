import { describe, expect, it } from "vitest";
import {
  toDatabaseAiRunKind,
  toDatabaseChatChannelKind,
  toDatabaseConsentStatus,
  toDatabaseCorrectionDecision,
  toDatabaseIntegrationSyncStatus,
  toDatabaseReceiptReview,
  toDatabaseReportType,
  toDatabaseTaskStatus,
  toDatabaseTipDistributionMethod,
  toDomainAiInsightKind,
  toDomainChatChannelKind,
  toDomainConsentStatus,
  toDomainCorrectionDecision,
  toDomainIntegrationSyncStatus,
  toDomainReceiptReviewStatus,
  toDomainReportKind,
  toDomainTaskStatus,
  toDomainTipDistributionMethod,
  type DatabaseAiRunKind,
  type DatabaseChatChannelKind,
  type DatabaseConsentStatus,
  type DatabaseCorrectionDecisionStatus,
  type DatabaseIntegrationSyncStatus,
  type DatabaseReportType,
  type DatabaseTaskStatus,
  type DatabaseTipDistributionMethod,
} from "@/lib/supabase/value-mappers";
import type {
  AIInsightKind,
  ChatChannel,
  ConsentRecord,
  IntegrationSyncStatus,
  ReportKind,
  TaskStatus,
  TimecardCorrection,
  TipDistributionMethod,
} from "@/types";

function expectRoundTrip<Domain, Database>(
  domainValues: readonly Domain[],
  toDatabase: (value: Domain) => Database,
  toDomain: (value: Database) => Domain,
) {
  for (const value of domainValues) {
    expect(toDomain(toDatabase(value))).toBe(value);
  }
}

describe("database and domain value mappers", () => {
  it("round-trips report types and keeps sales/labor naming explicit", () => {
    const domainValues: readonly ReportKind[] = [
      "labor",
      "attendance",
      "overtime",
      "tips",
      "payroll",
      "sales_to_labor",
      "receipts",
      "expenses",
      "inventory_variance",
      "cogs",
      "waste",
      "vendor_pricing",
      "shift_performance",
      "guest_activity",
    ];
    expectRoundTrip<ReportKind, DatabaseReportType>(
      domainValues,
      toDatabaseReportType,
      toDomainReportKind,
    );
    expect(toDatabaseReportType("sales_to_labor")).toBe("sales_labor");
  });

  it("maps receipt review state without conflating every rejection with a duplicate", () => {
    expect(toDatabaseReceiptReview("processing")).toEqual({
      reviewStatus: "pending",
      requiresConfirmedDuplicate: false,
    });
    expect(toDatabaseReceiptReview("needs_review").reviewStatus).toBe("in_review");
    expect(toDatabaseReceiptReview("verified").reviewStatus).toBe("approved");
    expect(toDomainReceiptReviewStatus("rejected")).toBe("rejected");
    expect(
      toDomainReceiptReviewStatus("rejected", { hasConfirmedDuplicate: true }),
    ).toBe("duplicate");
    expect(toDatabaseReceiptReview("duplicate")).toEqual({
      reviewStatus: "rejected",
      requiresConfirmedDuplicate: true,
    });
  });

  it("round-trips correction decisions, consent, tasks, and sync jobs", () => {
    expectRoundTrip<
      TimecardCorrection["status"],
      DatabaseCorrectionDecisionStatus
    >(
      ["pending", "approved", "declined"],
      toDatabaseCorrectionDecision,
      toDomainCorrectionDecision,
    );
    expect(toDatabaseCorrectionDecision("declined")).toBe("denied");

    expectRoundTrip<ConsentRecord["status"], DatabaseConsentStatus>(
      ["unknown", "granted", "withdrawn"],
      toDatabaseConsentStatus,
      toDomainConsentStatus,
    );
    expect(toDatabaseConsentStatus("withdrawn")).toBe("revoked");

    expectRoundTrip<TaskStatus, DatabaseTaskStatus>(
      ["todo", "in_progress", "blocked", "done", "cancelled"],
      toDatabaseTaskStatus,
      toDomainTaskStatus,
    );
    expect(toDatabaseTaskStatus("todo")).toBe("open");
    expect(toDatabaseTaskStatus("done")).toBe("completed");

    expectRoundTrip<IntegrationSyncStatus, DatabaseIntegrationSyncStatus>(
      ["queued", "running", "succeeded", "partial", "failed", "cancelled"],
      toDatabaseIntegrationSyncStatus,
      toDomainIntegrationSyncStatus,
    );
    expect(toDatabaseIntegrationSyncStatus("partial")).toBe("partially_succeeded");
  });

  it("round-trips tip, channel, and AI naming without silent coercion", () => {
    expectRoundTrip<TipDistributionMethod, DatabaseTipDistributionMethod>(
      ["hours", "weighted_points"],
      toDatabaseTipDistributionMethod,
      toDomainTipDistributionMethod,
    );
    expect(toDatabaseTipDistributionMethod("weighted_points")).toBe("weighted_hours");
    expect(() => toDomainTipDistributionMethod("points")).toThrow(
      /no domain equivalent/i,
    );

    expectRoundTrip<ChatChannel["kind"], DatabaseChatChannelKind>(
      ["all_staff", "location", "management", "direct"],
      toDatabaseChatChannelKind,
      toDomainChatChannelKind,
    );
    expect(toDatabaseChatChannelKind("direct")).toBe("private");

    expectRoundTrip<AIInsightKind, DatabaseAiRunKind>(
      ["extraction", "search", "summary", "anomaly", "forecast"],
      toDatabaseAiRunKind,
      toDomainAiInsightKind,
    );
    expect(toDatabaseAiRunKind("search")).toBe("natural_language_search");
  });
});
