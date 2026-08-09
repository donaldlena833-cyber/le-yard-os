import { describe, expect, it } from "vitest";
import {
  canInviteFromWorkspace,
  deriveWorkspaceScopes,
  findWorkspaceChoice,
  invitableRolesForActor,
  resolveWorkspaceDisplayName,
  selectWorkspaceScope,
  toWorkspaceChoices,
  type WorkspaceLocationMembershipRow,
  type WorkspaceLocationRow,
  type WorkspaceMembershipRow,
  type WorkspaceOrganizationRow,
} from "@/lib/auth/workspace-context";

const userId = "user-current";

const organizations: WorkspaceOrganizationRow[] = [
  { id: "org-alpha", name: "Alpha Hospitality", status: "active" },
  { id: "org-bravo", name: "Bravo Hospitality", status: "active" },
  { id: "org-closed", name: "Closed Hospitality", status: "closed" },
];

const locations: WorkspaceLocationRow[] = [
  { id: "loc-alpha", organization_id: "org-alpha", name: "Alpha Room", is_active: true },
  { id: "loc-bravo-a", organization_id: "org-bravo", name: "Annex", is_active: true },
  { id: "loc-bravo-b", organization_id: "org-bravo", name: "Main Room", is_active: true },
  { id: "loc-bravo-closed", organization_id: "org-bravo", name: "Closed Room", is_active: false },
];

function membership(
  id: string,
  organizationId: string,
  role: WorkspaceMembershipRow["role"],
  overrides: Partial<WorkspaceMembershipRow> = {},
): WorkspaceMembershipRow {
  return {
    id,
    organization_id: organizationId,
    user_id: userId,
    role,
    status: "active",
    ...overrides,
  };
}

describe("workspace scope selection", () => {
  it("chooses the first organization with a valid accessible location", () => {
    const memberships = [
      membership("membership-alpha", "org-alpha", "manager"),
      membership("membership-bravo", "org-bravo", "manager"),
    ];
    const locationMemberships: WorkspaceLocationMembershipRow[] = [
      {
        organization_id: "org-bravo",
        location_id: "loc-bravo-b",
        user_id: userId,
        is_primary: true,
      },
    ];

    const selected = selectWorkspaceScope({
      userId,
      memberships,
      organizations,
      locations,
      locationMemberships,
    });

    expect(selected?.organization.id).toBe("org-bravo");
    expect(selected?.activeLocation?.id).toBe("loc-bravo-b");
    expect(selected?.locations.map((location) => location.id)).toEqual(["loc-bravo-b"]);
  });

  it("gives owners all active locations and prioritizes their primary location", () => {
    const selected = selectWorkspaceScope({
      userId,
      memberships: [membership("membership-bravo", "org-bravo", "owner")],
      organizations,
      locations,
      locationMemberships: [
        {
          organization_id: "org-bravo",
          location_id: "loc-bravo-b",
          user_id: userId,
          is_primary: true,
        },
      ],
    });

    expect(selected?.activeLocation?.id).toBe("loc-bravo-b");
    expect(selected?.locations.map((location) => location.id)).toEqual([
      "loc-bravo-b",
      "loc-bravo-a",
    ]);
  });

  it("accepts only an exact preference inside the current user's derived scope", () => {
    const input = {
      userId,
      memberships: [
        membership("membership-alpha", "org-alpha", "owner"),
        membership("membership-bravo", "org-bravo", "owner"),
      ],
      organizations,
      locations,
      locationMemberships: [],
    };

    expect(
      selectWorkspaceScope({
        ...input,
        preference: {
          userId,
          organizationId: "org-bravo",
          locationId: "loc-bravo-b",
        },
      })?.activeLocation?.id,
    ).toBe("loc-bravo-b");

    expect(
      selectWorkspaceScope({
        ...input,
        preference: {
          userId: "user-other",
          organizationId: "org-bravo",
          locationId: "loc-bravo-b",
        },
      })?.organization.id,
    ).toBe("org-alpha");

    expect(
      selectWorkspaceScope({
        ...input,
        preference: {
          userId,
          organizationId: "org-closed",
          locationId: "loc-bravo-b",
        },
      })?.organization.id,
    ).toBe("org-alpha");
  });

  it("exposes every derived membership choice without widening location access", () => {
    const scopes = deriveWorkspaceScopes({
      userId,
      memberships: [
        membership("membership-alpha", "org-alpha", "manager"),
        membership("membership-bravo", "org-bravo", "manager"),
      ],
      organizations,
      locations,
      locationMemberships: [
        {
          organization_id: "org-alpha",
          location_id: "loc-alpha",
          user_id: userId,
          is_primary: true,
        },
        {
          organization_id: "org-bravo",
          location_id: "loc-bravo-a",
          user_id: userId,
          is_primary: false,
        },
      ],
    });
    const choices = toWorkspaceChoices(scopes);

    expect(choices.map((choice) => choice.organization.id)).toEqual([
      "org-alpha",
      "org-bravo",
    ]);
    expect(choices[1]?.locations.map((location) => location.id)).toEqual([
      "loc-bravo-a",
    ]);
    expect(choices[1]?.organizationWide).toBe(false);
    expect(findWorkspaceChoice(choices, "org-bravo", "loc-bravo-a")?.location.id).toBe(
      "loc-bravo-a",
    );
    expect(findWorkspaceChoice(choices, "org-bravo", "loc-alpha")).toBeNull();
    expect(findWorkspaceChoice(choices, "org-closed", "loc-bravo-a")).toBeNull();
  });

  it("rejects inactive, closed-organization, and different-user memberships", () => {
    const selected = selectWorkspaceScope({
      userId,
      memberships: [
        membership("membership-suspended", "org-alpha", "admin", { status: "suspended" }),
        membership("membership-closed", "org-closed", "owner"),
        membership("membership-other", "org-bravo", "owner", { user_id: "user-other" }),
      ],
      organizations,
      locations,
      locationMemberships: [],
    });

    expect(selected).toBeNull();
  });
});

describe("workspace identity mapping", () => {
  it("prefers the profile name, then verified claim metadata, then email local-part", () => {
    expect(
      resolveWorkspaceDisplayName({
        profile: { display_name: "Donald Lena", preferred_name: "Donald" },
        claimDisplayName: "Claim Name",
        email: "account@example.com",
      }),
    ).toBe("Donald");
    expect(
      resolveWorkspaceDisplayName({
        profile: null,
        claimDisplayName: " Maris ",
        email: "account@example.com",
      }),
    ).toBe("Maris");
    expect(
      resolveWorkspaceDisplayName({
        profile: null,
        email: "operator@example.com",
      }),
    ).toBe("operator");
  });
});

describe("invitation authority", () => {
  it("offers Owner only to an owner", () => {
    expect(invitableRolesForActor("owner")).toEqual([
      "owner",
      "admin",
      "manager",
      "employee",
    ]);
    expect(invitableRolesForActor("admin")).toEqual([
      "admin",
      "manager",
      "employee",
    ]);
    expect(invitableRolesForActor("admin")).not.toContain("owner");
  });

  it("allows password-authenticated owners or admins to open invitations", () => {
    expect(canInviteFromWorkspace("owner", "aal2")).toBe(true);
    expect(canInviteFromWorkspace("owner", "aal1")).toBe(true);
    expect(canInviteFromWorkspace("admin", "aal1")).toBe(true);
    expect(canInviteFromWorkspace("manager", "aal2")).toBe(false);
    expect(canInviteFromWorkspace("employee", "aal2")).toBe(false);
  });
});
