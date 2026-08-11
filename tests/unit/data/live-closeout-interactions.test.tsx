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

import { approveCloseoutAction } from "@/app/actions/workflows/closeout";
import { LiveCloseoutWorkspace } from "@/components/closeout/live-closeout-workspace";
import type { LiveCloseoutModel } from "@/data/read-models/closeout";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/components/closeout/tip-policy-configuration", () => ({
  TipPolicyConfiguration: () => null,
}));

vi.mock("@/app/actions/workflows/closeout", () => ({
  approveCloseoutAction: vi.fn(),
  createCloseoutUploadUrlAction: vi.fn(),
  finalizeCloseoutUploadAction: vi.fn(),
  submitCloseoutAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/tips", () => ({
  approveTipRunAction: vi.fn(),
  calculateTipRunAction: vi.fn(),
  exportTipPayrollAction: vi.fn(),
  prepareTipRunAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/files", () => ({
  createPrivateFileDownloadUrlAction: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

const userId = "10000000-0000-4000-8000-000000000001";
const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId,
    displayName: "Connected Manager",
    email: "manager@example.com",
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
  role: "manager",
  organizationWide: false,
  capabilities: ["closeout.create", "closeout.approve"],
};

const closeoutId = "50000000-0000-4000-8000-000000000001";
const model: LiveCloseoutModel = {
  date: "2026-08-10",
  timeZone: "America/New_York",
  currencyCode: "USD",
  closeouts: [
    {
      id: closeoutId,
      businessDate: "2026-08-10",
      shiftLabel: "Dinner",
      status: "pending",
      grossSalesCents: 12_000,
      netSalesCents: 11_500,
      cashSalesCents: 2_500,
      cardSalesCents: 9_000,
      expectedCashCents: 2_500,
      actualCashCents: 2_500,
      covers: 54,
      compsCents: 300,
      voidsCents: 200,
      serviceChargesCents: 0,
      cardTipsCents: 1_800,
      cashTipsCents: 400,
      notes: "Register and source totals reconciled.",
      submittedByUserId: "10000000-0000-4000-8000-000000000099",
      submittedBy: "Another Manager",
      submittedAt: "2026-08-11T03:00:00.000Z",
      approvedBy: null,
      approvedAt: null,
      attachments: [],
    },
  ],
  policies: [],
  tipRuns: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("connected closeout object actions", () => {
  it("exposes named evidence and decisions, then confirms an irreversible approval", async () => {
    vi.mocked(approveCloseoutAction).mockResolvedValue({ ok: true } as never);
    render(
      <LiveCloseoutWorkspace
        workspace={workspace}
        result={{ ok: true, data: model }}
        policyConfigurationResult={{ ok: false, message: "Restricted." }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Attach evidence" }),
    ).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    fireEvent.click(approve);

    const dialog = screen.getByRole("alertdialog", {
      name: "Approve and lock this closeout?",
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Approve closeout" }),
    );

    await waitFor(() =>
      expect(approveCloseoutAction).toHaveBeenCalledWith({
        closeoutId,
        approved: true,
        note: null,
      }),
    );
    expect(
      await screen.findByText("Closeout approved and locked."),
    ).toBeTruthy();
  });

  it("does not render mutation affordances without the exact capabilities", () => {
    render(
      <LiveCloseoutWorkspace
        workspace={{ ...workspace, capabilities: [] }}
        result={{ ok: true, data: model }}
        policyConfigurationResult={{ ok: false, message: "Restricted." }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Attach evidence" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
});
