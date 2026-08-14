// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acknowledgeLiveAnnouncementAction } from "@/app/actions/workflows/live-chat";
import { markChatReadAction } from "@/app/actions/workflows/chat";
import { createChatChannelAction } from "@/app/actions/workflows/configuration";
import { LiveMessagesWorkspace } from "@/components/messages/live-messages-workspace";
import type { LiveMessagesModel } from "@/data/read-models/messages";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

const realtimeHarness = vi.hoisted(() => ({
  callbacks: new Map<string, (payload: unknown) => void>(),
  channel: vi.fn(),
  from: vi.fn(),
  removeChannel: vi.fn(),
  statusCallbacks: [] as Array<(status: string) => void>,
}));
const routerHarness = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerHarness,
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
    channel: realtimeHarness.channel,
    from: realtimeHarness.from,
    removeChannel: realtimeHarness.removeChannel,
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
  capabilities: [],
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

const channelId = "66666666-6666-4666-8666-666666666666";
const messageId = "77777777-7777-4777-8777-777777777777";
const attachmentId = "88888888-8888-4888-8888-888888888888";

function liveModelWithEvidence({
  acknowledgementCount = 1,
  acknowledgedByMe = true,
  attachments = true,
  reactions = true,
}: {
  acknowledgementCount?: number;
  acknowledgedByMe?: boolean;
  attachments?: boolean;
  reactions?: boolean;
} = {}): LiveMessagesModel {
  return {
    ...model,
    channels: [{
      id: channelId,
      name: "All staff",
      description: null,
      kind: "all_staff",
      locationId: null,
      memberIds: [workspace.identity.userId],
      unreadCount: 0,
    }],
    messages: [{
      id: messageId,
      channelId,
      authorId: workspace.identity.userId,
      authorName: "Donald",
      replyToId: null,
      body: "Service brief",
      isAnnouncement: true,
      editedAt: null,
      createdAt: "2026-08-11T12:00:00.000Z",
      reactions: reactions
        ? [{ emoji: "👍", userIds: [workspace.identity.userId] }]
        : [],
      attachments: attachments
        ? [{
            id: attachmentId,
            fileName: "Prep.pdf",
            mimeType: "application/pdf",
            sizeBytes: 100,
            storagePath: "chat/prep.pdf",
          }]
        : [],
      readByCount: 0,
      acknowledgementCount,
      acknowledgedByMe,
    }],
  };
}

type EvidenceTable =
  | "chat_reactions"
  | "chat_attachments"
  | "announcement_acknowledgements";
type EvidenceResult = { data: unknown[]; error: null | { message: string } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function setupRealtimeChannel() {
  const channel = {
    on: vi.fn(
      (_kind: string, config: { table: string }, callback: (payload: unknown) => void) => {
        realtimeHarness.callbacks.set(config.table, callback);
        return channel;
      },
    ),
    subscribe: vi.fn((callback: (status: string) => void) => {
      realtimeHarness.statusCallbacks.push(callback);
      callback("SUBSCRIBED");
      return channel;
    }),
  };
  realtimeHarness.channel.mockReturnValue(channel);
  return channel;
}

function setupEvidenceQueues(
  queues: Record<EvidenceTable, Array<EvidenceResult | Promise<EvidenceResult>>>,
) {
  realtimeHarness.from.mockImplementation((table: EvidenceTable) => {
    const next = queues[table].shift();
    if (!next) throw new Error(`Missing ${table} evidence response`);
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(() => Promise.resolve(next)),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.order.mockReturnValue(builder);
    return builder;
  });
}

function evidenceRound({
  acknowledgementRows = [],
  attachmentRows = [],
  reactionRows = [],
}: {
  acknowledgementRows?: unknown[];
  attachmentRows?: unknown[];
  reactionRows?: unknown[];
} = {}) {
  return {
    announcement_acknowledgements: {
      data: acknowledgementRows,
      error: null,
    } satisfies EvidenceResult,
    chat_attachments: { data: attachmentRows, error: null } satisfies EvidenceResult,
    chat_reactions: { data: reactionRows, error: null } satisfies EvidenceResult,
  };
}

function setupReadSuccess() {
  vi.mocked(markChatReadAction).mockResolvedValue({
    ok: true,
    persisted: true,
    mode: "live",
    data: {
      id: "99999999-9999-4999-8999-999999999999",
      channelId,
      lastReadMessageId: messageId,
      lastReadAt: "2026-08-11T12:00:00.000Z",
      alreadyApplied: false,
    },
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  realtimeHarness.callbacks.clear();
  realtimeHarness.statusCallbacks.length = 0;
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
    const retryButton = within(panel).getByRole("button", { name: "Create" }) as HTMLButtonElement;
    await waitFor(() => expect(retryButton.disabled).toBe(false));
    fireEvent.click(retryButton);
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

  it("catches up a child deletion missed before the first subscription", async () => {
    setupReadSuccess();
    setupRealtimeChannel();
    const empty = evidenceRound();
    setupEvidenceQueues({
      announcement_acknowledgements: [empty.announcement_acknowledgements],
      chat_attachments: [empty.chat_attachments],
      chat_reactions: [empty.chat_reactions],
    });

    render(<LiveMessagesWorkspace workspace={workspace} model={{ ok: true, data: liveModelWithEvidence() }} />);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "👍 reaction from 1 people" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Prep\.pdf/ })).toBeNull();
      expect(screen.getByText("0 total")).toBeTruthy();
    });
    expect(realtimeHarness.from).toHaveBeenCalledTimes(3);
  });

  it("generation-fences a stale read when a later child insert arrives", async () => {
    setupReadSuccess();
    setupRealtimeChannel();
    const firstReaction = deferred<EvidenceResult>();
    const firstAttachment = deferred<EvidenceResult>();
    const firstAcknowledgement = deferred<EvidenceResult>();
    const secondReaction = deferred<EvidenceResult>();
    const secondAttachment = deferred<EvidenceResult>();
    const secondAcknowledgement = deferred<EvidenceResult>();
    setupEvidenceQueues({
      announcement_acknowledgements: [firstAcknowledgement.promise, secondAcknowledgement.promise],
      chat_attachments: [firstAttachment.promise, secondAttachment.promise],
      chat_reactions: [firstReaction.promise, secondReaction.promise],
    });

    render(<LiveMessagesWorkspace workspace={workspace} model={{
      ok: true,
      data: liveModelWithEvidence({
        acknowledgementCount: 0,
        acknowledgedByMe: false,
        attachments: false,
        reactions: false,
      }),
    }} />);
    await act(async () => {
      realtimeHarness.callbacks.get("chat_reactions")?.({
        eventType: "INSERT",
        new: {
          message_id: messageId,
          user_id: workspace.identity.userId,
          emoji: "👍",
        },
      });
    });
    expect(screen.getByRole("button", { name: "👍 reaction from 1 people" })).toBeTruthy();

    await act(async () => {
      firstReaction.resolve({ data: [], error: null });
      firstAttachment.resolve({ data: [], error: null });
      firstAcknowledgement.resolve({ data: [], error: null });
      await Promise.resolve();
    });
    expect(realtimeHarness.from).toHaveBeenCalledTimes(6);
    expect(screen.getByRole("button", { name: "👍 reaction from 1 people" })).toBeTruthy();

    await act(async () => {
      secondReaction.resolve({
        data: [{
          message_id: messageId,
          user_id: workspace.identity.userId,
          emoji: "👍",
          created_at: "2026-08-11T12:01:00.000Z",
        }],
        error: null,
      });
      secondAttachment.resolve({ data: [], error: null });
      secondAcknowledgement.resolve({ data: [], error: null });
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "👍 reaction from 1 people" })).toBeTruthy();
  });

  it("performs authoritative child recovery after a channel reconnect", async () => {
    vi.useFakeTimers();
    setupReadSuccess();
    setupRealtimeChannel();
    const current = evidenceRound({
      reactionRows: [{
        message_id: messageId,
        user_id: workspace.identity.userId,
        emoji: "👍",
        created_at: "2026-08-11T12:00:00.000Z",
      }],
    });
    const removed = evidenceRound();
    setupEvidenceQueues({
      announcement_acknowledgements: [current.announcement_acknowledgements, removed.announcement_acknowledgements],
      chat_attachments: [current.chat_attachments, removed.chat_attachments],
      chat_reactions: [current.chat_reactions, removed.chat_reactions],
    });

    render(<LiveMessagesWorkspace workspace={workspace} model={{
      ok: true,
      data: liveModelWithEvidence({
        acknowledgementCount: 0,
        acknowledgedByMe: false,
        attachments: false,
      }),
    }} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "👍 reaction from 1 people" })).toBeTruthy();

    await act(async () => {
      realtimeHarness.statusCallbacks[0]?.("CHANNEL_ERROR");
      await vi.advanceTimersByTimeAsync(1_500);
      await Promise.resolve();
    });
    expect(realtimeHarness.statusCallbacks).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "👍 reaction from 1 people" })).toBeNull();
  });

  it("retries a transient evidence query failure before applying convergence", async () => {
    vi.useFakeTimers();
    setupReadSuccess();
    setupRealtimeChannel();
    const removed = evidenceRound();
    setupEvidenceQueues({
      announcement_acknowledgements: [removed.announcement_acknowledgements, removed.announcement_acknowledgements],
      chat_attachments: [removed.chat_attachments, removed.chat_attachments],
      chat_reactions: [
        { data: [], error: { message: "temporary" } },
        removed.chat_reactions,
      ],
    });

    render(<LiveMessagesWorkspace workspace={workspace} model={{
      ok: true,
      data: liveModelWithEvidence({
        acknowledgementCount: 0,
        acknowledgedByMe: false,
        attachments: false,
      }),
    }} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "👍 reaction from 1 people" })).toBeTruthy();
    expect(realtimeHarness.from).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });
    expect(realtimeHarness.from).toHaveBeenCalledTimes(6);
    expect(screen.queryByRole("button", { name: "👍 reaction from 1 people" })).toBeNull();
    expect(routerHarness.refresh).not.toHaveBeenCalled();
  });

  it("does not double-count an acknowledgement when the action resolves before its insert event", async () => {
    setupReadSuccess();
    setupRealtimeChannel();
    const empty = evidenceRound();
    setupEvidenceQueues({
      announcement_acknowledgements: [empty.announcement_acknowledgements],
      chat_attachments: [empty.chat_attachments],
      chat_reactions: [empty.chat_reactions],
    });
    vi.mocked(acknowledgeLiveAnnouncementAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        acknowledgedAt: "2026-08-11T12:01:00.000Z",
        alreadyApplied: false,
      },
    });

    render(<LiveMessagesWorkspace workspace={workspace} model={{
      ok: true,
      data: liveModelWithEvidence({
        acknowledgementCount: 0,
        acknowledgedByMe: false,
        attachments: false,
        reactions: false,
      }),
    }} />);
    await waitFor(() => expect(realtimeHarness.from).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(screen.getByText("1 total")).toBeTruthy());

    await act(async () => {
      realtimeHarness.callbacks.get("announcement_acknowledgements")?.({
        eventType: "INSERT",
        new: {
          message_id: messageId,
          user_id: workspace.identity.userId,
        },
      });
    });
    expect(screen.getByText("1 total")).toBeTruthy();
    expect(screen.getByText("Acknowledged")).toBeTruthy();
  });
});
