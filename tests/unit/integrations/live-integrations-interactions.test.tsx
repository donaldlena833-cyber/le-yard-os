// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createManualCsvUploadUrlAction,
  finalizeManualCsvImportAction,
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
  createManualCsvUploadUrlAction: vi.fn(),
  finalizeManualCsvImportAction: vi.fn(),
  retryIntegrationSyncAction: vi.fn(),
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
    const content = "business_date,net_sales\n2026-08-01,1250.45\n";
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
      importType: "toast_sales",
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
