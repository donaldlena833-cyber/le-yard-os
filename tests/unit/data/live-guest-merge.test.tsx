// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mergeGuestAction,
  saveGuestAction,
} from "@/app/actions/workflows/guests";
import { LiveGuestsWorkspace } from "@/components/guests/live-guests-workspace";
import type {
  LiveGuest,
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

function restrictedGuest(): LiveGuest {
  return {
    id: sourceId,
    firstName: "Sensitive",
    lastName: "Guest",
    displayName: "Sensitive Guest",
    email: "private@example.invalid",
    phone: "+1 212 555 0199",
    birthday: "1990-01-01",
    vip: false,
    preferences: "Quiet table",
    allergies: "Shellfish",
    notes: "Hospitality context",
    firstVisitAt: null,
    lastVisitAt: "2026-07-20T22:00:00.000Z",
    visitCount: 3,
    lifetimeSpendCents: 25_000,
    source: "manual",
    currentLocationVisits: 2,
    currentLocationSpendCents: 20_000,
    contacts: [
      {
        id: requestId,
        type: "email",
        label: "primary",
        value: "private@example.invalid",
        primary: true,
        verifiedAt: null,
      },
    ],
    consents: [],
    tags: [],
    guestNotes: [],
    visits: [
      {
        id: targetId,
        locationName: "Private Dining",
        timeZone: "America/New_York",
        visitedAt: "2026-07-20T22:00:00.000Z",
        partySize: 2,
        covers: 2,
        spendCents: 12_345,
        source: "toast",
        notes: "Sensitive visit evidence",
      },
    ],
    reservations: [],
  };
}

describe("connected CRM guest merge review", () => {
  it("keeps contact data and management actions out of a sensitive-only workspace", () => {
    const restricted = model();
    restricted.contactContextAuthorized = false;
    restricted.sensitiveContextAuthorized = true;
    restricted.duplicateCandidates = [];
    restricted.guests = [restrictedGuest()];

    render(
      <LiveGuestsWorkspace
        workspace={workspace}
        result={{ ok: true, data: restricted }}
        initialSearch=""
      />,
    );

    expect(
      screen.getByPlaceholderText("Search name, allergy, preference, or note"),
    ).toBeTruthy();
    expect(screen.getAllByText(/Contact restricted/).length).toBeGreaterThan(0);
    expect(screen.queryByText("private@example.invalid")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add guest" })).toBeNull();

    fireEvent.click(screen.getAllByText("Sensitive Guest")[0]);
    expect(
      screen.getByText(
        "Contact and consent context requires guest management access.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record consent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();
    expect(screen.queryByText("private@example.invalid")).toBeNull();
  });

  it("keeps spend and visit evidence out of a contact-only workspace", () => {
    const restricted = model();
    restricted.contactContextAuthorized = true;
    restricted.sensitiveContextAuthorized = false;
    restricted.duplicateCandidates = [];
    restricted.guests = [restrictedGuest()];

    render(
      <LiveGuestsWorkspace
        workspace={workspace}
        result={{ ok: true, data: restricted }}
        initialSearch=""
      />,
    );

    fireEvent.click(screen.getAllByText("Sensitive Guest")[0]);
    expect(screen.queryByText("Visit history")).toBeNull();
    expect(screen.queryByText("Sensitive visit evidence")).toBeNull();
    expect(
      screen.getByText(
        "Hospitality context is restricted to staff with sensitive guest access.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add note" })).toBeNull();
  });

  it("surfaces a database-sensitive-scope denial instead of claiming an update", async () => {
    const sensitive = model();
    sensitive.contactContextAuthorized = true;
    sensitive.sensitiveContextAuthorized = true;
    sensitive.duplicateCandidates = [];
    sensitive.guests = [restrictedGuest()];
    vi.mocked(saveGuestAction).mockResolvedValue({
      ok: false,
      persisted: false,
      code: "forbidden",
      message: "Sensitive guest changes require access at every linked location.",
    });

    render(
      <LiveGuestsWorkspace
        workspace={workspace}
        result={{ ok: true, data: sensitive }}
        initialSearch=""
      />,
    );

    fireEvent.click(screen.getAllByText("Sensitive Guest")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Allergies"), {
      target: { value: "Shellfish and sesame" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText(
      "Sensitive guest changes require access at every linked location.",
    );
    expect(screen.queryByText("Guest profile updated.")).toBeNull();
  });

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
        locationId,
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

  it("retains the merge request id after a transient response failure", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    vi.mocked(mergeGuestAction)
      .mockResolvedValueOnce({
        ok: false,
        persisted: false,
        code: "database",
        message: "The response was interrupted.",
      })
      .mockResolvedValueOnce({
        ok: true,
        persisted: true,
        mode: "live",
        data: {
          id: requestId,
          sourceGuestId: sourceId,
          targetGuestId: targetId,
          mergedAt: "2026-08-01T20:00:00.000Z",
          alreadyApplied: true,
        },
      });

    render(
      <LiveGuestsWorkspace
        workspace={workspace}
        result={{ ok: true, data: model() }}
        initialSearch=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review matches" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep Alex Survivor" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /I reviewed both profiles and chose the correct survivor/,
      }),
    );
    const mergeButton = screen.getByRole("button", {
      name: "Merge into Alex Survivor",
    });
    fireEvent.click(mergeButton);

    await screen.findByText("The response was interrupted.");
    fireEvent.click(mergeButton);

    await waitFor(() => expect(mergeGuestAction).toHaveBeenCalledTimes(2));
    expect(mergeGuestAction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ requestId }),
    );
    expect(mergeGuestAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestId }),
    );
  });
});
