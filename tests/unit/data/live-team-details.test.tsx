// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrivateFileDownloadUrlAction } from "@/app/actions/workflows/files";
import { createJobRoleDefinitionAction } from "@/app/actions/workflows/people-configuration";
import { decideTimeOffAction } from "@/app/actions/workflows/people-operations";
import { LiveTeamWorkspace } from "@/components/team/live-team-workspace";
import type { LiveTeamMember, LiveTeamModel } from "@/data/read-models/team";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

vi.mock("@/app/actions/workflows/files", () => ({
  createPrivateFileDownloadUrlAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/actions/workflows/team-admin", () => ({
  administerTeamMemberAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/people-operations", () => ({
  saveAvailabilityAction: vi.fn(),
  deleteAvailabilityAction: vi.fn(),
  saveTimeOffAction: vi.fn(),
  cancelTimeOffAction: vi.fn(),
  decideTimeOffAction: vi.fn(),
  saveCertificationAction: vi.fn(),
  saveEmergencyContactAction: vi.fn(),
  createEmployeeDocumentUploadUrlAction: vi.fn(),
  finalizeEmployeeDocumentAction: vi.fn(),
  updateEmployeeDocumentAction: vi.fn(),
}));

vi.mock("@/app/actions/workflows/people-configuration", () => ({
  createJobRoleDefinitionAction: vi.fn(),
  updateJobRoleDefinitionAction: vi.fn(),
  deactivateJobRoleDefinitionAction: vi.fn(),
  createEmployeeJobAssignmentAction: vi.fn(),
  updateEmployeeJobAssignmentAction: vi.fn(),
  endEmployeeJobAssignmentAction: vi.fn(),
}));

vi.mock("@/app/actions/auth", () => ({
  inviteUserAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const organizationId = "20000000-0000-4000-8000-000000000001";
const locationId = "30000000-0000-4000-8000-000000000001";
const ownerId = "10000000-0000-4000-8000-000000000001";
const employeeId = "10000000-0000-4000-8000-000000000002";

function workspace(role: WorkspaceContextValue["role"] = "owner"): WorkspaceContextValue {
  return {
    mode: "live",
    identity: {
      userId: role === "employee" ? employeeId : ownerId,
      displayName: role === "employee" ? "Connected Employee" : "Connected Owner",
      email: role === "employee" ? "employee@example.com" : "owner@example.com",
      aal: role === "owner" ? "aal2" : "aal1",
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
    membershipId: "40000000-0000-4000-8000-000000000001",
    role,
    organizationWide: role === "owner" || role === "admin",
    capabilities: [],
  };
}

function member(overrides: Partial<LiveTeamMember> = {}): LiveTeamMember {
  return {
    membershipId: "40000000-0000-4000-8000-000000000002",
    userId: employeeId,
    employeeId: "50000000-0000-4000-8000-000000000001",
    displayName: "Alex Morgan",
    email: "alex@example.com",
    phone: "212-555-0101",
    role: "employee",
    membershipStatus: "active",
    employmentStatus: "active",
    locationIds: [locationId],
    jobRoles: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        name: "Server",
        locationId,
      },
    ],
    jobAssignments: [
      {
        id: "61000000-0000-4000-8000-000000000001",
        jobRoleId: "60000000-0000-4000-8000-000000000001",
        roleName: "Server",
        locationId,
        locationName: "Main Dining Room",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        isPrimary: true,
      },
    ],
    pendingTimeOff: 1,
    certificationCount: 1,
    detailAccess: "management",
    availability: [
      {
        id: "70000000-0000-4000-8000-000000000001",
        locationId,
        locationName: "Main Dining Room",
        weekday: 1,
        availableFrom: "09:00:00",
        availableUntil: "17:00:00",
        isAvailable: true,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
        notes: "Classes end before service.",
      },
    ],
    timeOff: [
      {
        id: "80000000-0000-4000-8000-000000000001",
        locationId,
        locationName: "Main Dining Room",
        timeZone: "America/New_York",
        startsAt: "2026-08-03T13:00:00.000Z",
        endsAt: "2026-08-03T21:00:00.000Z",
        reason: "Appointment",
        status: "pending",
        decidedAt: null,
        decisionNote: null,
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    ],
    certifications: [
      {
        id: "90000000-0000-4000-8000-000000000001",
        certificationType: "Food handler",
        issuer: "City Health",
        credentialNumber: "FH-2048",
        issuedOn: "2026-01-05",
        expiresOn: "2027-01-05",
        verifiedAt: "2026-01-06T15:00:00.000Z",
      },
    ],
    emergencyContacts: [
      {
        id: "a0000000-0000-4000-8000-000000000001",
        name: "Jamie Rivera",
        relationship: "Partner",
        phone: "212-555-0198",
        email: "jamie@example.com",
        isPrimary: true,
      },
    ],
    documents: [
      {
        id: "b0000000-0000-4000-8000-000000000001",
        documentType: "handbook",
        title: "Signed handbook",
        storagePath: `${organizationId}/global/employee/b0000000-0000-4000-8000-000000000001/file.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 42_240,
        employeeVisible: true,
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function model(teamMember: LiveTeamMember): LiveTeamModel {
  return {
    members: [teamMember],
    jobRoles: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        name: "Server",
        code: "SERVER",
        department: "Dining room",
        color: "#4F46E5",
        defaultTipPoints: 1,
        isTipped: true,
        active: true,
      },
    ],
  };
}

describe("connected Team employee details", () => {
  it("guides an empty tenant through explicit role setup without assumed values", () => {
    render(
      <LiveTeamWorkspace
        workspace={workspace("owner")}
        model={{
          ok: true,
          data: {
            members: [member({ jobRoles: [], jobAssignments: [] })],
            jobRoles: [],
          },
        }}
      />,
    );

    expect(screen.getByText("Start with your real job roles")).toBeTruthy();
    expect(screen.getByText(/Create an active job role in the Team setup catalog/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add role" }));
    expect((screen.getByLabelText(/Default tip points/) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Role name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Short code") as HTMLInputElement).value).toBe("");
  });

  it("never renders a stored hourly rate back into an assignment editor", () => {
    render(
      <LiveTeamWorkspace
        workspace={workspace("owner")}
        model={{ ok: true, data: model(member()) }}
      />,
    );
    const assignmentSection = screen.getByText("Job assignments").closest("section");
    expect(assignmentSection).toBeTruthy();
    fireEvent.click(within(assignmentSection!).getByRole("button", { name: "Edit" }));

    const changeRate = screen.getByLabelText(/Change private hourly rate/);
    expect(screen.queryByLabelText(/Private hourly rate/)).toBeNull();
    fireEvent.click(changeRate);
    expect((screen.getByLabelText(/Private hourly rate/) as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("27.50")).toBeNull();
  });

  it("reuses the role request ID after an ambiguous response", async () => {
    vi.mocked(createJobRoleDefinitionAction)
      .mockRejectedValueOnce(new Error("Response lost after commit"))
      .mockResolvedValue({
        ok: true,
        persisted: true,
        mode: "live",
        data: {
          id: "60000000-0000-4000-8000-000000000099",
          name: "Host",
          code: "HOST",
          department: null,
          color: null,
          defaultTipPoints: 0,
          isTipped: false,
          active: true,
        },
      });
    render(
      <LiveTeamWorkspace
        workspace={workspace("owner")}
        model={{ ok: true, data: model(member()) }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add role" }));
    fireEvent.change(screen.getByLabelText("Role name"), { target: { value: "Host" } });
    fireEvent.change(screen.getByLabelText("Short code"), { target: { value: "HOST" } });
    fireEvent.change(screen.getByLabelText(/Default tip points/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Create role" }));

    expect(
      await screen.findByText(/could not confirm whether the change completed/i),
    ).toBeTruthy();
    const firstRequestId = (
      vi.mocked(createJobRoleDefinitionAction).mock.calls[0][0] as { requestId: string }
    ).requestId;
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create role" }).hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Create role" }));
    await waitFor(() => expect(createJobRoleDefinitionAction).toHaveBeenCalledTimes(2));
    const retryRequestId = (
      vi.mocked(createJobRoleDefinitionAction).mock.calls[1][0] as { requestId: string }
    ).requestId;
    expect(retryRequestId).toBe(firstRequestId);
  });

  it("renders real authorized profile records and their exact empty-safe metadata", () => {
    render(
      <LiveTeamWorkspace
        workspace={workspace("owner")}
        model={{ ok: true, data: model(member()) }}
      />,
    );

    expect(screen.getByText("Availability rules")).toBeTruthy();
    expect(screen.getByText("Monday")).toBeTruthy();
    expect(screen.getByText("9:00 AM–5:00 PM")).toBeTruthy();
    expect(screen.getByText("Appointment")).toBeTruthy();
    expect(screen.getByText("Food handler")).toBeTruthy();
    expect(screen.getByText(/City Health · FH-2048/)).toBeTruthy();
    expect(screen.getByText("Jamie Rivera")).toBeTruthy();
    expect(screen.getByText("Signed handbook")).toBeTruthy();
    expect(screen.queryByText("Maya Chen")).toBeNull();
  });

  it("opens employee documents through the private signed-file action", async () => {
    vi.mocked(createPrivateFileDownloadUrlAction).mockResolvedValue({
      ok: true,
      persisted: false,
      mode: "live",
      data: {
        bucket: "employee-documents",
        objectPath: `${organizationId}/global/employee/b0000000-0000-4000-8000-000000000001/file.pdf`,
        signedUrl: "https://private.example.test/document",
        expiresInSeconds: 60,
      },
    });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <LiveTeamWorkspace
        workspace={workspace("owner")}
        model={{ ok: true, data: model(member()) }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download Signed handbook" }));

    await waitFor(() => {
      expect(createPrivateFileDownloadUrlAction).toHaveBeenCalledWith({
        bucket: "employee-documents",
        objectPath: `${organizationId}/global/employee/b0000000-0000-4000-8000-000000000001/file.pdf`,
        downloadFileName: "Signed handbook",
      });
      expect(open).toHaveBeenCalledWith(
        "https://private.example.test/document",
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("keeps another employee's private profile out of an Employee session", () => {
    const privateMember = member({
      userId: "10000000-0000-4000-8000-000000000099",
      displayName: "Directory Colleague",
      detailAccess: "private",
      certifications: [
        {
          id: "90000000-0000-4000-8000-000000000099",
          certificationType: "Never Leak Certification",
          issuer: null,
          credentialNumber: null,
          issuedOn: null,
          expiresOn: null,
          verifiedAt: null,
        },
      ],
      emergencyContacts: [
        {
          id: "a0000000-0000-4000-8000-000000000099",
          name: "Never Leak Contact",
          relationship: null,
          phone: "212-555-0000",
          email: null,
          isPrimary: true,
        },
      ],
    });

    render(
      <LiveTeamWorkspace
        workspace={workspace("employee")}
        model={{ ok: true, data: model(privateMember) }}
      />,
    );

    expect(screen.getByText("Private employee profile")).toBeTruthy();
    expect(screen.getByText(/directory-only access/)).toBeTruthy();
    expect(screen.queryByText("Never Leak Certification")).toBeNull();
    expect(screen.queryByText("Never Leak Contact")).toBeNull();
  });

  it("distinguishes a self-service empty profile from hidden records", () => {
    const selfMember = member({
      detailAccess: "self",
      availability: [],
      timeOff: [],
      certifications: [],
      emergencyContacts: [],
      documents: [],
      pendingTimeOff: 0,
      certificationCount: 0,
    });

    render(
      <LiveTeamWorkspace
        workspace={workspace("employee")}
        model={{ ok: true, data: model(selfMember) }}
      />,
    );

    expect(screen.getByText("Your profile")).toBeTruthy();
    expect(screen.getByText("No availability rules are on file for this profile.")).toBeTruthy();
    expect(screen.getByText("No time-off requests are on file.")).toBeTruthy();
    expect(screen.getByText("No employee-visible documents are on file.")).toBeTruthy();
    expect(screen.getByText("No emergency contact has been provided.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add rule" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add contact" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add certification" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("shows management-only readiness and independent leave decisions", async () => {
    vi.mocked(decideTimeOffAction).mockResolvedValue({
      ok: true,
      persisted: true,
      mode: "live",
      data: {
        id: "80000000-0000-4000-8000-000000000001",
        status: "approved" as const,
        decidedAt: "2026-08-01T13:00:00.000Z",
      },
    });

    render(
      <LiveTeamWorkspace
        workspace={workspace("owner")}
        model={{ ok: true, data: model(member()) }}
      />,
    );

    expect(screen.getByRole("button", { name: "Add certification" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(decideTimeOffAction).toHaveBeenCalledWith({
        requestId: expect.any(String),
        timeOffId: "80000000-0000-4000-8000-000000000001",
        approve: true,
        decisionNote: null,
      });
    });
  });

  it("keeps keyboard focus inside People dialogs and restores the opener", async () => {
    const { container } = render(
      <LiveTeamWorkspace
        workspace={workspace("owner")}
        model={{ ok: true, data: model(member()) }}
      />,
    );
    const opener = screen.getByRole("button", { name: "Approve" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(document.body.style.overflow).toBe("hidden");
    expect(container.hasAttribute("inert")).toBe(true);
    expect(container.getAttribute("aria-hidden")).toBe("true");

    const close = within(dialog).getByRole("button", { name: "Close" });
    const submit = within(dialog).getByRole("button", { name: "Approve" });
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    submit.focus();
    fireEvent.keyDown(submit, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(opener);
    });
    expect(document.body.style.overflow).toBe("");
    expect(container.hasAttribute("inert")).toBe(false);
    expect(container.hasAttribute("aria-hidden")).toBe(false);
  });

  it("reuses a request ID for an ambiguous retry and rotates it for a new dialog", async () => {
    const successfulDecision = {
      ok: true as const,
      persisted: true as const,
      mode: "live" as const,
      data: {
        id: "80000000-0000-4000-8000-000000000001",
        status: "approved" as const,
        decidedAt: "2026-08-01T13:00:00.000Z",
      },
    };
    vi.mocked(decideTimeOffAction)
      .mockRejectedValueOnce(new Error("The response was lost after commit."))
      .mockResolvedValue(successfulDecision);

    render(
      <LiveTeamWorkspace
        workspace={workspace("owner")}
        model={{ ok: true, data: model(member()) }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    let dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

    expect(
      await screen.findByText(/could not confirm whether the request completed/i),
    ).toBeTruthy();
    const firstRequestId = (
      vi.mocked(decideTimeOffAction).mock.calls[0][0] as { requestId: string }
    ).requestId;

    await waitFor(() => {
      expect(
        within(dialog)
          .getByRole("button", { name: "Approve" })
          .hasAttribute("disabled"),
      ).toBe(false);
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(decideTimeOffAction).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    const retryRequestId = (
      vi.mocked(decideTimeOffAction).mock.calls[1][0] as { requestId: string }
    ).requestId;
    expect(retryRequestId).toBe(firstRequestId);

    const newDecisionOpener = screen.getByRole("button", { name: "Approve" });
    await waitFor(() => {
      expect(newDecisionOpener.hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(newDecisionOpener);
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(decideTimeOffAction).toHaveBeenCalledTimes(3));

    const newDialogRequestId = (
      vi.mocked(decideTimeOffAction).mock.calls[2][0] as { requestId: string }
    ).requestId;
    expect(newDialogRequestId).not.toBe(firstRequestId);
  });
});
