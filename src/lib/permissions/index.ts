import type { AIRestrictedAction, AppRole, EntityId, MembershipStatus } from "../../types";

export const PERMISSIONS = [
  "organization.view",
  "organization.update",
  "location.view",
  "location.manage",
  "user.list",
  "user.create",
  "user.invite",
  "user.suspend",
  "user.assign_role",
  "employee.view",
  "employee.update_self",
  "employee.update_any",
  "schedule.view",
  "schedule.manage",
  "schedule.publish",
  "schedule.acknowledge",
  "schedule.request_swap",
  "schedule.approve_swap",
  "chat.view",
  "chat.send",
  "chat.manage",
  "timeclock.clock_self",
  "timeclock.view_own",
  "timeclock.view_all",
  "timeclock.request_correction",
  "timeclock.approve_correction",
  "closeout.view",
  "closeout.create",
  "closeout.approve",
  "tips.view_own",
  "tips.view_all",
  "tips.calculate",
  "tips.approve",
  "tips.export",
  "receipts.view",
  "receipts.upload",
  "receipts.review",
  "receipts.delete",
  "inventory.view",
  "inventory.count",
  "inventory.adjust",
  "inventory.approve_adjustment",
  "inventory.manage",
  "crm.view",
  "crm.view_contact",
  "crm.update",
  "crm.export",
  "tasks.view",
  "tasks.update",
  "tasks.manage",
  "sop.view",
  "sop.manage",
  "incidents.create",
  "incidents.view",
  "incidents.manage",
  "reports.view",
  "reports.generate",
  "reports.export",
  "integrations.view",
  "integrations.manage",
  "ai.use",
  "ai.review",
  "notifications.view",
  "audit.view",
  "settings.manage",
  "data.export",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EMPLOYEE_PERMISSIONS: readonly Permission[] = [
  "organization.view",
  "location.view",
  "employee.view",
  "employee.update_self",
  "schedule.view",
  "schedule.acknowledge",
  "schedule.request_swap",
  "chat.view",
  "chat.send",
  "timeclock.clock_self",
  "timeclock.view_own",
  "timeclock.request_correction",
  "tips.view_own",
  "tasks.view",
  "tasks.update",
  "sop.view",
  "incidents.create",
  "notifications.view",
];

const MANAGER_PERMISSIONS: readonly Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  "user.list",
  "employee.update_any",
  "schedule.manage",
  "schedule.publish",
  "schedule.approve_swap",
  "chat.manage",
  "timeclock.view_all",
  "timeclock.approve_correction",
  "closeout.view",
  "closeout.create",
  "closeout.approve",
  "tips.view_all",
  "tips.calculate",
  "tips.approve",
  "receipts.upload",
  "receipts.view",
  "receipts.review",
  "inventory.view",
  "inventory.count",
  "inventory.adjust",
  "inventory.approve_adjustment",
  "inventory.manage",
  "crm.view",
  "crm.view_contact",
  "crm.update",
  "tasks.manage",
  "sop.manage",
  "incidents.view",
  "incidents.manage",
  "reports.view",
  "reports.generate",
  "reports.export",
  "integrations.view",
  "ai.use",
  "ai.review",
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MANAGER_PERMISSIONS,
  "organization.update",
  "location.manage",
  "user.create",
  "user.invite",
  "user.suspend",
  "user.assign_role",
  "tips.approve",
  "tips.export",
  "receipts.delete",
  "crm.export",
  "integrations.manage",
  "audit.view",
  "settings.manage",
  "data.export",
];

export const ROLE_PERMISSIONS: Readonly<Record<AppRole, ReadonlySet<Permission>>> = {
  owner: new Set(PERMISSIONS),
  admin: new Set(ADMIN_PERMISSIONS),
  manager: new Set(MANAGER_PERMISSIONS),
  employee: new Set(EMPLOYEE_PERMISSIONS),
};

export interface PermissionActor {
  userId: EntityId;
  organizationId: EntityId;
  role: AppRole;
  membershipStatus: MembershipStatus;
  locationIds: readonly EntityId[];
  organizationWide: boolean;
  mfaEnabled?: boolean;
}

export interface ResourceScope {
  organizationId: EntityId;
  locationId?: EntityId | null;
}

export function roleHasPermission(role: AppRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function hasTenantMembership(actor: PermissionActor, organizationId: EntityId): boolean {
  return actor.membershipStatus === "active" && actor.organizationId === organizationId;
}

export function hasLocationMembership(
  actor: PermissionActor,
  organizationId: EntityId,
  locationId: EntityId,
): boolean {
  if (!hasTenantMembership(actor, organizationId)) return false;
  return actor.organizationWide || actor.locationIds.includes(locationId);
}

/**
 * Central authorization primitive. Resource-scoped calls cannot cross tenants,
 * and a supplied location must be in the actor's explicit membership scope.
 */
export function isAllowed(
  actor: PermissionActor,
  permission: Permission,
  scope: ResourceScope,
): boolean {
  if (!hasTenantMembership(actor, scope.organizationId)) return false;
  if (scope.locationId && !hasLocationMembership(actor, scope.organizationId, scope.locationId)) {
    return false;
  }
  return roleHasPermission(actor.role, permission);
}

export function canCreateUsers(actor: PermissionActor, organizationId = actor.organizationId): boolean {
  return isAllowed(actor, "user.create", { organizationId });
}

export function canCreateUserWithRole(
  actor: PermissionActor,
  role: AppRole,
  organizationId = actor.organizationId,
): boolean {
  if (!canCreateUsers(actor, organizationId)) return false;
  return actor.role === "owner" || role !== "owner";
}

export function canAssignRole(
  actor: PermissionActor,
  role: AppRole,
  organizationId = actor.organizationId,
): boolean {
  if (!isAllowed(actor, "user.assign_role", { organizationId })) return false;
  return actor.role === "owner" || role !== "owner";
}

export function canSuspendUser(
  actor: PermissionActor,
  target: Pick<PermissionActor, "userId" | "organizationId" | "role">,
): boolean {
  if (actor.userId === target.userId || actor.organizationId !== target.organizationId) return false;
  if (!isAllowed(actor, "user.suspend", { organizationId: target.organizationId })) return false;
  return actor.role === "owner" || target.role !== "owner";
}

export type SensitiveField =
  | "compensation"
  | "emergency_contact"
  | "employee_documents"
  | "disciplinary_notes"
  | "guest_contact"
  | "guest_allergies"
  | "integration_credentials"
  | "audit_details"
  | "payroll_export";

export interface SensitiveFieldScope extends ResourceScope {
  subjectUserId?: EntityId | null;
}

/** Field-level visibility intentionally remains stricter than module visibility. */
export function canViewSensitiveField(
  actor: PermissionActor,
  field: SensitiveField,
  scope: SensitiveFieldScope,
): boolean {
  if (!hasTenantMembership(actor, scope.organizationId)) return false;
  if (scope.locationId && !hasLocationMembership(actor, scope.organizationId, scope.locationId)) {
    return false;
  }

  const isSelf = scope.subjectUserId === actor.userId;
  if (actor.role === "owner" || actor.role === "admin") return true;

  if (actor.role === "manager") {
    return [
      "emergency_contact",
      "employee_documents",
      "disciplinary_notes",
      "guest_contact",
      "guest_allergies",
    ].includes(field);
  }

  return isSelf && ["emergency_contact", "employee_documents"].includes(field);
}

export const AI_HUMAN_APPROVAL_ACTIONS: readonly AIRestrictedAction[] = [
  "finalize_payroll",
  "finalize_tip_distribution",
  "approve_punch_edit",
  "post_inventory_adjustment",
  "mutate_guest_record",
];

export function requiresHumanApproval(action: AIRestrictedAction): true {
  // The union is deliberately closed; every AI mutation presently requires review.
  void action;
  return true;
}

export function canApproveAIAction(
  actor: PermissionActor,
  action: AIRestrictedAction,
  scope: ResourceScope,
): boolean {
  const requiredPermission: Record<AIRestrictedAction, Permission> = {
    finalize_payroll: "tips.export",
    finalize_tip_distribution: "tips.approve",
    approve_punch_edit: "timeclock.approve_correction",
    post_inventory_adjustment: "inventory.approve_adjustment",
    mutate_guest_record: "crm.update",
  };
  return isAllowed(actor, requiredPermission[action], scope);
}

export interface AIActionDecision {
  requiresHumanApproval: true;
  canActorApprove: boolean;
  canExecuteAutomatically: false;
}

export function evaluateAIAction(
  actor: PermissionActor,
  action: AIRestrictedAction,
  scope: ResourceScope,
): AIActionDecision {
  return {
    requiresHumanApproval: requiresHumanApproval(action),
    canActorApprove: canApproveAIAction(actor, action, scope),
    canExecuteAutomatically: false,
  };
}

export type { AppRole } from "../../types";
