import "server-only";

import type { AppRole } from "@/types";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import { localDateKey, readFailure, readSuccess, type LiveReadResult } from "./shared";

export interface LiveTeamMember {
  membershipId: string;
  userId: string;
  employeeId: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  role: AppRole;
  membershipStatus: "invited" | "active" | "suspended";
  employmentStatus: "invited" | "active" | "leave" | "terminated" | null;
  locationIds: string[];
  primaryLocationId: string | null;
  jobRoles: { id: string; name: string; locationId: string }[];
  jobAssignments: LiveJobAssignment[];
  pendingTimeOff: number;
  certificationCount: number;
  detailAccess: "self" | "management" | "private" | "not_configured";
  availability: LiveAvailabilityRule[];
  timeOff: LiveTimeOffRequest[];
  certifications: LiveCertification[];
  emergencyContacts: LiveEmergencyContact[];
  documents: LiveEmployeeDocument[];
}

export interface LiveAvailabilityRule {
  id: string;
  locationId: string | null;
  locationName: string | null;
  weekday: number;
  availableFrom: string | null;
  availableUntil: string | null;
  isAvailable: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
}

export interface LiveTimeOffRequest {
  id: string;
  locationId: string | null;
  locationName: string | null;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  status: "draft" | "pending" | "approved" | "denied" | "cancelled";
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface LiveCertification {
  id: string;
  certificationType: string;
  issuer: string | null;
  credentialNumber: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  verifiedAt: string | null;
}

export interface LiveEmergencyContact {
  id: string;
  name: string;
  relationship: string | null;
  phone: string;
  email: string | null;
  isPrimary: boolean;
}

export interface LiveEmployeeDocument {
  id: string;
  documentType: string;
  title: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  employeeVisible: boolean;
  createdAt: string;
}

export interface LiveJobAssignment {
  id: string;
  jobRoleId: string;
  roleName: string;
  locationId: string;
  locationName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isPrimary: boolean;
}

export interface LiveJobRoleDefinition {
  id: string;
  name: string;
  code: string;
  department: string | null;
  color: string | null;
  defaultTipPoints: number;
  isTipped: boolean;
  active: boolean;
}

export interface LiveTeamModel {
  members: LiveTeamMember[];
  jobRoles: LiveJobRoleDefinition[];
}

export async function loadLiveTeam(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<LiveTeamModel>> {
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const [
      membershipResult,
      employeeResult,
      locationMembershipResult,
      locationResult,
      jobRoleResult,
      employeeJobResult,
      timeOffResult,
      certificationResult,
      availabilityResult,
      emergencyContactResult,
      documentResult,
    ] = await Promise.all([
      supabase
        .from("organization_memberships")
        .select("id, user_id, role, status, invited_at, joined_at")
        .eq("organization_id", organizationId)
        .order("joined_at", { ascending: true, nullsFirst: false }),
      supabase
        .from("employees")
        .select(
          "id, user_id, display_name, email, phone, employment_status, home_location_id",
        )
        .eq("organization_id", organizationId),
      supabase
        .from("location_memberships")
        .select("user_id, location_id, is_primary")
        .eq("organization_id", organizationId),
      supabase
        .from("locations")
        .select("id, name, timezone")
        .eq("organization_id", organizationId),
      supabase
        .from("job_roles")
        .select(
          "id, name, code, department, color, default_tip_points, is_tipped, is_active",
        )
        .eq("organization_id", organizationId)
        .order("name"),
      supabase
        .from("employee_job_roles")
        .select(
          "id, employee_id, job_role_id, location_id, effective_from, effective_to, is_primary",
        )
        .eq("organization_id", organizationId),
      supabase
        .from("time_off_requests")
        .select(
          "id, employee_id, location_id, starts_at, ends_at, reason, status, decided_at, decision_note, created_at",
        )
        .eq("organization_id", organizationId)
        .order("starts_at", { ascending: false }),
      supabase
        .from("employee_certifications")
        .select(
          "id, employee_id, certification_type, issuer, credential_number, issued_on, expires_on, verified_at",
        )
        .eq("organization_id", organizationId),
      supabase
        .from("availability_rules")
        .select(
          "id, employee_id, location_id, weekday, available_from, available_until, is_available, effective_from, effective_to, notes",
        )
        .eq("organization_id", organizationId)
        .order("weekday")
        .order("effective_from", { ascending: false }),
      supabase
        .from("employee_emergency_contacts")
        .select("id, employee_id, name, relationship, phone, email, is_primary")
        .eq("organization_id", organizationId)
        .order("is_primary", { ascending: false })
        .order("name"),
      supabase
        .from("employee_documents")
        .select(
          "id, employee_id, document_type, title, storage_path, mime_type, size_bytes, is_employee_visible, created_at",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
    ]);

    if (
      membershipResult.error ||
      employeeResult.error ||
      locationMembershipResult.error ||
      locationResult.error ||
      jobRoleResult.error ||
      employeeJobResult.error ||
      timeOffResult.error ||
      certificationResult.error ||
      availabilityResult.error ||
      emergencyContactResult.error ||
      documentResult.error
    ) {
      return readFailure("The live team directory could not be loaded. Try again.");
    }

    const memberships = membershipResult.data ?? [];
    const userIds = memberships.map((membership) => membership.user_id);
    const { data: profiles, error: profileError } = userIds.length
      ? await supabase
          .from("profiles")
          .select("id, display_name, preferred_name, phone")
          .in("id", userIds)
      : { data: [], error: null };
    if (profileError) return readFailure("The live team directory could not be loaded. Try again.");

    const profileByUser = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const employeeByUser = new Map(
      (employeeResult.data ?? [])
        .filter((employee) => employee.user_id)
        .map((employee) => [employee.user_id!, employee]),
    );
    const employeeById = new Map(
      (employeeResult.data ?? []).map((employee) => [employee.id, employee]),
    );
    const roleById = new Map((jobRoleResult.data ?? []).map((role) => [role.id, role]));
    const timeZoneByLocation = new Map(
      (locationResult.data ?? []).map((location) => [location.id, location.timezone]),
    );
    const locationNameById = new Map(
      (locationResult.data ?? []).map((location) => [location.id, location.name]),
    );
    const now = new Date();
    const locationIdsByUser = new Map<string, string[]>();
    const primaryLocationByUser = new Map<string, string>();
    for (const assignment of locationMembershipResult.data ?? []) {
      const current = locationIdsByUser.get(assignment.user_id) ?? [];
      current.push(assignment.location_id);
      locationIdsByUser.set(assignment.user_id, current);
      if (assignment.is_primary) {
        primaryLocationByUser.set(assignment.user_id, assignment.location_id);
      }
    }
    const jobRolesByEmployee = new Map<string, LiveTeamMember["jobRoles"]>();
    const jobAssignmentsByEmployee = new Map<string, LiveJobAssignment[]>();
    for (const assignment of employeeJobResult.data ?? []) {
      const role = roleById.get(assignment.job_role_id);
      const locationName = locationNameById.get(assignment.location_id);
      if (!role || !locationName) continue;
      const assignments = jobAssignmentsByEmployee.get(assignment.employee_id) ?? [];
      assignments.push({
        id: assignment.id,
        jobRoleId: role.id,
        roleName: role.name,
        locationId: assignment.location_id,
        locationName,
        effectiveFrom: assignment.effective_from,
        effectiveTo: assignment.effective_to,
        isPrimary: assignment.is_primary,
      });
      jobAssignmentsByEmployee.set(assignment.employee_id, assignments);

      const effectiveDate = localDateKey(
        now,
        timeZoneByLocation.get(assignment.location_id) ?? "UTC",
      );
      if (
        assignment.effective_from > effectiveDate ||
        (assignment.effective_to && assignment.effective_to < effectiveDate) ||
        !role.is_active
      ) continue;
      const current = jobRolesByEmployee.get(assignment.employee_id) ?? [];
      current.push({ id: role.id, name: role.name, locationId: assignment.location_id });
      jobRolesByEmployee.set(assignment.employee_id, current);
    }
    for (const assignments of jobAssignmentsByEmployee.values()) {
      assignments.sort((left, right) =>
        right.effectiveFrom.localeCompare(left.effectiveFrom),
      );
    }
    const currentEmployeeId = employeeByUser.get(workspace.identity.userId)?.id ?? null;
    const maySerializeSensitiveEmployee = (employeeId: string) =>
      workspace.role !== "employee" || employeeId === currentEmployeeId;

    const availabilityByEmployee = new Map<string, LiveAvailabilityRule[]>();
    for (const rule of availabilityResult.data ?? []) {
      if (!maySerializeSensitiveEmployee(rule.employee_id)) continue;
      const current = availabilityByEmployee.get(rule.employee_id) ?? [];
      current.push({
        id: rule.id,
        locationId: rule.location_id,
        locationName: rule.location_id ? locationNameById.get(rule.location_id) ?? null : null,
        weekday: rule.weekday,
        availableFrom: rule.available_from,
        availableUntil: rule.available_until,
        isAvailable: rule.is_available,
        effectiveFrom: rule.effective_from,
        effectiveTo: rule.effective_to,
        notes: rule.notes,
      });
      availabilityByEmployee.set(rule.employee_id, current);
    }

    const timeOffByEmployee = new Map<string, LiveTimeOffRequest[]>();
    for (const request of timeOffResult.data ?? []) {
      if (!maySerializeSensitiveEmployee(request.employee_id)) continue;
      const employee = employeeById.get(request.employee_id);
      const fallbackLocationId = employee?.home_location_id ?? workspace.activeLocation.id;
      const current = timeOffByEmployee.get(request.employee_id) ?? [];
      current.push({
        id: request.id,
        locationId: request.location_id,
        locationName: request.location_id
          ? locationNameById.get(request.location_id) ?? null
          : null,
        timeZone:
          timeZoneByLocation.get(request.location_id ?? fallbackLocationId) ?? "UTC",
        startsAt: request.starts_at,
        endsAt: request.ends_at,
        reason: request.reason,
        status: request.status,
        decidedAt: request.decided_at,
        decisionNote: request.decision_note,
        createdAt: request.created_at,
      });
      timeOffByEmployee.set(request.employee_id, current);
    }

    const certificationsByEmployee = new Map<string, LiveCertification[]>();
    for (const certification of certificationResult.data ?? []) {
      if (!maySerializeSensitiveEmployee(certification.employee_id)) continue;
      const current = certificationsByEmployee.get(certification.employee_id) ?? [];
      current.push({
        id: certification.id,
        certificationType: certification.certification_type,
        issuer: certification.issuer,
        credentialNumber: certification.credential_number,
        issuedOn: certification.issued_on,
        expiresOn: certification.expires_on,
        verifiedAt: certification.verified_at,
      });
      certificationsByEmployee.set(certification.employee_id, current);
    }

    const emergencyContactsByEmployee = new Map<string, LiveEmergencyContact[]>();
    for (const contact of emergencyContactResult.data ?? []) {
      if (!maySerializeSensitiveEmployee(contact.employee_id)) continue;
      const current = emergencyContactsByEmployee.get(contact.employee_id) ?? [];
      current.push({
        id: contact.id,
        name: contact.name,
        relationship: contact.relationship,
        phone: contact.phone,
        email: contact.email,
        isPrimary: contact.is_primary,
      });
      emergencyContactsByEmployee.set(contact.employee_id, current);
    }

    const documentsByEmployee = new Map<string, LiveEmployeeDocument[]>();
    for (const document of documentResult.data ?? []) {
      if (!maySerializeSensitiveEmployee(document.employee_id)) continue;
      if (workspace.role === "employee" && !document.is_employee_visible) continue;
      const current = documentsByEmployee.get(document.employee_id) ?? [];
      current.push({
        id: document.id,
        documentType: document.document_type,
        title: document.title,
        storagePath: document.storage_path,
        mimeType: document.mime_type,
        sizeBytes: document.size_bytes,
        employeeVisible: document.is_employee_visible,
        createdAt: document.created_at,
      });
      documentsByEmployee.set(document.employee_id, current);
    }

    const members = memberships
      .map((membership): LiveTeamMember => {
        const employee = employeeByUser.get(membership.user_id);
        const profile = profileByUser.get(membership.user_id);
        const jobRoles = employee ? jobRolesByEmployee.get(employee.id) ?? [] : [];
        const locationIds = Array.from(
          new Set([
            ...(locationIdsByUser.get(membership.user_id) ?? []),
            ...(employee?.home_location_id ? [employee.home_location_id] : []),
            ...jobRoles.map((role) => role.locationId),
          ]),
        ).filter((locationId) => locationNameById.has(locationId));
        return {
          membershipId: membership.id,
          userId: membership.user_id,
          employeeId: employee?.id ?? null,
          displayName:
            profile?.preferred_name?.trim() ||
            profile?.display_name ||
            employee?.display_name ||
            "Invited teammate",
          email: employee?.email ?? null,
          phone: profile?.phone ?? employee?.phone ?? null,
          role: membership.role,
          membershipStatus: membership.status,
          employmentStatus: employee
            ? (employee.employment_status as LiveTeamMember["employmentStatus"])
            : null,
          locationIds,
          primaryLocationId:
            primaryLocationByUser.get(membership.user_id) ??
            employee?.home_location_id ??
            null,
          jobRoles,
          jobAssignments: employee
            ? jobAssignmentsByEmployee.get(employee.id) ?? []
            : [],
          pendingTimeOff: employee
            ? (timeOffByEmployee.get(employee.id) ?? []).filter(
                (request) => request.status === "pending",
              ).length
            : 0,
          certificationCount: employee
            ? certificationsByEmployee.get(employee.id)?.length ?? 0
            : 0,
          detailAccess: employee
            ? membership.user_id === workspace.identity.userId
              ? "self"
              : "management"
            : membership.user_id === workspace.identity.userId ||
                membership.status === "invited" ||
                workspace.role === "owner" ||
                workspace.role === "admin"
              ? "not_configured"
              : "private",
          availability: employee ? availabilityByEmployee.get(employee.id) ?? [] : [],
          timeOff: employee ? timeOffByEmployee.get(employee.id) ?? [] : [],
          certifications: employee
            ? certificationsByEmployee.get(employee.id) ?? []
            : [],
          emergencyContacts: employee
            ? emergencyContactsByEmployee.get(employee.id) ?? []
            : [],
          documents: employee ? documentsByEmployee.get(employee.id) ?? [] : [],
        };
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));

    return readSuccess({
      members,
      jobRoles: (jobRoleResult.data ?? []).map((role) => ({
        id: role.id,
        name: role.name,
        code: role.code,
        department: role.department,
        color: role.color,
        defaultTipPoints: role.default_tip_points,
        isTipped: role.is_tipped,
        active: role.is_active,
      })),
    });
  } catch {
    return readFailure("The live team directory could not be loaded. Try again.");
  }
}
