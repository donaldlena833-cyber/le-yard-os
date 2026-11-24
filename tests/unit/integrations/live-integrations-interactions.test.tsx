// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureSquareProductionSourceAction,
  createManualCsvUploadUrlAction,
  finalizeManualCsvImportAction,
  syncSquareProductionSourceAction,
} from "@/app/actions/workflows/integrations";
import { LiveIntegrationsWorkspace } from "@/components/integrations/live-integrations-workspace";
import type { LiveIntegrationsModel } from "@/data/read-models/integrations";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { PrivateObjectPath } from "@/lib/storage/private-files";

const refresh = vi.fn();
const uploadToSignedUrl = vi.fn();
const removeChannel = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/actions/workflows/integrations", () => ({
  configureSquareProductionSourceAction: vi.fn(),
  createManualCsvUploadUrlAction: vi.fn(),
  finalizeManualCsvImportAction: vi.fn(),
  retryIntegrationSyncAction: vi.fn(),
  syncSquareProductionSourceAction: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => {
    const channel = { on: vi.fn(), subscribe: vi.fn() };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    return {
      channel: vi.fn(() => channel),
      removeChannel,
      storage: {
        from: vi.fn(() => ({ uploadToSignedUrl })),
      },
    };
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Connected Admin",
    email: "admin@example.com",
    aal: "aal2",
  },
  organization: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Connected Restaurant",
  },
  activeLocation: {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Main Dining Room",
    isPrimary: true,
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "admin",
  organizationWide: true,
  capabilities: [],
};

const model: LiveIntegrationsModel = {
  organizationName: workspace.organization.name,
  locationId: workspace.activeLocation.id,
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

describe("connected integration import interactions", () => {
  it("saves only location identifiers and lets the owner retry the same unconfirmed import", async () => {
    vi.mocked(configureSquareProductionSourceAction).mockResolvedValue({
      ok: true, persisted: true, mode: "live",
      data: { id: "50000000-0000-4000-8000-000000000001", status: "pending" },
    });
    vi.mocked(syncSquareProductionSourceAction).mockRejectedValueOnce(new Error("connection dropped"))
      .mockResolvedValueOnce({
        ok: true, persisted: true, mode: "live",
        data: { id: "50000000-0000-4000-8000-000000000002", windowFrom: "2026-11-12T11:00:00Z", windowTo: "2026-11-13T11:00:00Z",
          recordsProcessed: 3, versionsInserted: 3, headsAdvanced: 3, replayedRecords: 0, staleRecords: 0,
          sourceCounts: { orders: 1, payments: 2, refunds: 0 }, financialPostingEnabled: false, reconciliation: "pending", replayed: true },
      });
    const connected = { ...model, connections: [{
      id: "50000000-0000-4000-8000-000000000001", provider: "square", displayName: "Square · Ninth Avenue",
      locationId: workspace.activeLocation.id, scopeLabel: "Ninth Avenue", adapterVersion: "square-source-evidence-v1",
      status: "pending", lastSyncedAt: null, capabilities: [], createdAt: "2026-11-13T11:00:00Z", updatedAt: "2026-11-13T11:00:00Z",
    }] };
    render(<LiveIntegrationsWorkspace workspace={workspace} squareSetup="ready" squareSyncEnabled result={{ ok: true, data: connected }} />);
    fireEvent.click(screen.getByRole("button", { name: "Square integration details" }));
    fireEvent.change(await screen.findByLabelText("Square merchant ID"), { target: { value: "MERCHANT_TEST" } });
    fireEvent.change(screen.getByLabelText("Square location ID"), { target: { value: "LOCATION_TEST" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and save location" }));
    expect(await screen.findByText(/location verified and saved/)).toBeTruthy();
    expect(configureSquareProductionSourceAction).toHaveBeenCalledWith({
      organizationId: workspace.organization.id, locationId: workspace.activeLocation.id,
      requestId: expect.any(String), merchantId: "MERCHANT_TEST", squareLocationId: "LOCATION_TEST",
    });
    const run = screen.getByRole("button", { name: "Import last 24 hours" });
    fireEvent.click(run);
    expect(await screen.findByText(/could not be confirmed/)).toBeTruthy();
    fireEvent.click(run);
    expect(await screen.findByText(/Read 1 orders, 2 payments, and 0 refunds/)).toBeTruthy();
    expect(vi.mocked(syncSquareProductionSourceAction).mock.calls[1]).toEqual(
      vi.mocked(syncSquareProductionSourceAction).mock.calls[0],
    );
  });
  it("blocks file selection before upload when no processor is deployed", () => {
    render(
      <LiveIntegrationsWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
        manualCsvProcessorEnabled={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "CSV import unavailable" }));

    expect(screen.queryByRole("dialog", { name: "Validate and queue CSV" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "No file was selected or uploaded",
    );
    expect(createManualCsvUploadUrlAction).not.toHaveBeenCalled();
  });

  it("opens provider evidence in a labelled, dismissible drawer", async () => {
    render(
      <LiveIntegrationsWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "Square integration details",
    });
    trigger.focus();
    fireEvent.click(trigger);

    const drawer = await screen.findByRole("dialog", { name: "Square" });
    expect(drawer.textContent).toContain("Credential material is intentionally absent");
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Close integration details" }),
      );
    });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Square" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("validates locally, signs privately, and sends only resource-scoped input", async () => {
    const objectPath = `${workspace.organization.id}/${workspace.activeLocation.id}/imports/50000000-0000-4000-8000-000000000001/60000000-0000-4000-8000-000000000001-sales.csv` as PrivateObjectPath;
    vi.mocked(createManualCsvUploadUrlAction).mockResolvedValue({
      ok: true,
      persisted: false,
      mode: "live",
      data: {
        bucket: "imports",
        requestId: "50000000-0000-4000-8000-000000000001",
        uploadId: "60000000-0000-4000-8000-000000000001",
        objectPath,
        token: "signed-token",
        mimeType: "text/csv",
        sizeBytes: 50,
        upsert: false,
      },
    });
    uploadToSignedUrl.mockResolvedValue({ data: { path: objectPath }, error: null });
    vi.mocked(finalizeManualCsvImportAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {
        id: "70000000-0000-4000-8000-000000000001",
        status: "queued",
        totalRows: 1,
        contentHash: "a".repeat(64),
      },
    });

    render(<LiveIntegrationsWorkspace workspace={workspace} result={{ ok: true, data: model }} />);
    fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    const dialog = screen.getByRole("dialog", { name: "Validate and queue CSV" });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    const content = "name,base_unit\nTomatoes,each\n";
    const file = new File([content], "sales.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => content });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/1 row passed local validation/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Queue import" }));

    await waitFor(() => expect(finalizeManualCsvImportAction).toHaveBeenCalledOnce());
    const preparedInput = vi.mocked(createManualCsvUploadUrlAction).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const finalizedInput = vi.mocked(finalizeManualCsvImportAction).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(preparedInput).toMatchObject({
      locationId: workspace.activeLocation.id,
      importType: "inventory_items",
      fileName: "sales.csv",
      mimeType: "text/csv",
    });
    expect(preparedInput).not.toHaveProperty("organizationId");
    expect(preparedInput).not.toHaveProperty("actorId");
    expect(finalizedInput).not.toHaveProperty("headers");
    expect(finalizedInput).not.toHaveProperty("totalRows");
    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      objectPath,
      "signed-token",
      file,
      { contentType: "text/csv" },
    );
    expect(await screen.findByText(/queued for server-side import review/)).toBeTruthy();
  });
});
