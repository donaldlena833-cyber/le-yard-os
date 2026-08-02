// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveTipPolicyVersionAction,
  configureRetentionPolicyAction,
} from "@/app/actions/workflows/financial-configuration";
import { TipPolicyConfiguration } from "@/components/closeout/tip-policy-configuration";
import { RetentionPolicyConfiguration } from "@/components/settings/retention-policy-configuration";
import type { TipPolicyConfigurationModel } from "@/data/read-models/financial-configuration";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/actions/workflows/financial-configuration", () => ({
  approveTipPolicyVersionAction: vi.fn(),
  configureRetentionPolicyAction: vi.fn(),
  configureTipPolicyAction: vi.fn(),
  saveTipPolicyDraftAction: vi.fn(),
}));

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Donald",
    email: "donald@example.com",
    aal: "aal2",
  },
  organization: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Le Yard",
  },
  activeLocation: {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Dining Room",
    isPrimary: true,
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "40000000-0000-4000-8000-000000000001",
  role: "owner",
  organizationWide: true,
};

const tipModel: TipPolicyConfigurationModel = {
  canAuthor: true,
  roles: [
    {
      id: "60000000-0000-4000-8000-000000000001",
      name: "Server",
      code: "SERVER",
      defaultTipPoints: 1,
      isTipped: true,
    },
  ],
  policies: [
    {
      id: "70000000-0000-4000-8000-000000000001",
      locationId: workspace.activeLocation.id,
      locationName: workspace.activeLocation.name,
      name: "Dinner pool",
      description: null,
      isActive: true,
      createdByUserId: workspace.identity.userId,
      versions: [
        {
          id: "80000000-0000-4000-8000-000000000001",
          version: 1,
          distributionMethod: "hours",
          effectiveFrom: "2026-08-01",
          effectiveTo: null,
          closeoutSources: ["card_tips"],
          createdByUserId: workspace.identity.userId,
          createdBy: "Donald",
          createdAt: "2026-08-01T12:00:00.000Z",
          approvedBy: null,
          approvedAt: null,
          rules: [
            {
              jobRoleId: "60000000-0000-4000-8000-000000000001",
              jobRoleName: "Server",
              eligible: true,
              points: 1,
              minimumMinutes: 30,
            },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("financial configuration UI", () => {
  it("reuses a request id for an unchanged retry and rotates it when payload changes", async () => {
    vi.mocked(configureRetentionPolicyAction).mockResolvedValue({
      ok: false,
      persisted: false,
      code: "database",
      message: "Retry this request.",
    });

    render(
      <RetentionPolicyConfiguration
        workspace={workspace}
        policies={[]}
        canManage
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Record retention decision",
    });
    fireEvent.change(within(dialog).getByLabelText("Data class"), {
      target: { value: "receipts_invoices" },
    });
    fireEvent.click(within(dialog).getByLabelText(/^Timed window/));
    fireEvent.change(within(dialog).getByLabelText("Retention days"), {
      target: { value: "2555" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(configureRetentionPolicyAction).toHaveBeenCalledTimes(1));
    const first = vi.mocked(configureRetentionPolicyAction).mock.calls[0][0] as {
      requestId: string;
    };

    fireEvent.click(within(dialog).getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(configureRetentionPolicyAction).toHaveBeenCalledTimes(2));
    const second = vi.mocked(configureRetentionPolicyAction).mock.calls[1][0] as {
      requestId: string;
    };
    expect(second.requestId).toBe(first.requestId);

    fireEvent.change(within(dialog).getByLabelText("Retention days"), {
      target: { value: "3650" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save decision" }));
    await waitFor(() => expect(configureRetentionPolicyAction).toHaveBeenCalledTimes(3));
    const third = vi.mocked(configureRetentionPolicyAction).mock.calls[2][0] as {
      requestId: string;
    };
    expect(third.requestId).not.toBe(first.requestId);
  });

  it("uses a modal dialog and restores focus when cancelled", async () => {
    render(
      <RetentionPolicyConfiguration
        workspace={workspace}
        policies={[]}
        canManage
      />,
    );
    const opener = screen.getByRole("button", { name: "Record decision" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", {
      name: "Record retention decision",
    });
    expect(dialog.tagName).toBe("DIALOG");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("enforces a different-person tip-policy approval in the UI and retries safely", async () => {
    const { rerender } = render(
      <TipPolicyConfiguration
        workspace={workspace}
        result={{ ok: true, data: tipModel }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Approve v1" })).toBeNull();
    expect(screen.getByText("A different authorized person must approve your draft.")).toBeTruthy();

    const marisWorkspace: WorkspaceContextValue = {
      ...workspace,
      identity: {
        ...workspace.identity,
        userId: "10000000-0000-4000-8000-000000000002",
        displayName: "Maris",
        email: "maris@example.com",
      },
    };
    vi.mocked(approveTipPolicyVersionAction).mockResolvedValue({
      ok: false,
      persisted: false,
      code: "database",
      message: "Retry approval.",
    });
    rerender(
      <TipPolicyConfiguration
        workspace={marisWorkspace}
        result={{ ok: true, data: tipModel }}
      />,
    );

    const approve = screen.getByRole("button", { name: "Approve v1" });
    fireEvent.click(approve);
    await waitFor(() => expect(approveTipPolicyVersionAction).toHaveBeenCalledTimes(1));
    const first = vi.mocked(approveTipPolicyVersionAction).mock.calls[0][0] as {
      requestId: string;
    };
    fireEvent.click(approve);
    await waitFor(() => expect(approveTipPolicyVersionAction).toHaveBeenCalledTimes(2));
    const second = vi.mocked(approveTipPolicyVersionAction).mock.calls[1][0] as {
      requestId: string;
    };
    expect(second.requestId).toBe(first.requestId);
  });

  it("does not offer tip-policy approval to an assigned Manager", () => {
    const managerWorkspace: WorkspaceContextValue = {
      ...workspace,
      identity: {
        ...workspace.identity,
        userId: "10000000-0000-4000-8000-000000000004",
        displayName: "Maya",
        email: "maya@example.com",
        aal: "aal1",
      },
      role: "manager",
      organizationWide: false,
    };

    render(
      <TipPolicyConfiguration
        workspace={managerWorkspace}
        result={{ ok: true, data: tipModel }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Approve v1" })).toBeNull();
  });
});
