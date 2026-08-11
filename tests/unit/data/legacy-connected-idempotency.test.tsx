// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveGuestAction } from "@/app/actions/workflows/guests";
import {
  createManualCsvUploadUrlAction,
  finalizeManualCsvImportAction,
} from "@/app/actions/workflows/integrations";
import { claimLiveOpenShiftAction } from "@/app/actions/workflows/live-schedule";
import { clockInAction } from "@/app/actions/workflows/time";
import { LiveGuestsWorkspace } from "@/components/guests/live-guests-workspace";
import { LiveIntegrationsWorkspace } from "@/components/integrations/live-integrations-workspace";
import { LiveScheduleWorkspace } from "@/components/schedule/live-schedule-workspace";
import { LiveTimeClockWorkspace } from "@/components/time-clock/live-time-clock-workspace";
import type { LiveGuestsModel } from "@/data/read-models/guests";
import type { LiveIntegrationsModel } from "@/data/read-models/integrations";
import type { LiveScheduleModel } from "@/data/read-models/schedule";
import type { LiveTimeClockModel } from "@/data/read-models/time-clock";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

const mocks = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return {
    channel,
    push: vi.fn(),
    refresh: vi.fn(),
    removeChannel: vi.fn(),
    uploadToSignedUrl: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => children,
  KeyboardSensor: class KeyboardSensor {},
  PointerSensor: class PointerSensor {},
  closestCenter: vi.fn(),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Translate: { toString: vi.fn(() => undefined) } },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: vi.fn(() => mocks.channel),
    removeChannel: mocks.removeChannel,
    storage: {
      from: vi.fn(() => ({ uploadToSignedUrl: mocks.uploadToSignedUrl })),
    },
  }),
}));

vi.mock("@/app/actions/workflows/guests", () => ({
  addGuestNoteAction: vi.fn(),
  mergeGuestAction: vi.fn(),
  recordGuestConsentAction: vi.fn(),
  saveGuestAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/integrations", () => ({
  createManualCsvUploadUrlAction: vi.fn(),
  finalizeManualCsvImportAction: vi.fn(),
  retryIntegrationSyncAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/live-schedule", () => ({
  claimLiveOpenShiftAction: vi.fn(),
  createLiveScheduleAction: vi.fn(),
  createLiveShiftAction: vi.fn(),
  decideLiveShiftSwapAction: vi.fn(),
  editLiveShiftAction: vi.fn(),
  moveLiveShiftAction: vi.fn(),
  offerLiveShiftSwapAction: vi.fn(),
  reopenLiveShiftAction: vi.fn(),
  requestLiveShiftSwapAction: vi.fn(),
  saveLiveScheduleTemplateAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/schedule", () => ({
  acknowledgeShiftAction: vi.fn(),
  publishScheduleAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/time", () => ({
  approveTimeCorrectionAction: vi.fn(),
  clockInAction: vi.fn(),
  clockOutAction: vi.fn(),
  endBreakAction: vi.fn(),
  recordMissedTimeEntryAction: vi.fn(),
  requestTimeCorrectionAction: vi.fn(),
  startBreakAction: vi.fn(),
}));

const organizationId = "20000000-0000-4000-8000-000000000001";
const locationId = "30000000-0000-4000-8000-000000000001";
const employeeId = "40000000-0000-4000-8000-000000000001";
const roleId = "50000000-0000-4000-8000-000000000001";
const secondRoleId = "50000000-0000-4000-8000-000000000002";
const scheduleId = "60000000-0000-4000-8000-000000000001";
const shiftId = "70000000-0000-4000-8000-000000000001";

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Connected Admin",
    email: "admin@example.com",
    aal: "aal2",
  },
  organization: { id: organizationId, name: "Connected Restaurant" },
  activeLocation: {
    id: locationId,
    organizationId,
    name: "Main Dining Room",
    isPrimary: true,
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "80000000-0000-4000-8000-000000000001",
  role: "admin",
  organizationWide: true,
  capabilities: [],
};

const retryFailure = {
  ok: false as const,
  persisted: false as const,
  code: "database" as const,
  message: "Retry this unchanged request.",
};

function integrationsModel(): LiveIntegrationsModel {
  return {
    organizationName: workspace.organization.name,
    locationId,
    locationName: workspace.activeLocation.name,
    role: "admin",
    canManageSettings: true,
    ownerNeedsMfa: false,
    connections: [],
    syncJobs: [],
    importJobs: [],
    events: [],
    auditEvents: [],
    syncRecordEvidenceLimited: false,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("legacy connected mutation idempotency", () => {
  it("reuses guest-save IDs for an unchanged retry and changes them with the form payload", async () => {
    const model: LiveGuestsModel = {
      search: "",
      currencyCode: "USD",
      guests: [],
      metrics: {
        activeProfiles: 0,
        vipProfiles: 0,
        profilesWithAllergies: 0,
        upcomingReservations: 0,
      },
      duplicateCandidates: [],
      duplicateScopeLimited: false,
    };
    vi.mocked(saveGuestAction).mockResolvedValue(retryFailure);
    render(
      <LiveGuestsWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
        initialSearch=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add guest" }));
    const dialog = screen.getByRole("dialog", { name: "Add guest" });
    const displayName = within(dialog).getByLabelText("Display name");
    fireEvent.change(displayName, { target: { value: "Taylor Guest" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create profile" }),
    );
    await waitFor(() => expect(saveGuestAction).toHaveBeenCalledTimes(1));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create profile" }),
    );
    await waitFor(() => expect(saveGuestAction).toHaveBeenCalledTimes(2));

    const first = vi.mocked(saveGuestAction).mock.calls[0][0] as {
      requestId: string;
    };
    const retry = vi.mocked(saveGuestAction).mock.calls[1][0] as {
      requestId: string;
    };
    expect(retry.requestId).toBe(first.requestId);

    fireEvent.change(displayName, { target: { value: "Taylor Updated" } });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create profile" }),
    );
    await waitFor(() => expect(saveGuestAction).toHaveBeenCalledTimes(3));
    const changed = vi.mocked(saveGuestAction).mock.calls[2][0] as {
      requestId: string;
    };
    expect(changed.requestId).not.toBe(first.requestId);
  });

  it("keeps clock-in retries stable, changes with the selected role, and rotates after success", async () => {
    const model: LiveTimeClockModel = {
      date: "2026-08-02",
      timeZone: "America/New_York",
      canManage: false,
      employee: { id: employeeId, displayName: "Taylor" },
      roles: [
        { id: roleId, name: "Server", code: "SERVER" },
        { id: secondRoleId, name: "Bartender", code: "BAR" },
      ],
      shifts: [],
      activeEntry: null,
      recentEntries: [],
      roster: [],
      corrections: [],
    };
    vi.mocked(clockInAction).mockResolvedValue(retryFailure);
    render(
      <LiveTimeClockWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );

    const clockIn = screen.getByRole("button", { name: "Clock in" });
    fireEvent.click(clockIn);
    await waitFor(() => expect(clockInAction).toHaveBeenCalledTimes(1));
    fireEvent.click(clockIn);
    await waitFor(() => expect(clockInAction).toHaveBeenCalledTimes(2));
    const first = vi.mocked(clockInAction).mock.calls[0][0] as {
      requestId: string;
    };
    const retry = vi.mocked(clockInAction).mock.calls[1][0] as {
      requestId: string;
    };
    expect(retry.requestId).toBe(first.requestId);

    fireEvent.change(screen.getByLabelText("Job code"), {
      target: { value: secondRoleId },
    });
    fireEvent.click(clockIn);
    await waitFor(() => expect(clockInAction).toHaveBeenCalledTimes(3));
    const changed = vi.mocked(clockInAction).mock.calls[2][0] as {
      requestId: string;
    };
    expect(changed.requestId).not.toBe(first.requestId);

    vi.mocked(clockInAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {},
    } as never);
    fireEvent.click(clockIn);
    await waitFor(() => expect(clockInAction).toHaveBeenCalledTimes(4));
    const successfulRetry = vi.mocked(clockInAction).mock.calls[3][0] as {
      requestId: string;
    };
    expect(successfulRetry.requestId).toBe(changed.requestId);

    fireEvent.click(clockIn);
    await waitFor(() => expect(clockInAction).toHaveBeenCalledTimes(5));
    const afterSuccess = vi.mocked(clockInAction).mock.calls[4][0] as {
      requestId: string;
    };
    expect(afterSuccess.requestId).not.toBe(successfulRetry.requestId);
  });

  it("reuses an open-shift claim ID until success and then rotates it", async () => {
    const model: LiveScheduleModel = {
      weekStart: "2026-08-03",
      previousWeek: "2026-07-27",
      nextWeek: "2026-08-10",
      weekDates: [
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
        "2026-08-09",
      ],
      timeZone: "America/New_York",
      canManage: false,
      canPublish: false,
      selfEmployeeId: employeeId,
      schedule: {
        id: scheduleId,
        status: "published",
        version: 1,
        publishedAt: "2026-08-02T12:00:00.000Z",
      },
      shifts: [
        {
          id: shiftId,
          employeeId: null,
          employeeName: "Open shift",
          jobRoleId: roleId,
          jobName: "Server",
          startsAt: "2026-08-03T20:00:00.000Z",
          endsAt: "2026-08-04T02:00:00.000Z",
          date: "2026-08-03",
          startLabel: "4:00 PM",
          endLabel: "10:00 PM",
          startLocal: "16:00",
          endLocal: "22:00",
          breakMinutes: 0,
          status: "open",
          isOpen: true,
          notes: null,
          acknowledged: false,
        },
      ],
      employees: [],
      jobRoles: [{ id: roleId, name: "Server", code: "SERVER" }],
      templates: [],
      swaps: [],
    };
    vi.mocked(claimLiveOpenShiftAction).mockResolvedValue(retryFailure);
    render(
      <LiveScheduleWorkspace
        workspace={workspace}
        model={{ ok: true, data: model }}
      />,
    );

    const claim = screen.getAllByRole("button", {
      name: "Claim open shift",
    })[0]!;
    fireEvent.click(claim);
    await waitFor(() =>
      expect(claimLiveOpenShiftAction).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect((claim as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(claim);
    await waitFor(() =>
      expect(claimLiveOpenShiftAction).toHaveBeenCalledTimes(2),
    );
    const first = vi.mocked(claimLiveOpenShiftAction).mock.calls[0][0] as {
      requestId: string;
    };
    const retry = vi.mocked(claimLiveOpenShiftAction).mock.calls[1][0] as {
      requestId: string;
    };
    expect(retry.requestId).toBe(first.requestId);

    vi.mocked(claimLiveOpenShiftAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {},
    } as never);
    await waitFor(() =>
      expect((claim as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(claim);
    await waitFor(() =>
      expect(claimLiveOpenShiftAction).toHaveBeenCalledTimes(3),
    );
    const successfulRetry = vi.mocked(claimLiveOpenShiftAction).mock
      .calls[2][0] as {
      requestId: string;
    };
    expect(successfulRetry.requestId).toBe(first.requestId);

    await waitFor(() =>
      expect((claim as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(claim);
    await waitFor(() =>
      expect(claimLiveOpenShiftAction).toHaveBeenCalledTimes(4),
    );
    const afterSuccess = vi.mocked(claimLiveOpenShiftAction).mock
      .calls[3][0] as {
      requestId: string;
    };
    expect(afterSuccess.requestId).not.toBe(successfulRetry.requestId);
  });

  it("keeps import request and upload IDs stable until accepted metadata changes", async () => {
    vi.mocked(createManualCsvUploadUrlAction).mockResolvedValue(retryFailure);
    render(
      <LiveIntegrationsWorkspace
        workspace={workspace}
        result={{ ok: true, data: integrationsModel() }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    const dialog = screen.getByRole("dialog", {
      name: "Validate and queue CSV",
    });
    const input = dialog.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const content = "business_date,net_sales\n2026-08-01,1250.45\n";
    const firstFile = new File([content], "sales.csv", { type: "text/csv" });
    Object.defineProperty(firstFile, "text", { value: async () => content });
    fireEvent.change(input, { target: { files: [firstFile] } });
    expect(
      await screen.findByText(/1 row passed local validation/),
    ).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Queue import" }),
    );
    await waitFor(() =>
      expect(createManualCsvUploadUrlAction).toHaveBeenCalledTimes(1),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Queue import" }),
    );
    await waitFor(() =>
      expect(createManualCsvUploadUrlAction).toHaveBeenCalledTimes(2),
    );
    const first = vi.mocked(createManualCsvUploadUrlAction).mock
      .calls[0][0] as {
      requestId: string;
      uploadId: string;
    };
    const retry = vi.mocked(createManualCsvUploadUrlAction).mock
      .calls[1][0] as {
      requestId: string;
      uploadId: string;
    };
    expect(retry.requestId).toBe(first.requestId);
    expect(retry.uploadId).toBe(first.uploadId);
    expect(finalizeManualCsvImportAction).not.toHaveBeenCalled();

    const changedFile = new File([content], "sales-corrected.csv", {
      type: "text/csv",
    });
    Object.defineProperty(changedFile, "text", { value: async () => content });
    fireEvent.change(input, { target: { files: [changedFile] } });
    await waitFor(() =>
      expect(screen.getByText(/1 row passed local validation/)).toBeTruthy(),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Queue import" }),
    );
    await waitFor(() =>
      expect(createManualCsvUploadUrlAction).toHaveBeenCalledTimes(3),
    );
    const changed = vi.mocked(createManualCsvUploadUrlAction).mock
      .calls[2][0] as {
      requestId: string;
      uploadId: string;
    };
    expect(changed.requestId).not.toBe(first.requestId);
    expect(changed.uploadId).not.toBe(first.uploadId);
  });

  it("retries finalization without re-uploading and rotates import IDs after success", async () => {
    const objectPath = `${organizationId}/${locationId}/imports/request/upload-sales.csv`;
    vi.mocked(createManualCsvUploadUrlAction).mockResolvedValue({
      ok: true,
      persisted: false,
      mode: "live",
      data: {
        bucket: "imports",
        requestId: "90000000-0000-4000-8000-000000000001",
        uploadId: "90000000-0000-4000-8000-000000000002",
        objectPath,
        token: "signed-token",
        mimeType: "text/csv",
        sizeBytes: 50,
        upsert: false,
      },
    } as never);
    mocks.uploadToSignedUrl.mockResolvedValue({
      data: { path: objectPath },
      error: null,
    });
    vi.mocked(finalizeManualCsvImportAction)
      .mockResolvedValueOnce(retryFailure)
      .mockResolvedValue({
        ok: true,
        persisted: true,
        mode: "live",
        data: {
          id: "90000000-0000-4000-8000-000000000003",
          status: "queued",
          totalRows: 1,
          contentHash: "a".repeat(64),
        },
      } as never);
    render(
      <LiveIntegrationsWorkspace
        workspace={workspace}
        result={{ ok: true, data: integrationsModel() }}
      />,
    );

    const content = "business_date,net_sales\n2026-08-01,1250.45\n";
    const file = new File([content], "sales.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => content });
    fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    let dialog = screen.getByRole("dialog", { name: "Validate and queue CSV" });
    let input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(
      await screen.findByText(/1 row passed local validation/),
    ).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Queue import" }),
    );
    await waitFor(() =>
      expect(finalizeManualCsvImportAction).toHaveBeenCalledTimes(1),
    );
    expect(createManualCsvUploadUrlAction).toHaveBeenCalledTimes(1);
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledTimes(1);
    const failedFinalize = vi.mocked(finalizeManualCsvImportAction).mock
      .calls[0][0] as {
      requestId: string;
      uploadId: string;
    };

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Queue import" }),
    );
    await waitFor(() =>
      expect(finalizeManualCsvImportAction).toHaveBeenCalledTimes(2),
    );
    expect(createManualCsvUploadUrlAction).toHaveBeenCalledTimes(1);
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledTimes(1);
    const successfulRetry = vi.mocked(finalizeManualCsvImportAction).mock
      .calls[1][0] as {
      requestId: string;
      uploadId: string;
    };
    expect(successfulRetry.requestId).toBe(failedFinalize.requestId);
    expect(successfulRetry.uploadId).toBe(failedFinalize.uploadId);
    expect(
      await screen.findByText(/queued for server-side import review/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    dialog = screen.getByRole("dialog", { name: "Validate and queue CSV" });
    input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(
      await screen.findByText(/1 row passed local validation/),
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Queue import" }),
    );
    await waitFor(() =>
      expect(createManualCsvUploadUrlAction).toHaveBeenCalledTimes(2),
    );
    const afterSuccess = vi.mocked(createManualCsvUploadUrlAction).mock
      .calls[1][0] as {
      requestId: string;
      uploadId: string;
    };
    expect(afterSuccess.requestId).not.toBe(successfulRetry.requestId);
    expect(afterSuccess.uploadId).not.toBe(successfulRetry.uploadId);
  });
});
