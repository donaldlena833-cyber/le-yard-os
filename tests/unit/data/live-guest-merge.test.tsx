// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeGuestAction } from "@/app/actions/workflows/guests";
import { LiveGuestsWorkspace } from "@/components/guests/live-guests-workspace";
import type {
  LiveGuestDuplicateProfile,
  LiveGuestsModel,
} from "@/data/read-models/guests";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

const mocks = vi.hoisted(() => {
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return {
    channel,
    refresh: vi.fn(),
    push: vi.fn(),
    removeChannel: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mocks.refresh,
    push: mocks.push,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: vi.fn(() => mocks.channel),
    removeChannel: mocks.removeChannel,
  }),
}));

vi.mock("@/app/actions/workflows/guests", () => ({
  addGuestNoteAction: vi.fn(),
  mergeGuestAction: vi.fn(),
  recordGuestConsentAction: vi.fn(),
  saveGuestAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const organizationId = "20000000-0000-4000-8000-000000000001";
const locationId = "30000000-0000-4000-8000-000000000001";
const sourceId = "40000000-0000-4000-8000-000000000001";
const targetId = "40000000-0000-4000-8000-000000000002";
const requestId = "50000000-0000-4000-8000-000000000001";

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000001",
    displayName: "Connected Owner",
    email: "owner@example.com",
    aal: "aal2",
  },
  organization: { id: organizationId, name: "Connected Restaurant" },
  activeLocation: {
    id: locationId,
    organizationId,
    name: "Main Dining Room",
    isPrimary: true,
  },
  locations: [
    {
      id: locationId,
      organizationId,
      name: "Main Dining Room",
      isPrimary: true,
    },
  ],
  availableWorkspaces: [],
  membershipId: "60000000-0000-4000-8000-000000000001",
  role: "owner",
  organizationWide: true,
  capabilities: [],
};

function duplicateProfile(
  id: string,
  displayName: string,
  overrides: Partial<LiveGuestDuplicateProfile> = {},
): LiveGuestDuplicateProfile {
  return {
    id,
    displayName,
    email: `${displayName.toLowerCase().replaceAll(" ", ".")}@example.com`,
    phone: "212-555-0199",
    vip: false,
    lastVisitAt: "2026-07-20T22:00:00.000Z",
    visitCount: 3,
    lifetimeSpendCents: 25_000,
    source: "manual",
    ...overrides,
  };
}

function model(): LiveGuestsModel {
  const source = duplicateProfile(sourceId, "Alex Archive", {
    visitCount: 1,
    lifetimeSpendCents: 5_000,
  });
  const target = duplicateProfile(targetId, "Alex Survivor", {
    vip: true,
    visitCount: 7,
    lifetimeSpendCents: 72_500,
  });
  return {
    search: "",
    currencyCode: "CAD",
    guests: [],
    metrics: {
      activeProfiles: 2,
      vipProfiles: 1,
      profilesWithAllergies: 0,
      upcomingReservations: 0,
    },
    duplicateCandidates: [
      {
        leftGuestId: source.id,
        rightGuestId: target.id,
        leftName: source.displayName,
        rightName: target.displayName,
        left: source,
        right: target,
        reason: "Exact normalized phone match",
      },
    ],
    duplicateScopeLimited: false,
  };
}

describe("connected CRM guest merge review", () => {
  it("requires a survivor choice and explicit confirmation before calling the atomic merge", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    vi.mocked(mergeGuestAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {
        id: requestId,
        sourceGuestId: sourceId,
        targetGuestId: targetId,
        mergedAt: "2026-08-01T20:00:00.000Z",
        alreadyApplied: false,
      },
    });

    render(
      <LiveGuestsWorkspace
        workspace={workspace}
        result={{ ok: true, data: model() }}
        initialSearch=""
      />,
    );

    expect(mergeGuestAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review matches" }));
    expect(screen.getByText("Possible duplicate profiles")).toBeTruthy();
    expect(mergeGuestAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep Alex Survivor" }));
    expect(screen.getByText("Confirm guest merge")).toBeTruthy();
    expect(screen.getByText("Archive")).toBeTruthy();
    expect(screen.getByText("Keep")).toBeTruthy();
    expect(screen.getByText(/CA\$725/)).toBeTruthy();

    const mergeButton = screen.getByRole("button", {
      name: "Merge into Alex Survivor",
    });
    fireEvent.click(mergeButton);
    expect(mergeGuestAction).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I reviewed both profiles and chose the correct survivor/,
      }),
    );
    fireEvent.click(mergeButton);

    await waitFor(() => {
      expect(mergeGuestAction).toHaveBeenCalledWith({
        requestId,
        organizationId,
        sourceGuestId: sourceId,
        targetGuestId: targetId,
        matchScore: 1,
        reasons: [
          "Exact normalized phone match",
          "Authorized operator selected the surviving profile after side-by-side review.",
        ],
      });
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });
});
