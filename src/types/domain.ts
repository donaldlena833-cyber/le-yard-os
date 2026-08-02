import type {
  CurrencyCode,
  DateRange,
  EntityId,
  FileReference,
  ISODate,
  ISODateTime,
  LocationScoped,
  MoneyCents,
  PostalAddress,
  RecordIdentity,
  Timestamped,
} from "./primitives";

export type AppRole = "owner" | "admin" | "manager" | "employee";
export type MembershipStatus = "invited" | "active" | "suspended" | "archived";
export type RecordStatus = "draft" | "pending" | "approved" | "rejected" | "archived";
export type ShiftPeriod = "open" | "mid" | "close" | "administrative";

export interface Organization extends Timestamped {
  id: EntityId;
  name: string;
  slug: string;
  timezone: string;
  currency: CurrencyCode;
  retentionPolicyConfigured: boolean;
  ownerIds: EntityId[];
}

export interface Location extends RecordIdentity, Timestamped {
  name: string;
  slug: string;
  timezone: string;
  phone: string;
  address: PostalAddress;
  active: boolean;
}

export interface OrganizationMembership extends RecordIdentity, Timestamped {
  userId: EntityId;
  role: AppRole;
  status: MembershipStatus;
  locationIds: EntityId[];
  organizationWide: boolean;
  invitedBy: EntityId | null;
  invitedAt: ISODateTime | null;
  acceptedAt: ISODateTime | null;
  mfaEnabled: boolean;
}

export interface JobRole extends RecordIdentity {
  name: string;
  code: string;
  department: "front_of_house" | "back_of_house" | "leadership" | "operations";
  color: string;
  clockEligible: boolean;
  tipEligible: boolean;
  active: boolean;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface WeeklyAvailability {
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  available: boolean;
  startsAtLocal: string | null;
  endsAtLocal: string | null;
  note: string | null;
}

export interface PersonProfile extends RecordIdentity, Timestamped {
  authUserId: EntityId | null;
  firstName: string;
  lastName: string;
  displayName: string;
  preferredName: string | null;
  email: string;
  phone: string;
  pronouns: string | null;
  avatarUrl: string | null;
  status: MembershipStatus;
  primaryRole: AppRole;
  jobRoleIds: EntityId[];
  locationIds: EntityId[];
  hiredOn: ISODate;
  birthdayMonthDay: string | null;
  emergencyContact: EmergencyContact | null;
  availability: WeeklyAvailability[];
  notes: string | null;
}

export interface TimeOffRequest extends RecordIdentity, DateRange, Timestamped {
  personId: EntityId;
  kind: "unavailable" | "vacation" | "sick" | "personal";
  reason: string;
  status: "pending" | "approved" | "declined" | "cancelled";
  reviewedBy: EntityId | null;
  reviewedAt: ISODateTime | null;
}

export interface Certification extends RecordIdentity, Timestamped {
  personId: EntityId;
  name: string;
  issuer: string;
  issuedOn: ISODate;
  expiresOn: ISODate | null;
  status: "current" | "expiring" | "expired";
  documentId: EntityId | null;
}

export interface EmployeeDocument extends RecordIdentity, Timestamped {
  personId: EntityId;
  kind: "handbook" | "tax" | "certification" | "training" | "other";
  title: string;
  file: FileReference;
  visibility: "employee_and_management" | "owners_and_admins";
  acknowledgedAt: ISODateTime | null;
}

export interface Schedule extends RecordIdentity, DateRange, Timestamped {
  locationId: EntityId;
  name: string;
  status: "draft" | "published" | "archived";
  templateId: EntityId | null;
  publishedBy: EntityId | null;
  publishedAt: ISODateTime | null;
}

export interface ScheduleTemplate extends RecordIdentity, Timestamped {
  locationId: EntityId;
  name: string;
  description: string;
  active: boolean;
  entries: Array<{
    weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    jobRoleId: EntityId;
    startsAtLocal: string;
    endsAtLocal: string;
    headcount: number;
  }>;
}

export interface Shift extends RecordIdentity, LocationScoped, Timestamped {
  scheduleId: EntityId;
  personId: EntityId | null;
  jobRoleId: EntityId;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  period: ShiftPeriod;
  status: "draft" | "published" | "acknowledged" | "open" | "completed" | "cancelled";
  unpaidBreakMinutes: number;
  note: string | null;
  acknowledgedAt: ISODateTime | null;
}

export interface ShiftSwap extends RecordIdentity, Timestamped {
  locationId: EntityId;
  shiftId: EntityId;
  requestedBy: EntityId;
  offeredTo: EntityId | null;
  acceptedBy: EntityId | null;
  reason: string;
  status: "open" | "accepted" | "approved" | "declined" | "cancelled";
  reviewedBy: EntityId | null;
}

export interface ChatChannel extends RecordIdentity, Timestamped {
  locationId: EntityId | null;
  name: string;
  kind: "all_staff" | "location" | "management" | "direct";
  visibility: "all_members" | "location_members" | "management" | "participants";
  participantIds: EntityId[];
  lastMessageAt: ISODateTime | null;
}

export interface ChatMessage extends RecordIdentity, Timestamped {
  channelId: EntityId;
  authorId: EntityId;
  body: string;
  attachmentIds: EntityId[];
  reactions: Array<{ emoji: string; personIds: EntityId[] }>;
  readBy: Array<{ personId: EntityId; readAt: ISODateTime }>;
  editedAt: ISODateTime | null;
}

export interface Announcement extends RecordIdentity, Timestamped {
  locationIds: EntityId[];
  authorId: EntityId;
  title: string;
  body: string;
  priority: "routine" | "important" | "urgent";
  publishedAt: ISODateTime;
  expiresAt: ISODateTime | null;
  acknowledgedBy: Array<{ personId: EntityId; acknowledgedAt: ISODateTime }>;
}

export interface ClockBreak {
  id: EntityId;
  kind: "paid" | "unpaid";
  startsAt: ISODateTime;
  endsAt: ISODateTime | null;
}

export interface Timecard extends RecordIdentity, LocationScoped, Timestamped {
  personId: EntityId;
  shiftId: EntityId | null;
  jobRoleId: EntityId;
  clockedInAt: ISODateTime;
  clockedOutAt: ISODateTime | null;
  breaks: ClockBreak[];
  regularMinutes: number;
  overtimeMinutes: number;
  status: "open" | "complete" | "correction_pending" | "approved";
  source: "kiosk" | "mobile" | "manager" | "import";
}

export interface TimecardCorrection extends RecordIdentity, Timestamped {
  locationId: EntityId;
  timecardId: EntityId;
  requestedBy: EntityId;
  requestedClockInAt: ISODateTime | null;
  requestedClockOutAt: ISODateTime | null;
  reason: string;
  status: "pending" | "approved" | "declined";
  reviewedBy: EntityId | null;
  reviewedAt: ISODateTime | null;
}

export interface Closeout extends RecordIdentity, LocationScoped, Timestamped {
  businessDate: ISODate;
  preparedBy: EntityId;
  approvedBy: EntityId | null;
  approvedAt: ISODateTime | null;
  status: "draft" | "submitted" | "approved" | "reopened";
  covers: number;
  grossSalesCents: MoneyCents;
  netSalesCents: MoneyCents;
  cashSalesCents: MoneyCents;
  cardSalesCents: MoneyCents;
  compsCents: MoneyCents;
  voidsCents: MoneyCents;
  expectedCashCents: MoneyCents;
  actualCashCents: MoneyCents;
  cashVarianceCents: MoneyCents;
  notes: string;
  attachmentIds: EntityId[];
}

export type TipDistributionMethod = "hours" | "weighted_points";

export interface TipPoolRule extends RecordIdentity, Timestamped {
  name: string;
  version: number;
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  method: TipDistributionMethod;
  eligibleJobRoleIds: EntityId[];
  roleWeights: Record<EntityId, number>;
  serviceChargeIncluded: boolean;
  status: "draft" | "active" | "retired";
}

export interface TipPoolRun extends RecordIdentity, LocationScoped, Timestamped {
  ruleId: EntityId;
  businessDate: ISODate;
  cashTipsCents: MoneyCents;
  cardTipsCents: MoneyCents;
  serviceChargesCents: MoneyCents;
  adjustmentsCents: MoneyCents;
  distributableCents: MoneyCents;
  status: "draft" | "review" | "approved" | "locked";
  approvedBy: EntityId | null;
  approvedAt: ISODateTime | null;
  explanation: string;
  allocations: Array<{
    personId: EntityId;
    eligibleMinutes: number;
    weight: number;
    adjustmentCents: MoneyCents;
    allocatedCents: MoneyCents;
    excludedReason: string | null;
  }>;
}

export type DocumentReviewStatus =
  | "processing"
  | "needs_review"
  | "verified"
  | "rejected"
  | "duplicate";

export interface Receipt extends RecordIdentity, LocationScoped, Timestamped {
  kind: "receipt" | "invoice";
  vendorId: EntityId | null;
  purchaseOrderId: EntityId | null;
  expenseCategory: string;
  documentNumber: string | null;
  documentDate: ISODate;
  dueDate: ISODate | null;
  subtotalCents: MoneyCents;
  taxCents: MoneyCents;
  totalCents: MoneyCents;
  currency: CurrencyCode;
  file: FileReference;
  ocrText: string;
  extractionConfidence: number;
  reviewStatus: DocumentReviewStatus;
  duplicateOfId: EntityId | null;
  reviewedBy: EntityId | null;
}

export type InventoryUnit = "each" | "ounce" | "pound" | "gram" | "kilogram" | "milliliter" | "liter" | "case";

export interface UnitConversion {
  from: InventoryUnit;
  to: InventoryUnit;
  multiplier: number;
}

export interface InventoryItem extends RecordIdentity, Timestamped {
  name: string;
  sku: string;
  category: string;
  baseUnit: InventoryUnit;
  purchaseUnit: InventoryUnit;
  conversions: UnitConversion[];
  locationSettings: Array<{
    locationId: EntityId;
    parLevel: number;
    reorderPoint: number;
    active: boolean;
  }>;
  preferredVendorId: EntityId | null;
  lastUnitCostCents: MoneyCents;
}

export interface Vendor extends RecordIdentity, Timestamped {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  accountNumberMasked: string;
  paymentTerms: string;
  active: boolean;
}

export interface PurchaseOrder extends RecordIdentity, LocationScoped, Timestamped {
  vendorId: EntityId;
  orderNumber: string;
  orderedBy: EntityId;
  orderedAt: ISODateTime;
  expectedOn: ISODate;
  status: "draft" | "submitted" | "partial" | "received" | "cancelled";
  lines: Array<{
    id: EntityId;
    itemId: EntityId;
    orderedQuantity: number;
    receivedQuantity: number;
    unit: InventoryUnit;
    unitCostCents: MoneyCents;
  }>;
  totalCents: MoneyCents;
}

export interface Delivery extends RecordIdentity, LocationScoped, Timestamped {
  purchaseOrderId: EntityId;
  vendorId: EntityId;
  receivedBy: EntityId;
  receivedAt: ISODateTime;
  status: "partial" | "complete" | "disputed";
  temperatureNote: string | null;
  attachmentIds: EntityId[];
}

export interface InventoryCount extends RecordIdentity, LocationScoped, Timestamped {
  countedBy: EntityId;
  businessDate: ISODate;
  status: "in_progress" | "submitted" | "approved";
  lines: Array<{
    itemId: EntityId;
    expectedQuantity: number;
    countedQuantity: number;
    unit: InventoryUnit;
    varianceQuantity: number;
    varianceValueCents: MoneyCents;
  }>;
  approvedBy: EntityId | null;
}

export interface WasteRecord extends RecordIdentity, LocationScoped, Timestamped {
  itemId: EntityId;
  quantity: number;
  unit: InventoryUnit;
  valueCents: MoneyCents;
  reason: "spoilage" | "prep_error" | "guest_return" | "damage" | "other";
  recordedBy: EntityId;
  occurredAt: ISODateTime;
  note: string;
}

export interface InventoryTransfer extends RecordIdentity, Timestamped {
  fromLocationId: EntityId;
  toLocationId: EntityId;
  itemId: EntityId;
  quantity: number;
  unit: InventoryUnit;
  status: "requested" | "in_transit" | "received" | "cancelled";
  requestedBy: EntityId;
  receivedBy: EntityId | null;
}

export interface InventoryPrice extends RecordIdentity, Timestamped {
  vendorId: EntityId;
  itemId: EntityId;
  unit: InventoryUnit;
  unitCostCents: MoneyCents;
  effectiveOn: ISODate;
  sourceReceiptId: EntityId | null;
}

export interface Recipe extends RecordIdentity, Timestamped {
  name: string;
  menuCode: string;
  yieldQuantity: number;
  yieldUnit: InventoryUnit;
  ingredients: Array<{ itemId: EntityId; quantity: number; unit: InventoryUnit; costCents: MoneyCents }>;
  totalCostCents: MoneyCents;
  costPerYieldCents: MoneyCents;
  menuPriceCents: MoneyCents;
  foodCostPercentage: number;
}

export interface GuestContact {
  email: string | null;
  phone: string | null;
  preferredChannel: "email" | "sms" | "none";
}

export interface Guest extends RecordIdentity, Timestamped {
  firstName: string;
  lastName: string;
  contact: GuestContact;
  birthdayMonthDay: string | null;
  preferences: string[];
  allergies: string[];
  tags: string[];
  vip: boolean;
  notes: string;
  lifetimeSpendCents: MoneyCents;
  visitCount: number;
  lastVisitAt: ISODateTime | null;
  mergedIntoId: EntityId | null;
}

export interface GuestVisit extends RecordIdentity, LocationScoped, Timestamped {
  guestId: EntityId;
  reservationId: EntityId | null;
  visitedAt: ISODateTime;
  partySize: number;
  spendCents: MoneyCents;
  serverPersonId: EntityId | null;
  source: "walk_in" | "resy" | "toast" | "manual";
  notes: string;
}

export interface Reservation extends RecordIdentity, LocationScoped, Timestamped {
  guestId: EntityId;
  externalId: string | null;
  startsAt: ISODateTime;
  partySize: number;
  status: "booked" | "seated" | "completed" | "cancelled" | "no_show";
  source: "resy" | "phone" | "walk_in" | "manual";
  tableLabel: string | null;
  notes: string;
}

export interface ConsentRecord extends RecordIdentity, Timestamped {
  guestId: EntityId;
  channel: "email" | "sms";
  status: "granted" | "withdrawn" | "unknown";
  capturedAt: ISODateTime;
  source: string;
}

export interface DuplicateGuestCandidate extends RecordIdentity, Timestamped {
  guestId: EntityId;
  possibleDuplicateId: EntityId;
  confidence: number;
  reasons: string[];
  status: "open" | "merged" | "dismissed";
  reviewedBy: EntityId | null;
}

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";

export interface Task extends RecordIdentity, Timestamped {
  locationId: EntityId | null;
  title: string;
  description: string;
  category: "opening" | "closing" | "operations" | "maintenance" | "training";
  priority: "low" | "normal" | "high" | "urgent";
  assignedTo: EntityId | null;
  assignedRole: AppRole | null;
  dueAt: ISODateTime;
  status: TaskStatus;
  completedBy: EntityId | null;
  completedAt: ISODateTime | null;
}

export interface Checklist extends RecordIdentity, Timestamped {
  locationId: EntityId;
  name: string;
  kind: "opening" | "closing" | "custom";
  items: Array<{ id: EntityId; label: string; required: boolean; sopId: EntityId | null }>;
  active: boolean;
}

export interface ChecklistRun extends RecordIdentity, Timestamped {
  locationId: EntityId;
  checklistId: EntityId;
  businessDate: ISODate;
  completedItems: Array<{ itemId: EntityId; completedBy: EntityId; completedAt: ISODateTime; note: string | null }>;
  status: "in_progress" | "complete" | "approved";
  approvedBy: EntityId | null;
}

export interface SOPDocument extends RecordIdentity, Timestamped {
  title: string;
  category: string;
  version: number;
  body: string;
  status: "draft" | "published" | "retired";
  publishedAt: ISODateTime | null;
  ownerId: EntityId;
  locationIds: EntityId[];
  acknowledgements: Array<{ personId: EntityId; version: number; acknowledgedAt: ISODateTime }>;
}

export interface MaintenanceRequest extends RecordIdentity, LocationScoped, Timestamped {
  title: string;
  description: string;
  asset: string;
  priority: "low" | "normal" | "high" | "emergency";
  reportedBy: EntityId;
  assignedTo: EntityId | null;
  status: "reported" | "scheduled" | "in_progress" | "resolved";
  resolvedAt: ISODateTime | null;
}

export interface Incident extends RecordIdentity, LocationScoped, Timestamped {
  kind: "employee" | "guest" | "safety" | "security" | "equipment";
  occurredAt: ISODateTime;
  reportedBy: EntityId;
  summary: string;
  details: string;
  involvedPersonIds: EntityId[];
  witnessNames: string[];
  status: "open" | "reviewing" | "closed";
  reviewedBy: EntityId | null;
  attachmentIds: EntityId[];
}

export type ReportKind =
  | "labor"
  | "attendance"
  | "overtime"
  | "tips"
  | "payroll"
  | "sales_to_labor"
  | "receipts"
  | "expenses"
  | "inventory_variance"
  | "cogs"
  | "waste"
  | "vendor_pricing"
  | "shift_performance"
  | "guest_activity";

export interface SavedReport extends RecordIdentity, Timestamped {
  name: string;
  kind: ReportKind;
  ownerId: EntityId;
  locationIds: EntityId[];
  filters: { startsOn: ISODate; endsOn: ISODate; [key: string]: string | string[] | number };
  columns: string[];
  supportedExports: Array<"csv" | "pdf">;
  lastRunAt: ISODateTime | null;
  schedule: "none" | "daily" | "weekly" | "monthly";
}

export interface ReportSnapshot extends RecordIdentity, Timestamped {
  reportId: EntityId;
  generatedBy: EntityId;
  generatedAt: ISODateTime;
  locationIds: EntityId[];
  summary: string;
  metrics: Array<{ key: string; label: string; value: number; unit: "currency_cents" | "count" | "hours" | "percentage" }>;
  exportFileIds: EntityId[];
}

export type IntegrationProvider = "toast" | "resy" | "csv" | "payroll" | "accounting";

export interface IntegrationConnection extends RecordIdentity, Timestamped {
  locationIds: EntityId[];
  provider: IntegrationProvider;
  mode: "manual_import" | "sandbox" | "live";
  status: "not_configured" | "connected" | "degraded" | "paused";
  encryptedCredentialRef: string | null;
  lastSyncAt: ISODateTime | null;
  nextRetryAt: ISODateTime | null;
  retryCount: number;
  capabilities: Array<"read_sales" | "read_reservations" | "export_payroll" | "import_csv">;
}

export type IntegrationSyncStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled";

export interface IntegrationSync extends RecordIdentity, Timestamped {
  connectionId: EntityId;
  direction: "import" | "export";
  startedAt: ISODateTime;
  completedAt: ISODateTime | null;
  status: IntegrationSyncStatus;
  recordsRead: number;
  recordsWritten: number;
  recordsRejected: number;
  attempt: number;
  errorSummary: string | null;
  importFileId: EntityId | null;
}

export type AIInsightKind = "extraction" | "search" | "summary" | "anomaly" | "forecast";
export type AIRestrictedAction =
  | "finalize_payroll"
  | "finalize_tip_distribution"
  | "approve_punch_edit"
  | "post_inventory_adjustment"
  | "mutate_guest_record";

export interface AICitation {
  id: EntityId;
  entityType: string;
  entityId: EntityId;
  label: string;
  excerpt: string;
  occurredAt: ISODateTime;
}

export interface AIInsight extends RecordIdentity, Timestamped {
  locationIds: EntityId[];
  kind: AIInsightKind;
  title: string;
  summary: string;
  confidence: number;
  citations: AICitation[];
  proposedAction: AIRestrictedAction | null;
  status: "informational" | "awaiting_human_review" | "accepted" | "dismissed";
  reviewedBy: EntityId | null;
  reviewedAt: ISODateTime | null;
}

export interface OperationalAlert extends RecordIdentity, Timestamped {
  locationId: EntityId | null;
  kind: "labor" | "attendance" | "inventory" | "cash" | "integration" | "compliance";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  sourceEntityType: string;
  sourceEntityId: EntityId;
  status: "open" | "acknowledged" | "resolved";
  assignedTo: EntityId | null;
}

export interface Notification extends RecordIdentity, Timestamped {
  recipientId: EntityId;
  kind: "schedule" | "chat" | "task" | "timeclock" | "approval" | "inventory" | "system";
  title: string;
  body: string;
  actionUrl: string;
  readAt: ISODateTime | null;
}

export interface AuditEvent extends RecordIdentity {
  locationId: EntityId | null;
  actorId: EntityId | null;
  actorType: "user" | "system" | "integration";
  action: string;
  entityType: string;
  entityId: EntityId;
  occurredAt: ISODateTime;
  ipAddressMasked: string | null;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  immutable: true;
}

/**
 * Owner-supplied assumptions shown in the nonproduction playground.
 * These values are unpublished reference notes and must not be used as a
 * scheduling, payroll, tip, fee, or deletion rules engine.
 */
export interface OwnerDraftOperatingAssumptions {
  status: "unpublished";
  source: "owner_supplied";
  purpose: "reference_only";
  updatedAt: ISODateTime;
  break: {
    scheduledShiftLongerThanMinutes: 360;
    minimumUnpaidBreakMinutes: 30;
    timingStatus: "compliance_review_pending";
    calculationEnabled: false;
  };
  overtime: {
    multiplier: 1.5;
    thresholdHours: null;
    workweek: null;
    exemptionsConfigured: false;
    calculationEnabled: false;
  };
  gratuity: {
    automaticGratuity: false;
    customerTips: "voluntary";
  };
  eventFee: {
    rateBasisPoints: 1_000;
    includedInTips: false;
    treatmentStatus: "review_pending";
    calculationEnabled: false;
  };
  payrollExport: {
    status: "undecided";
    enabled: false;
  };
  retention: {
    status: "unset";
    automaticDeletionEnabled: false;
  };
}

export interface DemoWorkspace {
  asOf: ISODateTime;
  ownerDraftOperatingAssumptions: OwnerDraftOperatingAssumptions;
  organizations: Organization[];
  locations: Location[];
  memberships: OrganizationMembership[];
  people: PersonProfile[];
  jobRoles: JobRole[];
  timeOffRequests: TimeOffRequest[];
  certifications: Certification[];
  employeeDocuments: EmployeeDocument[];
  schedules: Schedule[];
  scheduleTemplates: ScheduleTemplate[];
  shifts: Shift[];
  shiftSwaps: ShiftSwap[];
  chatChannels: ChatChannel[];
  chatMessages: ChatMessage[];
  announcements: Announcement[];
  timecards: Timecard[];
  timecardCorrections: TimecardCorrection[];
  closeouts: Closeout[];
  tipPoolRules: TipPoolRule[];
  tipPoolRuns: TipPoolRun[];
  receipts: Receipt[];
  inventoryItems: InventoryItem[];
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  deliveries: Delivery[];
  inventoryCounts: InventoryCount[];
  wasteRecords: WasteRecord[];
  inventoryTransfers: InventoryTransfer[];
  inventoryPrices: InventoryPrice[];
  recipes: Recipe[];
  guests: Guest[];
  guestVisits: GuestVisit[];
  reservations: Reservation[];
  consentRecords: ConsentRecord[];
  duplicateGuestCandidates: DuplicateGuestCandidate[];
  tasks: Task[];
  checklists: Checklist[];
  checklistRuns: ChecklistRun[];
  sopDocuments: SOPDocument[];
  maintenanceRequests: MaintenanceRequest[];
  incidents: Incident[];
  savedReports: SavedReport[];
  reportSnapshots: ReportSnapshot[];
  integrationConnections: IntegrationConnection[];
  integrationSyncs: IntegrationSync[];
  aiInsights: AIInsight[];
  alerts: OperationalAlert[];
  notifications: Notification[];
  auditEvents: AuditEvent[];
}
