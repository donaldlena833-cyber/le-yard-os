import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: vi.fn() }));
vi.mock("@/data/read-models/reports", () => ({
  isLiveReportKind: vi.fn(),
  loadLiveReport: vi.fn(),
}));
vi.mock("@/data/read-models/shared", () => ({ isIsoCalendarDate: vi.fn() }));
vi.mock("@/lib/supabase/value-mappers", () => ({ toDatabaseReportType: vi.fn() }));

import { finalizeInlineReportExport } from "@/app/api/exports/reports/live-report-request";

const audit = {
  requestId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
};

describe("inline report export finalization", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { id: audit.requestId }, error: null });
  });

  it("atomically records a successful export through the service-only RPC", async () => {
    await finalizeInlineReportExport(audit, {
      status: "succeeded",
      rowCount: 17,
      summary: { report_kind: "tips" },
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("complete_report_export", {
      p_export_id: audit.requestId,
      p_status: "succeeded",
      p_row_count: 17,
      p_result_summary: { report_kind: "tips" },
      p_error_message: null,
    });
  });

  it("records a bounded terminal failure through the same atomic RPC", async () => {
    await finalizeInlineReportExport(audit, {
      status: "failed",
      errorMessage: "x".repeat(2_100),
    });

    expect(rpc).toHaveBeenCalledWith("complete_report_export", {
      p_export_id: audit.requestId,
      p_status: "failed",
      p_row_count: 0,
      p_result_summary: {},
      p_error_message: "x".repeat(2_000),
    });
  });

  it("withholds completion when the atomic database transition fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });

    await expect(
      finalizeInlineReportExport(audit, {
        status: "succeeded",
        rowCount: 1,
        summary: {},
      }),
    ).rejects.toThrow("The export audit record could not be finalized.");
  });
});
