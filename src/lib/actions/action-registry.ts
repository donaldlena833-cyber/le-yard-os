import type {
  WorkspaceActiveJobAssignment,
  WorkspaceContextValue,
} from "@/lib/auth/workspace-context";
import {
  KITCHEN_CAPABILITIES,
  hasAnyCapability,
  type OperationalCapability,
} from "@/lib/permissions/capabilities";
import type { AppRole } from "@/types";
import { isDestinationAllowedForAppSurface } from "@/lib/app-surface";

export type WorkMode =
  | "owner_operator"
  | "service_manager"
  | "host_service"
  | "foh_staff"
  | "kitchen_lead"
  | "boh_staff";

export type ServicePhase =
  "pre_service" | "in_service" | "post_service" | "off_hours";

export type ActionPrerequisite =
  | "active_workspace"
  | "employee_profile"
  | "reservation_snapshot"
  | "reservation_setup_ready"
  | "reservation_setup_needed"
  | "selected_reservation"
  | "selected_guest"
  | "selected_task"
  | "task_operable"
  | "selected_shift"
  | "shift_assigned_to_actor"
  | "shift_claimable"
  | "selected_inventory_item"
  | "selected_closeout";

export type ActionUrgency = "routine" | "attention" | "urgent" | "critical";
export type ActionReversibility =
  "navigation" | "reversible" | "confirmation_required" | "irreversible";
export type ActionOfflinePolicy =
  "requires_network" | "read_only_cache" | "queue_safe";
export type ActionSurface =
  "mobile_navigation" | "today_now" | "omnibox" | "object_context";
export type OmniboxGroup = "navigate" | "create" | "find" | "contextual";
export type MobileNavigationSlot = "home" | "primary" | "secondary" | "inbox";
export type WorkspaceDestination = `/${string}`;

export interface ActionCapabilityRequirement {
  anyOf: readonly OperationalCapability[];
  allOf: readonly OperationalCapability[];
  privilegedRoles: readonly AppRole[];
}

export interface OmniboxActionMetadata {
  group: OmniboxGroup;
  keywords: readonly string[];
  contextPaths?: readonly WorkspaceDestination[];
  queryParameter?: "q";
}

export interface ObjectActionMetadata {
  entity:
    | "reservation"
    | "guest"
    | "task"
    | "schedule_shift"
    | "inventory_item"
    | "closeout";
  operation: string;
  allowedStates: readonly string[];
  rank: number;
}

export interface ActionDefinition {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  workModes: readonly WorkMode[];
  capabilities: ActionCapabilityRequirement;
  servicePhases: readonly ServicePhase[];
  prerequisites: readonly ActionPrerequisite[];
  urgency: ActionUrgency;
  reversibility: ActionReversibility;
  destination: WorkspaceDestination;
  analyticsName: string;
  offlinePolicy: ActionOfflinePolicy;
  surfaces: readonly ActionSurface[];
  omnibox?: OmniboxActionMetadata;
  objectContext?: ObjectActionMetadata;
  hiddenPersonas?: readonly "chef"[];
  mobileSlots: readonly MobileNavigationSlot[];
  mobileRank: Partial<Record<WorkMode, number>>;
  nowRank: number | null;
}

const allWorkModes: readonly WorkMode[] = [
  "owner_operator",
  "service_manager",
  "host_service",
  "foh_staff",
  "kitchen_lead",
  "boh_staff",
];

const allServicePhases: readonly ServicePhase[] = [
  "pre_service",
  "in_service",
  "post_service",
  "off_hours",
];

const openCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: [],
  allOf: [],
  privilegedRoles: [],
};

const reservationCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: [
    "reservations.view",
    "reservations.operate",
    "reservations.override",
    "reservations.configure",
  ],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const kitchenCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: KITCHEN_CAPABILITIES,
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const inventoryCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: KITCHEN_CAPABILITIES.filter((capability) =>
    capability.startsWith("inventory."),
  ),
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const inventoryWasteCreateCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: ["inventory.waste.create"],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const inventoryTransferCreateCapabilityRequirement: ActionCapabilityRequirement =
  {
    anyOf: ["inventory.transfer.create"],
    allOf: [],
    privilegedRoles: ["owner", "admin"],
  };

const closeoutCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: [
    "closeout.create",
    "closeout.approve",
    "cash.manage",
    "tip.calculate",
    "tip.approve",
  ],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const closeoutCreateCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: ["closeout.create"],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const closeoutApproveCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: ["closeout.approve"],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const reportingCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: ["reports.operational.view", "reports.financial.view"],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const financialReportingCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: ["reports.financial.view"],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const scheduleManageCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: ["schedule.manage"],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const guestCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: [
    "guest.manage",
    "guest.sensitive_notes.view",
    "guest_recovery.manage",
  ],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const guestManageCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: ["guest.manage"],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const guestSensitiveWriteCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: [],
  allOf: ["guest.manage", "guest.sensitive_notes.view"],
  privilegedRoles: ["owner", "admin"],
};

const reservationOperateCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: ["reservations.operate", "reservations.override"],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const reservationControlCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: ["reservations.configure", "reservations.override"],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const managementRoleRequirement: ActionCapabilityRequirement = {
  anyOf: [],
  allOf: [],
  privilegedRoles: ["owner", "admin", "manager"],
};

const ownerAdminRequirement: ActionCapabilityRequirement = {
  anyOf: [],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const vendorCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: [
    "inventory.vendor.manage",
    "inventory.price.manage",
    "inventory.purchase.create",
    "inventory.receive",
  ],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

const integrationCapabilityRequirement: ActionCapabilityRequirement = {
  anyOf: ["integrations.manage"],
  allOf: [],
  privilegedRoles: ["owner", "admin"],
};

export const ACTION_REGISTRY = [
  {
    id: "navigate.today",
    label: "Today",
    shortLabel: "Today",
    description: "Open the current location operating picture.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/today",
    analyticsName: "nav_today_opened",
    offlinePolicy: "read_only_cache",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: { group: "navigate", keywords: ["home", "now", "dashboard"] },
    mobileSlots: ["home"],
    mobileRank: {
      owner_operator: 10,
      service_manager: 10,
      host_service: 10,
      foh_staff: 10,
      kitchen_lead: 10,
      boh_staff: 10,
    },
    nowRank: null,
  },
  {
    id: "navigate.reservations",
    label: "Reservations",
    shortLabel: "Reservations",
    description: "Open the internal reservation book for the active location.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/reservations",
    analyticsName: "nav_reservations_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: {
      group: "navigate",
      keywords: ["book", "host", "tables", "waitlist"],
    },
    mobileSlots: ["primary"],
    mobileRank: { host_service: 20 },
    nowRank: null,
  },
  {
    id: "navigate.guests",
    label: "Guests",
    shortLabel: "Guests",
    description: "Open authorized guest profiles and hospitality context.",
    workModes: allWorkModes,
    capabilities: guestCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/guests",
    analyticsName: "nav_guests_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: {
      group: "navigate",
      keywords: ["crm", "profiles", "hospitality"],
    },
    mobileSlots: ["secondary"],
    mobileRank: { host_service: 20 },
    nowRank: null,
  },
  {
    id: "navigate.service",
    label: "Service Control",
    shortLabel: "Service",
    description: "Open availability, pre-shift, and service handoff controls.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/service",
    analyticsName: "nav_service_control_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: {
      group: "navigate",
      keywords: ["pre-shift", "availability", "handoff"],
    },
    mobileSlots: ["primary", "secondary"],
    mobileRank: { service_manager: 20, host_service: 25 },
    nowRank: null,
  },
  {
    id: "navigate.time_clock",
    label: "Time Clock",
    shortLabel: "Clock",
    description: "Open punches, breaks, and corrections.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "confirmation_required",
    destination: "/time-clock",
    analyticsName: "nav_time_clock_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: { group: "navigate", keywords: ["punch", "clock", "break"] },
    mobileSlots: ["primary"],
    mobileRank: { foh_staff: 20, boh_staff: 20 },
    nowRank: null,
  },
  {
    id: "navigate.kitchen",
    label: "Kitchen",
    shortLabel: "Kitchen",
    description: "Open recipes, prep, and kitchen production.",
    workModes: allWorkModes,
    capabilities: kitchenCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/kitchen",
    analyticsName: "nav_kitchen_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: { group: "navigate", keywords: ["recipes", "prep", "production"] },
    mobileSlots: ["primary", "secondary"],
    mobileRank: { kitchen_lead: 20, boh_staff: 20 },
    nowRank: null,
  },
  {
    id: "navigate.closeout",
    label: "Closeout & tips",
    shortLabel: "Closeout",
    description: "Open closeout, cash, and tip approval workflows.",
    workModes: allWorkModes,
    capabilities: closeoutCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/closeout",
    analyticsName: "nav_closeout_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: { group: "navigate", keywords: ["money", "cash", "tips"] },
    hiddenPersonas: ["chef"],
    mobileSlots: ["primary"],
    mobileRank: { owner_operator: 20 },
    nowRank: null,
  },
  {
    id: "navigate.income",
    label: "Income",
    shortLabel: "Income",
    description: "Open live revenue, labor, recorded costs, and hourly demand.",
    workModes: allWorkModes,
    capabilities: financialReportingCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/income",
    analyticsName: "nav_income_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "navigate",
      keywords: ["revenue", "sales", "labor", "costs", "busy", "slow"],
    },
    hiddenPersonas: ["chef"],
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "navigate.reports",
    label: "Reports",
    shortLabel: "Reports",
    description: "Open authorized operational and financial reporting.",
    workModes: allWorkModes,
    capabilities: reportingCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/reports",
    analyticsName: "nav_reports_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: {
      group: "navigate",
      keywords: ["insights", "financial", "operations"],
    },
    mobileSlots: ["secondary"],
    mobileRank: { owner_operator: 20 },
    nowRank: null,
  },
  {
    id: "navigate.inventory",
    label: "Inventory",
    shortLabel: "Inventory",
    description: "Open authorized stock, counts, and purchasing workflows.",
    workModes: allWorkModes,
    capabilities: inventoryCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/inventory",
    analyticsName: "nav_inventory_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: { group: "navigate", keywords: ["stock", "counts", "purchasing"] },
    mobileSlots: ["secondary"],
    mobileRank: { kitchen_lead: 20 },
    nowRank: null,
  },
  {
    id: "navigate.tasks",
    label: "Tasks & SOPs",
    shortLabel: "Tasks",
    description: "Open assigned tasks, procedures, and operational follow-up.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/tasks",
    analyticsName: "nav_tasks_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: {
      group: "navigate",
      keywords: ["sop", "checklist", "maintenance"],
    },
    mobileSlots: ["secondary"],
    mobileRank: { boh_staff: 25 },
    nowRank: null,
  },
  {
    id: "navigate.schedule",
    label: "Schedule",
    shortLabel: "Schedule",
    description: "Open the current published schedule and coverage workflow.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/schedule",
    analyticsName: "nav_schedule_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: {
      group: "navigate",
      keywords: ["shifts", "coverage", "availability"],
    },
    mobileSlots: ["secondary"],
    mobileRank: {
      owner_operator: 30,
      service_manager: 30,
      host_service: 30,
      foh_staff: 30,
      kitchen_lead: 30,
      boh_staff: 30,
    },
    nowRank: null,
  },
  {
    id: "navigate.messages",
    label: "Messages",
    shortLabel: "Messages",
    description: "Open authorized location and team channels.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "reversible",
    destination: "/messages",
    analyticsName: "nav_messages_opened",
    offlinePolicy: "requires_network",
    surfaces: ["mobile_navigation", "omnibox"],
    omnibox: { group: "navigate", keywords: ["inbox", "chat", "channels"] },
    mobileSlots: ["inbox"],
    mobileRank: {
      owner_operator: 40,
      service_manager: 40,
      host_service: 40,
      foh_staff: 40,
      kitchen_lead: 40,
      boh_staff: 40,
    },
    nowRank: null,
  },
  {
    id: "navigate.reservation_setup",
    label: "Reservation controls",
    shortLabel: "Controls",
    description:
      "Open internal floor, service-rule, dated exception, and channel controls.",
    workModes: allWorkModes,
    capabilities: reservationControlCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/reservations/setup",
    analyticsName: "nav_reservation_setup_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "navigate",
      keywords: [
        "floor",
        "booking",
        "configuration",
        "closure",
        "pacing",
        "buffer",
      ],
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "navigate.vendors",
    label: "Vendors",
    shortLabel: "Vendors",
    description:
      "Open authorized supplier, price, purchasing, and receiving workflows.",
    workModes: allWorkModes,
    capabilities: vendorCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/vendors",
    analyticsName: "nav_vendors_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "navigate",
      keywords: ["supplier", "prices", "purchase"],
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "navigate.team",
    label: "People",
    shortLabel: "People",
    description: "Open authorized employee and job-role administration.",
    workModes: allWorkModes,
    capabilities: managementRoleRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/team",
    analyticsName: "nav_people_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: { group: "navigate", keywords: ["staff", "employees", "roles"] },
    hiddenPersonas: ["chef"],
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "navigate.earnings",
    label: "Earnings",
    shortLabel: "Earnings",
    description: "Open approved pay periods, tips, and hourly earnings.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/earnings",
    analyticsName: "nav_earnings_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: { group: "navigate", keywords: ["pay", "tips", "hours"] },
    hiddenPersonas: ["chef"],
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "navigate.receipts",
    label: "Invoices",
    shortLabel: "Invoices",
    description: "Open private receipt and invoice intake and review.",
    workModes: allWorkModes,
    capabilities: managementRoleRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/receipts",
    analyticsName: "nav_invoices_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: { group: "navigate", keywords: ["receipts", "ocr", "documents"] },
    hiddenPersonas: ["chef"],
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "navigate.assistant",
    label: "Ask Le Yard",
    shortLabel: "Ask",
    description: "Open authorized operational intelligence and cited answers.",
    workModes: allWorkModes,
    capabilities: reportingCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/assistant",
    analyticsName: "nav_assistant_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: { group: "navigate", keywords: ["ask", "search", "intelligence"] },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "navigate.integrations",
    label: "Integrations",
    shortLabel: "Integrations",
    description:
      "Open authorized imports, connections, and synchronization health.",
    workModes: allWorkModes,
    capabilities: integrationCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/integrations",
    analyticsName: "nav_integrations_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "navigate",
      keywords: ["sync", "imports", "connections"],
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "navigate.settings",
    label: "Settings",
    shortLabel: "Settings",
    description: "Open organization, capability, and security settings.",
    workModes: allWorkModes,
    capabilities: ownerAdminRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/settings",
    analyticsName: "nav_settings_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "navigate",
      keywords: ["organization", "security", "capabilities"],
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "create.task",
    label: "Create task",
    shortLabel: "Task",
    description: "Open management task creation controls in Tasks & SOPs.",
    workModes: allWorkModes,
    capabilities: managementRoleRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/tasks",
    analyticsName: "omnibox_create_task_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: { group: "create", keywords: ["new", "assignment", "todo"] },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "create.reservation",
    label: "Create reservation",
    shortLabel: "Reservation",
    description:
      "Open authorized internal booking controls; no public channel is enabled.",
    workModes: allWorkModes,
    capabilities: reservationOperateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/reservations",
    analyticsName: "omnibox_create_reservation_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: { group: "create", keywords: ["new", "book", "walk-in"] },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "create.guest",
    label: "Create guest profile",
    shortLabel: "Guest",
    description: "Open authorized guest-profile creation controls.",
    workModes: allWorkModes,
    capabilities: guestManageCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/guests",
    analyticsName: "omnibox_create_guest_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: { group: "create", keywords: ["new", "profile", "crm"] },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "find.guests",
    label: "Find guests",
    shortLabel: "Find guests",
    description:
      "Search only guest profiles visible in the authorized workspace.",
    workModes: allWorkModes,
    capabilities: guestCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/guests",
    analyticsName: "omnibox_guest_search_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "find",
      keywords: ["search", "name", "contact"],
      queryParameter: "q",
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "find.receipts",
    label: "Find invoices",
    shortLabel: "Find invoices",
    description: "Search authorized receipt metadata and indexed OCR text.",
    workModes: allWorkModes,
    capabilities: managementRoleRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/receipts",
    analyticsName: "omnibox_invoice_search_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "find",
      keywords: ["search", "receipt", "ocr"],
      queryParameter: "q",
    },
    hiddenPersonas: ["chef"],
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "context.reservation_book",
    label: "Open the service book",
    shortLabel: "Service book",
    description:
      "Move from the current service context into the internal reservation book.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/reservations",
    analyticsName: "omnibox_context_reservation_book_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "contextual",
      keywords: ["service", "host"],
      contextPaths: ["/today", "/reservations/setup"],
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "context.reservation_setup",
    label: "Review reservation controls",
    shortLabel: "Reservation controls",
    description:
      "Open authorized floor, service-rule, and dated exception controls.",
    workModes: allWorkModes,
    capabilities: reservationControlCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/reservations/setup",
    analyticsName: "omnibox_context_reservation_setup_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "contextual",
      keywords: ["floor", "rules", "closure", "pacing"],
      contextPaths: ["/reservations"],
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "context.service_control",
    label: "Open service control",
    shortLabel: "Service control",
    description:
      "Move from Today into availability, pre-shift, and handoff controls.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/service",
    analyticsName: "omnibox_context_service_control_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "contextual",
      keywords: ["availability", "handoff"],
      contextPaths: ["/today"],
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "context.inventory",
    label: "Open inventory",
    shortLabel: "Inventory",
    description:
      "Move from supplier context into authorized stock and count workflows.",
    workModes: allWorkModes,
    capabilities: kitchenCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/inventory",
    analyticsName: "omnibox_context_inventory_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "contextual",
      keywords: ["stock", "counts"],
      contextPaths: ["/vendors"],
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "context.vendors",
    label: "Open vendors",
    shortLabel: "Vendors",
    description:
      "Move from inventory context into authorized supplier and price workflows.",
    workModes: allWorkModes,
    capabilities: vendorCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace"],
    urgency: "routine",
    reversibility: "navigation",
    destination: "/vendors",
    analyticsName: "omnibox_context_vendors_opened",
    offlinePolicy: "requires_network",
    surfaces: ["omnibox"],
    omnibox: {
      group: "contextual",
      keywords: ["supplier", "prices"],
      contextPaths: ["/inventory", "/kitchen"],
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "guest.toggle_vip",
    label: "Change VIP status",
    shortLabel: "VIP status",
    description: "Change the selected guest's human-reviewed VIP flag.",
    workModes: allWorkModes,
    capabilities: guestManageCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_guest"],
    urgency: "attention",
    reversibility: "reversible",
    destination: "/guests",
    analyticsName: "guest_vip_status_changed",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "guest",
      operation: "toggle_vip",
      allowedStates: ["active"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "guest.add_note",
    label: "Add hospitality note",
    shortLabel: "Add note",
    description: "Append authorized hospitality context to the selected guest.",
    workModes: allWorkModes,
    capabilities: guestSensitiveWriteCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_guest"],
    urgency: "attention",
    reversibility: "irreversible",
    destination: "/guests",
    analyticsName: "guest_hospitality_note_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "guest",
      operation: "add_note",
      allowedStates: ["active"],
      rank: 20,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "guest.record_consent",
    label: "Record consent event",
    shortLabel: "Consent",
    description:
      "Append a server-timestamped consent event for the selected guest.",
    workModes: allWorkModes,
    capabilities: guestManageCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_guest"],
    urgency: "attention",
    reversibility: "reversible",
    destination: "/guests",
    analyticsName: "guest_consent_event_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "guest",
      operation: "record_consent",
      allowedStates: ["active"],
      rank: 30,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "guest.edit",
    label: "Edit guest profile",
    shortLabel: "Edit",
    description: "Edit the authorized profile fields for the selected guest.",
    workModes: allWorkModes,
    capabilities: guestManageCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_guest"],
    urgency: "routine",
    reversibility: "reversible",
    destination: "/guests",
    analyticsName: "guest_profile_edit_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "guest",
      operation: "edit",
      allowedStates: ["active"],
      rank: 40,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "guest.add_tag",
    label: "Add guest tag",
    shortLabel: "Add tag",
    description: "Add an authorized operational tag to the selected guest.",
    workModes: allWorkModes,
    capabilities: guestManageCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_guest"],
    urgency: "routine",
    reversibility: "reversible",
    destination: "/guests",
    analyticsName: "guest_tag_added",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "guest",
      operation: "add_tag",
      allowedStates: ["active"],
      rank: 50,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "task.start",
    label: "Start task",
    shortLabel: "Start",
    description: "Move the selected assigned task into active work.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_task", "task_operable"],
    urgency: "attention",
    reversibility: "reversible",
    destination: "/tasks",
    analyticsName: "task_start_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "task",
      operation: "start",
      allowedStates: ["open", "todo"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "task.resume",
    label: "Resume task",
    shortLabel: "Resume",
    description: "Resume an assigned task after its blocker is addressed.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_task", "task_operable"],
    urgency: "attention",
    reversibility: "reversible",
    destination: "/tasks",
    analyticsName: "task_resume_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "task",
      operation: "resume",
      allowedStates: ["blocked"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "task.block",
    label: "Block task",
    shortLabel: "Block",
    description: "Record that the selected assigned task cannot proceed.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_task", "task_operable"],
    urgency: "attention",
    reversibility: "reversible",
    destination: "/tasks",
    analyticsName: "task_block_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "task",
      operation: "block",
      allowedStates: ["open", "todo", "in_progress"],
      rank: 20,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "task.complete",
    label: "Complete task",
    shortLabel: "Complete",
    description:
      "Complete the selected task and preserve server-owned actor and time evidence.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_task", "task_operable"],
    urgency: "attention",
    reversibility: "irreversible",
    destination: "/tasks",
    analyticsName: "task_complete_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "task",
      operation: "complete",
      allowedStates: ["open", "todo", "in_progress"],
      rank: 30,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "task.reset",
    label: "Reset task to open",
    shortLabel: "Reset open",
    description: "Return a nonterminal task to the open management queue.",
    workModes: allWorkModes,
    capabilities: managementRoleRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_task", "task_operable"],
    urgency: "routine",
    reversibility: "reversible",
    destination: "/tasks",
    analyticsName: "task_reset_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "task",
      operation: "reset",
      allowedStates: ["in_progress", "blocked"],
      rank: 40,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "task.cancel",
    label: "Cancel task",
    shortLabel: "Cancel",
    description: "Cancel the selected task as a terminal management decision.",
    workModes: allWorkModes,
    capabilities: managementRoleRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_task", "task_operable"],
    urgency: "routine",
    reversibility: "irreversible",
    destination: "/tasks",
    analyticsName: "task_cancel_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "task",
      operation: "cancel",
      allowedStates: ["open", "todo", "in_progress", "blocked"],
      rank: 50,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "schedule_shift.edit",
    label: "Edit shift",
    shortLabel: "Edit",
    description: "Edit the selected draft shift before publication.",
    workModes: allWorkModes,
    capabilities: scheduleManageCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_shift"],
    urgency: "routine",
    reversibility: "reversible",
    destination: "/schedule",
    analyticsName: "schedule_shift_edit_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "schedule_shift",
      operation: "edit",
      allowedStates: ["draft"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "schedule_shift.acknowledge",
    label: "Acknowledge shift",
    shortLabel: "Acknowledge",
    description:
      "Record the assigned employee's acknowledgement of this shift.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: [
      "active_workspace",
      "selected_shift",
      "shift_assigned_to_actor",
    ],
    urgency: "attention",
    reversibility: "irreversible",
    destination: "/schedule",
    analyticsName: "schedule_shift_acknowledged",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "schedule_shift",
      operation: "acknowledge",
      allowedStates: ["scheduled", "claimed"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "schedule_shift.claim",
    label: "Claim open shift",
    shortLabel: "Claim",
    description: "Claim the selected open shift for the current employee.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_shift", "shift_claimable"],
    urgency: "attention",
    reversibility: "reversible",
    destination: "/schedule",
    analyticsName: "schedule_shift_claimed",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "schedule_shift",
      operation: "claim",
      allowedStates: ["open"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "schedule_shift.request_swap",
    label: "Request shift swap",
    shortLabel: "Request swap",
    description:
      "Request replacement coverage for the selected assigned shift.",
    workModes: allWorkModes,
    capabilities: openCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: [
      "active_workspace",
      "selected_shift",
      "shift_assigned_to_actor",
    ],
    urgency: "routine",
    reversibility: "reversible",
    destination: "/schedule",
    analyticsName: "schedule_shift_swap_requested",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "schedule_shift",
      operation: "request_swap",
      allowedStates: ["scheduled", "claimed"],
      rank: 20,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "schedule_shift.reopen",
    label: "Reopen shift for coverage",
    shortLabel: "Reopen",
    description:
      "Remove the current assignee and reopen the selected shift for coverage.",
    workModes: allWorkModes,
    capabilities: scheduleManageCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_shift"],
    urgency: "attention",
    reversibility: "confirmation_required",
    destination: "/schedule",
    analyticsName: "schedule_shift_reopen_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "schedule_shift",
      operation: "reopen",
      allowedStates: ["scheduled", "claimed", "cancelled"],
      rank: 30,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "inventory_item.record_waste",
    label: "Record item waste",
    shortLabel: "Record waste",
    description:
      "Record observed waste for the selected inventory item and independent review.",
    workModes: allWorkModes,
    capabilities: inventoryWasteCreateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_inventory_item"],
    urgency: "attention",
    reversibility: "confirmation_required",
    destination: "/inventory",
    analyticsName: "inventory_item_waste_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "inventory_item",
      operation: "record_waste",
      allowedStates: ["tracked"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "inventory_item.transfer",
    label: "Transfer inventory item",
    shortLabel: "Start transfer",
    description:
      "Start a pending location transfer with the selected inventory item prefilled.",
    workModes: allWorkModes,
    capabilities: inventoryTransferCreateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_inventory_item"],
    urgency: "routine",
    reversibility: "reversible",
    destination: "/inventory",
    analyticsName: "inventory_item_transfer_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "inventory_item",
      operation: "transfer",
      allowedStates: ["tracked"],
      rank: 20,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "closeout.attach_evidence",
    label: "Attach closeout evidence",
    shortLabel: "Attach evidence",
    description:
      "Attach private evidence to the selected nonterminal closeout record.",
    workModes: allWorkModes,
    capabilities: closeoutCreateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_closeout"],
    urgency: "routine",
    reversibility: "reversible",
    destination: "/closeout",
    analyticsName: "closeout_evidence_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "closeout",
      operation: "attach_evidence",
      allowedStates: ["pending", "in_review"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "closeout.approve",
    label: "Approve closeout",
    shortLabel: "Approve",
    description: "Approve and permanently lock the selected closeout evidence.",
    workModes: allWorkModes,
    capabilities: closeoutApproveCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_closeout"],
    urgency: "attention",
    reversibility: "irreversible",
    destination: "/closeout",
    analyticsName: "closeout_approval_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "closeout",
      operation: "approve",
      allowedStates: ["pending", "in_review"],
      rank: 20,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "closeout.reject",
    label: "Reject closeout",
    shortLabel: "Reject",
    description:
      "Reject and permanently lock the selected closeout with its original evidence.",
    workModes: allWorkModes,
    capabilities: closeoutApproveCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_closeout"],
    urgency: "attention",
    reversibility: "irreversible",
    destination: "/closeout",
    analyticsName: "closeout_rejection_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "closeout",
      operation: "reject",
      allowedStates: ["pending", "in_review"],
      rank: 30,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "reservation.edit",
    label: "Edit or reschedule reservation",
    shortLabel: "Edit / reschedule",
    description:
      "Review and record a new reservation commitment while preserving its revision evidence.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationOperateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_reservation"],
    urgency: "attention",
    reversibility: "confirmation_required",
    destination: "/reservations",
    analyticsName: "reservation_edit_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "reservation",
      operation: "edit",
      allowedStates: ["booked", "confirmed"],
      rank: 5,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "reservation.arrive",
    label: "Arrive",
    shortLabel: "Arrive",
    description: "Mark the selected booked or confirmed party as arrived.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationOperateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_reservation"],
    urgency: "urgent",
    reversibility: "reversible",
    destination: "/reservations",
    analyticsName: "reservation_arrived",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "reservation",
      operation: "arrive",
      allowedStates: ["booked", "confirmed"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "reservation.seat",
    label: "Seat",
    shortLabel: "Seat",
    description: "Mark the selected arrived party as seated.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationOperateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_reservation"],
    urgency: "urgent",
    reversibility: "reversible",
    destination: "/reservations",
    analyticsName: "reservation_seated",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "reservation",
      operation: "seat",
      allowedStates: ["arrived"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "reservation.complete",
    label: "Complete",
    shortLabel: "Complete",
    description: "Complete service for the selected seated party.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationOperateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_reservation"],
    urgency: "attention",
    reversibility: "reversible",
    destination: "/reservations",
    analyticsName: "reservation_completed",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "reservation",
      operation: "complete",
      allowedStates: ["seated"],
      rank: 10,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "reservation.suggest_table",
    label: "Assign table",
    shortLabel: "Assign table",
    description:
      "Enter table-assignment mode for the exact reservation interval.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationOperateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_reservation"],
    urgency: "attention",
    reversibility: "reversible",
    destination: "/reservations",
    analyticsName: "reservation_table_suggested",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "reservation",
      operation: "suggest_table",
      allowedStates: ["booked", "confirmed", "arrived"],
      rank: 20,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "reservation.share",
    label: "Share",
    shortLabel: "Share",
    description: "Share the selected reservation summary through this device.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_reservation"],
    urgency: "routine",
    reversibility: "reversible",
    destination: "/reservations",
    analyticsName: "reservation_summary_shared",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "reservation",
      operation: "share",
      allowedStates: [
        "pending_verification",
        "booked",
        "confirmed",
        "arrived",
        "seated",
        "completed",
        "cancelled",
        "no_show",
      ],
      rank: 30,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "reservation.no_show",
    label: "No-show",
    shortLabel: "No-show",
    description: "Close the selected unseated reservation as a no-show.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationOperateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_reservation"],
    urgency: "attention",
    reversibility: "confirmation_required",
    destination: "/reservations",
    analyticsName: "reservation_no_show_recorded",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "reservation",
      operation: "no_show",
      allowedStates: ["booked", "confirmed", "arrived"],
      rank: 40,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "reservation.cancel",
    label: "Cancel reservation",
    shortLabel: "Cancel",
    description:
      "Cancel the selected active commitment with required staff evidence.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationOperateCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: ["active_workspace", "selected_reservation"],
    urgency: "attention",
    reversibility: "confirmation_required",
    destination: "/reservations",
    analyticsName: "reservation_cancel_opened",
    offlinePolicy: "requires_network",
    surfaces: ["object_context"],
    objectContext: {
      entity: "reservation",
      operation: "cancel",
      allowedStates: ["booked", "confirmed", "arrived"],
      rank: 50,
    },
    mobileSlots: [],
    mobileRank: {},
    nowRank: null,
  },
  {
    id: "reservations.review_setup",
    label: "Review service setup",
    shortLabel: "Review setup",
    description:
      "Review the internal floor and service rules before operating the book.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationCapabilityRequirement,
    servicePhases: allServicePhases,
    prerequisites: [
      "active_workspace",
      "reservation_snapshot",
      "reservation_setup_needed",
    ],
    urgency: "urgent",
    reversibility: "navigation",
    destination: "/reservations",
    analyticsName: "today_reservation_setup_reviewed",
    offlinePolicy: "requires_network",
    surfaces: ["today_now"],
    mobileSlots: [],
    mobileRank: {},
    nowRank: 5,
  },
  {
    id: "reservations.prepare_service",
    label: "Review service book",
    shortLabel: "Review book",
    description:
      "Review arrivals, table assignments, and pacing before service.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationCapabilityRequirement,
    servicePhases: ["pre_service"],
    prerequisites: [
      "active_workspace",
      "reservation_snapshot",
      "reservation_setup_ready",
    ],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/reservations",
    analyticsName: "today_reservation_service_prepared",
    offlinePolicy: "requires_network",
    surfaces: ["today_now"],
    mobileSlots: [],
    mobileRank: {},
    nowRank: 10,
  },
  {
    id: "reservations.run_service",
    label: "Open reservation book",
    shortLabel: "Open book",
    description: "Review arrivals, seating, pacing, and waitlist exceptions.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationCapabilityRequirement,
    servicePhases: ["in_service"],
    prerequisites: [
      "active_workspace",
      "reservation_snapshot",
      "reservation_setup_ready",
    ],
    urgency: "urgent",
    reversibility: "navigation",
    destination: "/reservations",
    analyticsName: "today_reservation_service_opened",
    offlinePolicy: "requires_network",
    surfaces: ["today_now"],
    mobileSlots: [],
    mobileRank: {},
    nowRank: 10,
  },
  {
    id: "reservations.review_service",
    label: "Review reservation exceptions",
    shortLabel: "Review exceptions",
    description: "Review unresolved seating, waitlist, and pacing exceptions.",
    workModes: ["owner_operator", "service_manager", "host_service"],
    capabilities: reservationCapabilityRequirement,
    servicePhases: ["post_service", "off_hours"],
    prerequisites: [
      "active_workspace",
      "reservation_snapshot",
      "reservation_setup_ready",
    ],
    urgency: "attention",
    reversibility: "navigation",
    destination: "/reservations",
    analyticsName: "today_reservation_exceptions_reviewed",
    offlinePolicy: "requires_network",
    surfaces: ["today_now"],
    mobileSlots: [],
    mobileRank: {},
    nowRank: 10,
  },
] as const satisfies readonly ActionDefinition[];

export type ActionId = (typeof ACTION_REGISTRY)[number]["id"];

export interface ActionResolutionContext {
  role: AppRole;
  persona?: WorkspaceContextValue["persona"];
  workMode: WorkMode;
  capabilities: readonly OperationalCapability[];
  servicePhase: ServicePhase;
  satisfiedPrerequisites: readonly ActionPrerequisite[];
}

export interface ObjectActionResolution {
  action: ActionDefinition;
  authorized: boolean;
  available: boolean;
}

export type ActiveJobAssignmentDescriptor =
  Partial<WorkspaceActiveJobAssignment>;

function hasActionCapability(
  requirement: ActionCapabilityRequirement,
  context: Pick<ActionResolutionContext, "role" | "capabilities">,
): boolean {
  if (requirement.privilegedRoles.includes(context.role)) return true;
  if (
    requirement.anyOf.length &&
    !hasAnyCapability(context.capabilities, requirement.anyOf)
  ) {
    return false;
  }
  if (
    requirement.allOf.some(
      (capability) => !context.capabilities.includes(capability),
    )
  ) {
    return false;
  }
  return (
    Boolean(requirement.anyOf.length || requirement.allOf.length) ||
    !requirement.privilegedRoles.length
  );
}

export function resolveWorkMode(
  workspace: Pick<WorkspaceContextValue, "role" | "persona" | "capabilities">,
  activeJob?: ActiveJobAssignmentDescriptor | null,
): WorkMode {
  const activeJobLabel = [
    activeJob?.name,
    activeJob?.code,
    activeJob?.department,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    activeJobLabel &&
    ["host", "hostess", "maitre", "reservation", "guest service"].some((term) =>
      activeJobLabel.includes(term),
    )
  ) {
    return "host_service";
  }
  if (
    activeJobLabel &&
    [
      "boh",
      "back of house",
      "kitchen",
      "chef",
      "cook",
      "dish",
      "prep",
      "pastry",
    ].some((term) => activeJobLabel.includes(term))
  ) {
    return workspace.role === "employee" ? "boh_staff" : "kitchen_lead";
  }
  if (activeJobLabel && workspace.role === "employee") return "foh_staff";
  if (workspace.persona === "chef") return "kitchen_lead";
  if (workspace.role === "owner" || workspace.role === "admin")
    return "owner_operator";
  if (
    hasAnyCapability(workspace.capabilities, [
      "reservations.view",
      "reservations.operate",
      "reservations.override",
    ])
  ) {
    return "host_service";
  }
  if (workspace.role === "manager") return "service_manager";
  return "foh_staff";
}

export function isActionAuthorized(
  action: ActionDefinition,
  context: Pick<
    ActionResolutionContext,
    "role" | "persona" | "workMode" | "capabilities"
  >,
): boolean {
  return (
    action.workModes.includes(context.workMode) &&
    !action.hiddenPersonas?.includes(context.persona as "chef") &&
    hasActionCapability(action.capabilities, context)
  );
}

export function isActionAvailable(
  action: ActionDefinition,
  context: ActionResolutionContext,
): boolean {
  return (
    isActionAuthorized(action, context) &&
    action.servicePhases.includes(context.servicePhase) &&
    action.prerequisites.every((prerequisite) =>
      context.satisfiedPrerequisites.includes(prerequisite),
    )
  );
}

export function getActionDefinition(
  id: ActionId,
): (typeof ACTION_REGISTRY)[number] {
  return ACTION_REGISTRY.find((action) => action.id === id)!;
}

export function getAvailableActionsForSurface(
  surface: ActionSurface,
  context: ActionResolutionContext,
): ActionDefinition[] {
  const actions = ACTION_REGISTRY as readonly ActionDefinition[];
  return actions
    .filter((action) => action.surfaces.includes(surface))
    .filter((action) => isDestinationAllowedForAppSurface(action.destination))
    .filter((action) => isActionAvailable(action, context))
    .sort(
      (left, right) =>
        (left.nowRank ?? Number.MAX_SAFE_INTEGER) -
        (right.nowRank ?? Number.MAX_SAFE_INTEGER),
    );
}

export function getObjectActionResolutions(
  entity: ObjectActionMetadata["entity"],
  state: string,
  context: ActionResolutionContext,
): ObjectActionResolution[] {
  const actions = ACTION_REGISTRY as readonly ActionDefinition[];
  return actions
    .filter((action) => action.surfaces.includes("object_context"))
    .filter((action) => action.objectContext?.entity === entity)
    .filter((action) => action.objectContext?.allowedStates.includes(state))
    .map((action) => ({
      action,
      authorized: isActionAuthorized(action, context),
      available: isActionAvailable(action, context),
    }))
    .sort(
      (left, right) =>
        (left.action.objectContext?.rank ?? Number.MAX_SAFE_INTEGER) -
        (right.action.objectContext?.rank ?? Number.MAX_SAFE_INTEGER),
    );
}

export function getStableMobileDestinationActions(
  workspace: Pick<WorkspaceContextValue, "role" | "persona" | "capabilities">,
  activeJob?: ActiveJobAssignmentDescriptor | null,
): ActionDefinition[] {
  const workMode = resolveWorkMode(workspace, activeJob);
  const context = {
    role: workspace.role,
    persona: workspace.persona,
    workMode,
    capabilities: workspace.capabilities,
  };
  const actions: readonly ActionDefinition[] = ACTION_REGISTRY;
  const authorized = actions
    .filter((action) => action.surfaces.includes("mobile_navigation"))
    .filter((action) => isDestinationAllowedForAppSurface(action.destination))
    .filter((action) => isActionAuthorized(action, context))
    .filter((action) => action.mobileRank[workMode] !== undefined);
  const slots: readonly MobileNavigationSlot[] = [
    "home",
    "primary",
    "secondary",
    "inbox",
  ];
  const selectedIds = new Set<string>();
  return slots.flatMap((slot) => {
    const action = authorized
      .filter(
        (candidate) =>
          !selectedIds.has(candidate.id) &&
          candidate.mobileSlots.includes(slot),
      )
      .sort(
        (left, right) =>
          left.mobileRank[workMode]! - right.mobileRank[workMode]!,
      )[0];
    if (!action) return [];
    selectedIds.add(action.id);
    return [action];
  });
}

export function getAuthorizedOmniboxActions(
  workspace: Pick<
    WorkspaceContextValue,
    "role" | "persona" | "capabilities" | "activeJob"
  >,
  pathname: string,
): ActionDefinition[] {
  const workMode = resolveWorkMode(workspace, workspace.activeJob);
  return getAvailableActionsForSurface("omnibox", {
    role: workspace.role,
    persona: workspace.persona,
    workMode,
    capabilities: workspace.capabilities,
    servicePhase: "off_hours",
    satisfiedPrerequisites: ["active_workspace"],
  }).filter((action) => {
    const contextPaths = action.omnibox?.contextPaths;
    return (
      !contextPaths || contextPaths.includes(pathname as WorkspaceDestination)
    );
  });
}
