export const OPERATIONAL_CAPABILITIES = [
  "inventory.catalog.manage",
  "inventory.item.manage",
  "inventory.category.manage",
  "inventory.unit.manage",
  "inventory.par.manage",
  "inventory.count.create",
  "inventory.count.approve",
  "inventory.waste.create",
  "inventory.waste.approve",
  "inventory.transfer.create",
  "inventory.transfer.approve",
  "inventory.purchase.create",
  "inventory.purchase.approve",
  "inventory.receive",
  "inventory.vendor.manage",
  "inventory.price.manage",
  "recipe.manage",
  "prep.manage",
  "prep.complete",
  "menu.manage",
  "schedule.manage",
  "schedule.publish",
  "time.review",
  "time.approve",
  "preshift.manage",
  "availability.manage",
  "service.availability.manage",
  "manager_log.manage",
  "guest.manage",
  "guest.sensitive_notes.view",
  "guest_recovery.manage",
  "reservations.view",
  "reservations.operate",
  "reservations.override",
  "reservations.configure",
  "closeout.create",
  "closeout.approve",
  "cash.manage",
  "tip.calculate",
  "tip.approve",
  "maintenance.manage",
  "food_safety.manage",
  "reports.operational.view",
  "reports.financial.view",
  "budget.manage",
  "integrations.manage",
  "employee.performance.view",
] as const;

export type OperationalCapability = (typeof OPERATIONAL_CAPABILITIES)[number];

export const KITCHEN_CAPABILITIES: readonly OperationalCapability[] = [
  "inventory.catalog.manage",
  "inventory.item.manage",
  "inventory.category.manage",
  "inventory.unit.manage",
  "inventory.par.manage",
  "inventory.count.create",
  "inventory.count.approve",
  "inventory.waste.create",
  "inventory.waste.approve",
  "inventory.transfer.create",
  "inventory.transfer.approve",
  "inventory.purchase.create",
  "inventory.purchase.approve",
  "inventory.receive",
  "inventory.vendor.manage",
  "inventory.price.manage",
  "recipe.manage",
  "prep.manage",
  "prep.complete",
  "menu.manage",
  "service.availability.manage",
];

const capabilitySet = new Set<string>(OPERATIONAL_CAPABILITIES);

export function isOperationalCapability(value: string): value is OperationalCapability {
  return capabilitySet.has(value);
}

/**
 * PostgREST represents a single-column `returns table` RPC as row objects at
 * runtime, while generated clients can describe the same response as a string
 * array. Accept both shapes so authorization does not disappear at the session
 * boundary when the transport representation differs from its generated type.
 */
export function normalizeOperationalCapabilities(value: unknown): OperationalCapability[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const capability =
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && "capability_key" in entry
          ? (entry as { capability_key?: unknown }).capability_key
          : null;

    return typeof capability === "string" && isOperationalCapability(capability)
      ? [capability]
      : [];
  });
}

export const DEMO_CAPABILITY_TEMPLATES = {
  executiveChef: [
    "inventory.item.manage",
    "inventory.category.manage",
    "inventory.unit.manage",
    "inventory.par.manage",
    "inventory.count.create",
    "inventory.count.approve",
    "inventory.waste.create",
    "inventory.waste.approve",
    "inventory.transfer.create",
    "inventory.purchase.create",
    "inventory.purchase.approve",
    "inventory.receive",
    "inventory.vendor.manage",
    "inventory.price.manage",
    "recipe.manage",
    "prep.manage",
    "prep.complete",
    "menu.manage",
    "schedule.manage",
    "schedule.publish",
    "service.availability.manage",
    "reports.operational.view",
  ],
  sousChef: [
    "inventory.count.create",
    "inventory.waste.create",
    "inventory.receive",
    "inventory.purchase.create",
    "recipe.manage",
    "prep.manage",
    "prep.complete",
    "service.availability.manage",
    "reports.operational.view",
  ],
  fohManager: [
    "schedule.manage",
    "schedule.publish",
    "time.review",
    "preshift.manage",
    "availability.manage",
    "service.availability.manage",
    "manager_log.manage",
    "guest.manage",
    "guest.sensitive_notes.view",
    "guest_recovery.manage",
    "reservations.view",
    "reservations.operate",
    "reservations.override",
    "reservations.configure",
    "closeout.create",
    "maintenance.manage",
    "reports.operational.view",
  ],
  barManager: [
    "inventory.item.manage",
    "inventory.category.manage",
    "inventory.unit.manage",
    "inventory.par.manage",
    "inventory.count.create",
    "inventory.waste.create",
    "inventory.purchase.create",
    "inventory.receive",
    "inventory.vendor.manage",
    "inventory.price.manage",
    "recipe.manage",
    "service.availability.manage",
    "reports.operational.view",
  ],
  employee: [],
} as const satisfies Record<string, readonly OperationalCapability[]>;

export function hasCapability(
  capabilities: readonly OperationalCapability[],
  capability: OperationalCapability,
): boolean {
  return capabilities.includes(capability);
}

export function hasAnyCapability(
  capabilities: readonly OperationalCapability[],
  required: readonly OperationalCapability[],
): boolean {
  return required.some((capability) => capabilities.includes(capability));
}
