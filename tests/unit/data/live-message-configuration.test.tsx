// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatChannelAction } from "@/app/actions/workflows/configuration";
import { LiveMessagesWorkspace } from "@/components/messages/live-messages-workspace";
import type { LiveMessagesModel } from "@/data/read-models/messages";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/actions/workflows/configuration", () => ({
  createChatChannelAction: vi.fn(),
  setChatChannelArchivedAction: vi.fn(),
  setPrivateChatChannelMembersAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/chat", () => ({
  markChatReadAction: vi.fn(),
  sendChatMessageAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/live-chat", () => ({
  acknowledgeLiveAnnouncementAction: vi.fn(),
  createChatAttachmentUploadUrlAction: vi.fn(),
  finalizeChatAttachmentAction: vi.fn(),
  toggleLiveChatReactionAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/files", () => ({
  createPrivateFileDownloadUrlAction: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  }),
}));

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "11111111-1111-4111-8111-111111111111",
    displayName: "Donald",
    email: "donald@example.com",
    aal: "aal2",
  },
  organization: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Le Yard",
  },
  activeLocation: {
    id: "33333333-3333-4333-8333-333333333333",
    organizationId: "22222222-2222-4222-8222-222222222222",
    name: "Main Dining Room",
    isPrimary: true,
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "44444444-4444-4444-8444-444444444444",
  role: "manager",
  organizationWide: false,
};

const model: LiveMessagesModel = {
  channels: [],
  messages: [],
  profiles: [
    { id: workspace.identity.userId, name: "Donald", role: "manager" },
    { id: "55555555-5555-4555-8555-555555555555", name: "Maris", role: "owner" },
  ],
  locations: [{ id: workspace.activeLocation.id, name: workspace.activeLocation.name }],
  canAnnounce: true,
  canManageChannels: true,
  timeZone: "America/New_York",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("connected Messages channel configuration", () => {
  it("creates the first live channel and reuses the request id after a transient failure", async () => {
    vi.mocked(createChatChannelAction)
      .mockResolvedValueOnce({
        ok: false,
        code: "database",
        message: "Temporary database error.",
        persisted: false,
      })
      .mockResolvedValueOnce({
        ok: true,
        persisted: true,
        mode: "live",
        data: {
          id: "66666666-6666-4666-8666-666666666666",
          kind: "location",
          locationId: workspace.activeLocation.id,
          name: "Main service",
          description: null,
          archived: false,
        },
      });

    render(<LiveMessagesWorkspace workspace={workspace} model={{ ok: true, data: model }} />);
    fireEvent.click(screen.getByRole("button", { name: "Create first channel" }));
    const panel = screen.getByRole("region", { name: "Channel management" });
    fireEvent.change(within(panel).getByLabelText("Name"), {
      target: { value: "Main service" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Create" }));
    expect(await within(panel).findByText("Temporary database error.")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Create" }));
    expect(await within(panel).findByText("Channel created with server-validated access.")).toBeTruthy();

    await waitFor(() => expect(createChatChannelAction).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(createChatChannelAction).mock.calls.map(([input]) => input as Record<string, unknown>);
    expect(first).toEqual(expect.objectContaining({
      organizationId: workspace.organization.id,
      kind: "location",
      locationId: workspace.activeLocation.id,
      name: "Main service",
      memberIds: [],
    }));
    expect(first.requestId).toBe(second.requestId);
  });
});
