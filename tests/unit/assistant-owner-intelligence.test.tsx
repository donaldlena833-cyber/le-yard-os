// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  askOwnerIntelligenceAction,
  executeOwnerIntelligenceProposalAction,
  undoOwnerIntelligenceProposalAction,
} from "@/app/actions/workflows/assistant";
import { AssistantWorkspace } from "@/components/assistant/assistant-workspace";
import { WorkspaceProvider } from "@/components/providers/workspace-provider";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("@/app/actions/workflows/assistant", () => ({
  askLiveOperationsAction: vi.fn(),
  askOwnerIntelligenceAction: vi.fn(),
  executeOwnerIntelligenceProposalAction: vi.fn(),
  undoOwnerIntelligenceProposalAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "11111111-1111-4111-8111-111111111111",
    displayName: "Donald",
    email: "donaldlena@le-yard.local",
    aal: "aal2",
  },
  organization: { id: "20000000-0000-4000-8000-000000000001", name: "Le Yard" },
  activeLocation: {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Le Yard",
    isPrimary: true,
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "21000000-0000-4000-8000-000000000001",
  role: "owner",
  organizationWide: true,
  capabilities: [],
};

const intelligenceAnswer = {
  runId: "dd100000-0000-4000-8000-000000000001",
  title: "Pickup review",
  summary: "A task is ready for your review.",
  confidence: 0.94,
  citations: [{
    sourceTable: "owner_request",
    sourceRecordId: "dd100000-0000-4000-8000-000000000001",
    label: "Your instruction",
    excerpt: "Create a high-priority task to review the pickup list.",
    relevance: 1,
  }],
  proposal: {
    id: "dd200000-0000-4000-8000-000000000001",
    confirmationFingerprint: "a".repeat(64),
    change: {
      kind: "task.create" as const,
      locationId: "30000000-0000-4000-8000-000000000001",
      title: "Review tomorrow pickup list",
      description: "Check names and readiness before service.",
      priority: "high" as const,
      assignedEmployeeId: null,
      dueAt: null,
    },
    status: "pending" as const,
    taskId: null,
  },
  model: "gpt-5.6-luna" as const,
  sourceMode: "codex_subscription" as const,
};

describe("owner intelligence confirmation boundary", () => {
  it("does not create a task until the owner reviews and confirms, then offers undo", async () => {
    vi.mocked(askOwnerIntelligenceAction).mockResolvedValue({ ok: true, answer: intelligenceAnswer });
    vi.mocked(executeOwnerIntelligenceProposalAction).mockResolvedValue({
      ok: true,
      proposalId: intelligenceAnswer.proposal.id,
      taskId: "dd300000-0000-4000-8000-000000000001",
      status: "open",
    });
    vi.mocked(undoOwnerIntelligenceProposalAction).mockResolvedValue({
      ok: true,
      proposalId: intelligenceAnswer.proposal.id,
      taskId: "dd300000-0000-4000-8000-000000000001",
      status: "cancelled",
    });

    render(<WorkspaceProvider value={workspace}><AssistantWorkspace /></WorkspaceProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: /ask a question/i }), {
      target: { value: "Create a high-priority task to review tomorrow's pickup list" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask Le Yard" }));

    const reviewButton = await screen.findByRole("button", { name: "Review & save" });
    expect(executeOwnerIntelligenceProposalAction).not.toHaveBeenCalled();
    await waitFor(() => expect(reviewButton).toHaveProperty("disabled", false));
    fireEvent.click(reviewButton);

    const dialog = await screen.findByRole("alertdialog", {}, { timeout: 5_000 });
    expect(within(dialog).getByRole("heading", { name: "Create this task?" })).toBeTruthy();
    expect(within(dialog).getByText("Review tomorrow pickup list")).toBeTruthy();
    expect(executeOwnerIntelligenceProposalAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm & create task" }));
    await waitFor(() => expect(executeOwnerIntelligenceProposalAction).toHaveBeenCalledWith({
      proposalId: intelligenceAnswer.proposal.id,
      confirmationFingerprint: intelligenceAnswer.proposal.confirmationFingerprint,
    }));
    const undoButton = await screen.findByRole("button", { name: "Undo task" });
    await waitFor(() => expect(undoButton).toHaveProperty("disabled", false));
    fireEvent.click(undoButton);
    await waitFor(() => expect(undoOwnerIntelligenceProposalAction).toHaveBeenCalledWith({
      proposalId: intelligenceAnswer.proposal.id,
      reason: "Undone by the owner from Ask Le Yard.",
    }));
    expect(await screen.findByText("Undone")).toBeTruthy();
  }, 15_000);
});
