import type {
  DemoWorkspace,
  FileReference,
  OwnerDraftOperatingAssumptions,
  WeeklyAvailability,
} from "../../types";

export const demoIds = {
  organization: "org-le-yard-demo",
  locations: {
    garden: "loc-garden-demo",
    market: "loc-market-demo",
  },
  people: {
    donald: "person-donald-demo",
    maris: "person-maris-demo",
    irini: "person-irini-demo",
    aisha: "person-aisha-demo",
    mateo: "person-mateo-demo",
    imani: "person-imani-demo",
    leo: "person-leo-demo",
    priya: "person-priya-demo",
    sam: "person-sam-demo",
  },
  jobRoles: {
    ownerOperator: "role-owner-operator",
    floorManager: "role-floor-manager",
    server: "role-server",
    bartender: "role-bartender",
    lineCook: "role-line-cook",
    prepCook: "role-prep-cook",
  },
} as const;

const orgId = demoIds.organization;
const gardenId = demoIds.locations.garden;
const marketId = demoIds.locations.market;
const { donald, maris, irini, aisha, mateo, imani, leo, priya, sam } = demoIds.people;
const { ownerOperator, floorManager, server, bartender, lineCook, prepCook } = demoIds.jobRoles;

const alwaysAvailable: WeeklyAvailability[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
  available: true,
  startsAtLocal: "09:00",
  endsAtLocal: "23:30",
  note: null,
}));

const eveningAvailability: WeeklyAvailability[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
  available: ![1, 2].includes(weekday),
  startsAtLocal: ![1, 2].includes(weekday) ? "15:00" : null,
  endsAtLocal: ![1, 2].includes(weekday) ? "23:30" : null,
  note: [1, 2].includes(weekday) ? "Class" : null,
}));

function privateFile(
  id: string,
  fileName: string,
  objectPath: string,
  uploadedBy: string,
  uploadedAt: string,
  mediaType = "application/pdf",
  byteSize = 128_000,
): FileReference {
  return {
    id,
    bucket: "private-demo-documents",
    objectPath,
    fileName,
    mediaType,
    byteSize,
    uploadedBy,
    uploadedAt,
    access: "private",
  };
}

/**
 * Fully synthetic workspace used by the UI, stories, and local tests.
 * The Le Yard tenant name and Ninth Avenue address are owner-supplied playground
 * presentation. Staff, job codes, operational records, emails, and phone numbers
 * remain synthetic mock data. Nothing here is production restaurant activity.
 */
export const ownerDraftOperatingAssumptions = {
  status: "unpublished",
  source: "owner_supplied",
  purpose: "reference_only",
  updatedAt: "2026-08-02T12:00:00-04:00",
  break: {
    scheduledShiftLongerThanMinutes: 360,
    minimumUnpaidBreakMinutes: 30,
    timingStatus: "compliance_review_pending",
    calculationEnabled: false,
  },
  overtime: {
    multiplier: 1.5,
    thresholdHours: null,
    workweek: null,
    exemptionsConfigured: false,
    calculationEnabled: false,
  },
  gratuity: {
    automaticGratuity: false,
    customerTips: "voluntary",
  },
  eventFee: {
    rateBasisPoints: 1_000,
    includedInTips: false,
    treatmentStatus: "review_pending",
    calculationEnabled: false,
  },
  payrollExport: {
    status: "undecided",
    enabled: false,
  },
  retention: {
    status: "unset",
    automaticDeletionEnabled: false,
  },
} as const satisfies OwnerDraftOperatingAssumptions;

export const demoWorkspace: DemoWorkspace = {
  asOf: "2026-08-01T14:30:00-04:00",
  ownerDraftOperatingAssumptions,
  organizations: [
    {
      id: orgId,
      name: "Le Yard — Playground",
      slug: "le-yard-playground",
      timezone: "America/New_York",
      currency: "USD",
      retentionPolicyConfigured: false,
      ownerIds: [donald, maris],
      createdAt: "2026-01-02T10:00:00-05:00",
      updatedAt: "2026-07-28T16:20:00-04:00",
    },
  ],
  locations: [
    {
      id: gardenId,
      organizationId: orgId,
      name: "Le Yard — Playground",
      slug: "le-yard-playground",
      timezone: "America/New_York",
      phone: "+1-212-555-0101",
      address: {
        line1: "858 9th Ave",
        line2: null,
        city: "New York",
        region: "NY",
        postalCode: "10019",
        countryCode: "US",
      },
      active: true,
      createdAt: "2026-01-02T10:05:00-05:00",
      updatedAt: "2026-07-20T09:00:00-04:00",
    },
    {
      id: marketId,
      organizationId: orgId,
      name: "Market Room — Demo",
      slug: "market-room-demo",
      timezone: "America/New_York",
      phone: "+1-212-555-0102",
      address: {
        line1: "202 Sample Street",
        line2: "Suite 2",
        city: "Queens",
        region: "NY",
        postalCode: "11101",
        countryCode: "US",
      },
      active: true,
      createdAt: "2026-03-10T11:00:00-05:00",
      updatedAt: "2026-07-20T09:00:00-04:00",
    },
  ],
  memberships: [
    { id: "membership-donald", organizationId: orgId, userId: donald, role: "owner", status: "active", locationIds: [gardenId, marketId], organizationWide: true, invitedBy: null, invitedAt: null, acceptedAt: "2026-01-02T10:00:00-05:00", mfaEnabled: true, createdAt: "2026-01-02T10:00:00-05:00", updatedAt: "2026-07-01T09:00:00-04:00" },
    { id: "membership-maris", organizationId: orgId, userId: maris, role: "owner", status: "active", locationIds: [gardenId, marketId], organizationWide: true, invitedBy: donald, invitedAt: "2026-01-02T10:10:00-05:00", acceptedAt: "2026-01-02T10:18:00-05:00", mfaEnabled: true, createdAt: "2026-01-02T10:10:00-05:00", updatedAt: "2026-07-01T09:00:00-04:00" },
    { id: "membership-irini", organizationId: orgId, userId: irini, role: "employee", status: "active", locationIds: [gardenId], organizationWide: false, invitedBy: maris, invitedAt: "2026-08-05T12:00:00-04:00", acceptedAt: "2026-08-05T12:10:00-04:00", mfaEnabled: false, createdAt: "2026-08-05T12:00:00-04:00", updatedAt: "2026-08-05T12:10:00-04:00" },
    { id: "membership-aisha", organizationId: orgId, userId: aisha, role: "manager", status: "active", locationIds: [gardenId], organizationWide: false, invitedBy: maris, invitedAt: "2026-02-01T12:00:00-05:00", acceptedAt: "2026-02-01T12:12:00-05:00", mfaEnabled: true, createdAt: "2026-02-01T12:00:00-05:00", updatedAt: "2026-07-12T11:00:00-04:00" },
    { id: "membership-mateo", organizationId: orgId, userId: mateo, role: "manager", status: "active", locationIds: [marketId], organizationWide: false, invitedBy: donald, invitedAt: "2026-03-11T10:00:00-04:00", acceptedAt: "2026-03-11T10:30:00-04:00", mfaEnabled: false, createdAt: "2026-03-11T10:00:00-04:00", updatedAt: "2026-07-12T11:00:00-04:00" },
    { id: "membership-imani", organizationId: orgId, userId: imani, role: "employee", status: "active", locationIds: [gardenId], organizationWide: false, invitedBy: aisha, invitedAt: "2026-04-03T12:00:00-04:00", acceptedAt: "2026-04-03T12:45:00-04:00", mfaEnabled: false, createdAt: "2026-04-03T12:00:00-04:00", updatedAt: "2026-07-12T11:00:00-04:00" },
    { id: "membership-leo", organizationId: orgId, userId: leo, role: "employee", status: "active", locationIds: [gardenId, marketId], organizationWide: false, invitedBy: maris, invitedAt: "2026-04-08T12:00:00-04:00", acceptedAt: "2026-04-08T12:20:00-04:00", mfaEnabled: false, createdAt: "2026-04-08T12:00:00-04:00", updatedAt: "2026-07-12T11:00:00-04:00" },
    { id: "membership-priya", organizationId: orgId, userId: priya, role: "employee", status: "active", locationIds: [marketId], organizationWide: false, invitedBy: mateo, invitedAt: "2026-05-02T12:00:00-04:00", acceptedAt: "2026-05-02T12:35:00-04:00", mfaEnabled: false, createdAt: "2026-05-02T12:00:00-04:00", updatedAt: "2026-07-12T11:00:00-04:00" },
    { id: "membership-sam", organizationId: orgId, userId: sam, role: "employee", status: "invited", locationIds: [marketId], organizationWide: false, invitedBy: mateo, invitedAt: "2026-07-31T09:30:00-04:00", acceptedAt: null, mfaEnabled: false, createdAt: "2026-07-31T09:30:00-04:00", updatedAt: "2026-07-31T09:30:00-04:00" },
  ],
  people: [
    { id: donald, organizationId: orgId, authUserId: "auth-donald-demo", firstName: "Donald", lastName: "Demo", displayName: "Donald", preferredName: null, email: "donald@le-yard.example.invalid", phone: "+1-212-555-0110", pronouns: null, avatarUrl: null, status: "active", primaryRole: "owner", jobRoleIds: [ownerOperator], locationIds: [gardenId, marketId], hiredOn: "2026-01-02", birthdayMonthDay: null, emergencyContact: { name: "Jordan Demo", relationship: "Friend", phone: "+1-212-555-0111" }, availability: alwaysAvailable, notes: "Synthetic owner profile for local development.", createdAt: "2026-01-02T10:00:00-05:00", updatedAt: "2026-07-25T09:00:00-04:00" },
    { id: maris, organizationId: orgId, authUserId: "auth-maris-demo", firstName: "Maris", lastName: "Demo", displayName: "Maris", preferredName: null, email: "maris@le-yard.example.invalid", phone: "+1-212-555-0112", pronouns: null, avatarUrl: null, status: "active", primaryRole: "owner", jobRoleIds: [ownerOperator], locationIds: [gardenId, marketId], hiredOn: "2026-01-02", birthdayMonthDay: null, emergencyContact: { name: "Taylor Demo", relationship: "Sibling", phone: "+1-212-555-0113" }, availability: alwaysAvailable, notes: "Synthetic owner profile for local development.", createdAt: "2026-01-02T10:10:00-05:00", updatedAt: "2026-07-25T09:00:00-04:00" },
    { id: irini, organizationId: orgId, authUserId: "auth-irini-demo", firstName: "Irini", lastName: "Topalli", displayName: "Irini T.", preferredName: "Irini", email: "irini.topalli@example.invalid", phone: "+1-212-555-0125", pronouns: null, avatarUrl: null, status: "active", primaryRole: "employee", jobRoleIds: [server], locationIds: [gardenId], hiredOn: "2026-08-05", birthdayMonthDay: null, emergencyContact: null, availability: eveningAvailability, notes: "Synthetic front-of-house employee profile for playground testing.", createdAt: "2026-08-05T12:00:00-04:00", updatedAt: "2026-08-05T12:10:00-04:00" },
    { id: aisha, organizationId: orgId, authUserId: "auth-aisha-demo", firstName: "Aisha", lastName: "Reed", displayName: "Aisha R.", preferredName: "Aisha", email: "aisha.reed@example.invalid", phone: "+1-212-555-0114", pronouns: "she/her", avatarUrl: null, status: "active", primaryRole: "manager", jobRoleIds: [floorManager, bartender], locationIds: [gardenId], hiredOn: "2026-02-03", birthdayMonthDay: "09-14", emergencyContact: { name: "Morgan Reed", relationship: "Partner", phone: "+1-212-555-0115" }, availability: alwaysAvailable, notes: null, createdAt: "2026-02-01T12:00:00-05:00", updatedAt: "2026-07-20T13:00:00-04:00" },
    { id: mateo, organizationId: orgId, authUserId: "auth-mateo-demo", firstName: "Mateo", lastName: "Chen", displayName: "Mateo C.", preferredName: "Teo", email: "mateo.chen@example.invalid", phone: "+1-212-555-0116", pronouns: "he/him", avatarUrl: null, status: "active", primaryRole: "manager", jobRoleIds: [floorManager, server], locationIds: [marketId], hiredOn: "2026-03-15", birthdayMonthDay: "04-21", emergencyContact: { name: "Riley Chen", relationship: "Sibling", phone: "+1-212-555-0117" }, availability: alwaysAvailable, notes: null, createdAt: "2026-03-11T10:00:00-04:00", updatedAt: "2026-07-20T13:00:00-04:00" },
    { id: imani, organizationId: orgId, authUserId: "auth-imani-demo", firstName: "Imani", lastName: "Brooks", displayName: "Imani B.", preferredName: null, email: "imani.brooks@example.invalid", phone: "+1-212-555-0118", pronouns: "they/them", avatarUrl: null, status: "active", primaryRole: "employee", jobRoleIds: [server], locationIds: [gardenId], hiredOn: "2026-04-06", birthdayMonthDay: null, emergencyContact: { name: "Casey Brooks", relationship: "Parent", phone: "+1-212-555-0119" }, availability: eveningAvailability, notes: null, createdAt: "2026-04-03T12:00:00-04:00", updatedAt: "2026-07-20T13:00:00-04:00" },
    { id: leo, organizationId: orgId, authUserId: "auth-leo-demo", firstName: "Leo", lastName: "Martinez", displayName: "Leo M.", preferredName: null, email: "leo.martinez@example.invalid", phone: "+1-212-555-0120", pronouns: "he/him", avatarUrl: null, status: "active", primaryRole: "employee", jobRoleIds: [lineCook, prepCook], locationIds: [gardenId, marketId], hiredOn: "2026-04-10", birthdayMonthDay: "11-03", emergencyContact: { name: "Alex Martinez", relationship: "Cousin", phone: "+1-212-555-0121" }, availability: alwaysAvailable, notes: null, createdAt: "2026-04-08T12:00:00-04:00", updatedAt: "2026-07-20T13:00:00-04:00" },
    { id: priya, organizationId: orgId, authUserId: "auth-priya-demo", firstName: "Priya", lastName: "Shah", displayName: "Priya S.", preferredName: null, email: "priya.shah@example.invalid", phone: "+1-212-555-0122", pronouns: "she/her", avatarUrl: null, status: "active", primaryRole: "employee", jobRoleIds: [bartender, server], locationIds: [marketId], hiredOn: "2026-05-05", birthdayMonthDay: null, emergencyContact: { name: "Avery Shah", relationship: "Friend", phone: "+1-212-555-0123" }, availability: eveningAvailability, notes: null, createdAt: "2026-05-02T12:00:00-04:00", updatedAt: "2026-07-20T13:00:00-04:00" },
    { id: sam, organizationId: orgId, authUserId: null, firstName: "Sam", lastName: "Okafor", displayName: "Sam O.", preferredName: null, email: "sam.okafor@example.invalid", phone: "+1-212-555-0124", pronouns: null, avatarUrl: null, status: "invited", primaryRole: "employee", jobRoleIds: [prepCook], locationIds: [marketId], hiredOn: "2026-08-05", birthdayMonthDay: null, emergencyContact: null, availability: alwaysAvailable, notes: "Invitation pending; no credential is stored in app data.", createdAt: "2026-07-31T09:30:00-04:00", updatedAt: "2026-07-31T09:30:00-04:00" },
  ],
  jobRoles: [
    { id: ownerOperator, organizationId: orgId, name: "Owner operator", code: "OWNER", department: "leadership", color: "#171717", clockEligible: true, tipEligible: false, active: true },
    { id: floorManager, organizationId: orgId, name: "Floor manager", code: "MGR", department: "leadership", color: "#4F46E5", clockEligible: true, tipEligible: false, active: true },
    { id: server, organizationId: orgId, name: "Server", code: "SRV", department: "front_of_house", color: "#0F766E", clockEligible: true, tipEligible: true, active: true },
    { id: bartender, organizationId: orgId, name: "Bartender", code: "BAR", department: "front_of_house", color: "#B45309", clockEligible: true, tipEligible: true, active: true },
    { id: lineCook, organizationId: orgId, name: "Line cook", code: "LINE", department: "back_of_house", color: "#BE123C", clockEligible: true, tipEligible: true, active: true },
    { id: prepCook, organizationId: orgId, name: "Prep cook", code: "PREP", department: "back_of_house", color: "#7C3AED", clockEligible: true, tipEligible: true, active: true },
  ],
  timeOffRequests: [
    { id: "timeoff-priya-aug", organizationId: orgId, personId: priya, kind: "personal", reason: "Personal appointment", startsOn: "2026-08-09", endsOn: "2026-08-09", status: "approved", reviewedBy: mateo, reviewedAt: "2026-07-30T14:00:00-04:00", createdAt: "2026-07-28T09:15:00-04:00", updatedAt: "2026-07-30T14:00:00-04:00" },
    { id: "timeoff-imani-aug", organizationId: orgId, personId: imani, kind: "vacation", reason: "Planned time away", startsOn: "2026-08-16", endsOn: "2026-08-18", status: "pending", reviewedBy: null, reviewedAt: null, createdAt: "2026-07-31T20:00:00-04:00", updatedAt: "2026-07-31T20:00:00-04:00" },
  ],
  certifications: [
    { id: "cert-aisha-food", organizationId: orgId, personId: aisha, name: "Food protection certificate — demo", issuer: "Example Training Authority", issuedOn: "2025-10-12", expiresOn: "2027-10-12", status: "current", documentId: "employee-doc-aisha-cert", createdAt: "2026-02-01T12:10:00-05:00", updatedAt: "2026-02-01T12:10:00-05:00" },
    { id: "cert-leo-food", organizationId: orgId, personId: leo, name: "Food handler certificate — demo", issuer: "Example Training Authority", issuedOn: "2025-08-25", expiresOn: "2026-08-25", status: "expiring", documentId: null, createdAt: "2026-04-08T12:10:00-04:00", updatedAt: "2026-07-25T09:00:00-04:00" },
  ],
  employeeDocuments: [
    { id: "employee-doc-aisha-cert", organizationId: orgId, personId: aisha, kind: "certification", title: "Food protection certificate — demo", file: privateFile("file-aisha-cert", "food-protection-demo.pdf", `${orgId}/people/${aisha}/food-protection-demo.pdf`, aisha, "2026-02-01T12:10:00-05:00"), visibility: "employee_and_management", acknowledgedAt: "2026-02-01T12:12:00-05:00", createdAt: "2026-02-01T12:10:00-05:00", updatedAt: "2026-02-01T12:12:00-05:00" },
    { id: "employee-doc-imani-handbook", organizationId: orgId, personId: imani, kind: "handbook", title: "Team handbook acknowledgement", file: privateFile("file-imani-handbook", "handbook-acknowledgement.pdf", `${orgId}/people/${imani}/handbook-acknowledgement.pdf`, imani, "2026-04-03T13:00:00-04:00"), visibility: "employee_and_management", acknowledgedAt: "2026-04-03T13:02:00-04:00", createdAt: "2026-04-03T13:00:00-04:00", updatedAt: "2026-04-03T13:02:00-04:00" },
  ],
  schedules: [
    { id: "schedule-garden-aug-1", organizationId: orgId, locationId: gardenId, name: "Garden Room · Jul 27–Aug 2", startsOn: "2026-07-27", endsOn: "2026-08-02", status: "published", templateId: "template-garden-dinner", publishedBy: aisha, publishedAt: "2026-07-24T15:00:00-04:00", createdAt: "2026-07-22T10:00:00-04:00", updatedAt: "2026-07-24T15:00:00-04:00" },
    { id: "schedule-market-aug-1", organizationId: orgId, locationId: marketId, name: "Market Room · Jul 27–Aug 2", startsOn: "2026-07-27", endsOn: "2026-08-02", status: "published", templateId: "template-market-dinner", publishedBy: mateo, publishedAt: "2026-07-24T16:00:00-04:00", createdAt: "2026-07-22T10:00:00-04:00", updatedAt: "2026-07-24T16:00:00-04:00" },
  ],
  scheduleTemplates: [
    { id: "template-garden-dinner", organizationId: orgId, locationId: gardenId, name: "Garden dinner core", description: "Baseline dinner staffing; demo only, not an operating policy.", active: true, entries: [{ weekday: 6, jobRoleId: floorManager, startsAtLocal: "14:00", endsAtLocal: "23:00", headcount: 1 }, { weekday: 6, jobRoleId: server, startsAtLocal: "16:00", endsAtLocal: "23:00", headcount: 2 }, { weekday: 6, jobRoleId: lineCook, startsAtLocal: "14:30", endsAtLocal: "23:30", headcount: 1 }], createdAt: "2026-05-01T09:00:00-04:00", updatedAt: "2026-07-15T09:00:00-04:00" },
    { id: "template-market-dinner", organizationId: orgId, locationId: marketId, name: "Market dinner core", description: "Baseline dinner staffing; demo only, not an operating policy.", active: true, entries: [{ weekday: 6, jobRoleId: floorManager, startsAtLocal: "14:00", endsAtLocal: "23:00", headcount: 1 }, { weekday: 6, jobRoleId: bartender, startsAtLocal: "16:00", endsAtLocal: "23:30", headcount: 1 }, { weekday: 6, jobRoleId: lineCook, startsAtLocal: "14:30", endsAtLocal: "23:30", headcount: 1 }], createdAt: "2026-05-01T09:00:00-04:00", updatedAt: "2026-07-15T09:00:00-04:00" },
  ],
  shifts: [
    { id: "shift-aisha-aug1", organizationId: orgId, locationId: gardenId, scheduleId: "schedule-garden-aug-1", personId: aisha, jobRoleId: floorManager, startsAt: "2026-08-01T14:00:00-04:00", endsAt: "2026-08-01T23:00:00-04:00", period: "close", status: "acknowledged", unpaidBreakMinutes: 30, note: "Manager close", acknowledgedAt: "2026-07-24T15:10:00-04:00", createdAt: "2026-07-22T10:05:00-04:00", updatedAt: "2026-07-24T15:10:00-04:00" },
    { id: "shift-imani-aug1", organizationId: orgId, locationId: gardenId, scheduleId: "schedule-garden-aug-1", personId: imani, jobRoleId: server, startsAt: "2026-08-01T16:00:00-04:00", endsAt: "2026-08-01T23:00:00-04:00", period: "close", status: "acknowledged", unpaidBreakMinutes: 30, note: null, acknowledgedAt: "2026-07-24T15:20:00-04:00", createdAt: "2026-07-22T10:06:00-04:00", updatedAt: "2026-07-24T15:20:00-04:00" },
    { id: "shift-irini-aug1", organizationId: orgId, locationId: gardenId, scheduleId: "schedule-garden-aug-1", personId: irini, jobRoleId: server, startsAt: "2026-08-01T16:00:00-04:00", endsAt: "2026-08-01T23:00:00-04:00", period: "close", status: "published", unpaidBreakMinutes: 30, note: "New hire playground shift", acknowledgedAt: null, createdAt: "2026-08-05T12:15:00-04:00", updatedAt: "2026-08-05T12:15:00-04:00" },
    { id: "shift-open-server-aug1", organizationId: orgId, locationId: gardenId, scheduleId: "schedule-garden-aug-1", personId: null, jobRoleId: server, startsAt: "2026-08-01T17:00:00-04:00", endsAt: "2026-08-01T22:30:00-04:00", period: "close", status: "open", unpaidBreakMinutes: 0, note: "Open shift", acknowledgedAt: null, createdAt: "2026-07-30T11:00:00-04:00", updatedAt: "2026-07-30T11:00:00-04:00" },
    { id: "shift-leo-aug1", organizationId: orgId, locationId: gardenId, scheduleId: "schedule-garden-aug-1", personId: leo, jobRoleId: lineCook, startsAt: "2026-08-01T14:30:00-04:00", endsAt: "2026-08-01T23:30:00-04:00", period: "close", status: "acknowledged", unpaidBreakMinutes: 30, note: null, acknowledgedAt: "2026-07-24T15:22:00-04:00", createdAt: "2026-07-22T10:07:00-04:00", updatedAt: "2026-07-24T15:22:00-04:00" },
    { id: "shift-mateo-aug1", organizationId: orgId, locationId: marketId, scheduleId: "schedule-market-aug-1", personId: mateo, jobRoleId: floorManager, startsAt: "2026-08-01T14:00:00-04:00", endsAt: "2026-08-01T23:00:00-04:00", period: "close", status: "acknowledged", unpaidBreakMinutes: 30, note: "Manager close", acknowledgedAt: "2026-07-24T16:10:00-04:00", createdAt: "2026-07-22T10:08:00-04:00", updatedAt: "2026-07-24T16:10:00-04:00" },
    { id: "shift-priya-aug1", organizationId: orgId, locationId: marketId, scheduleId: "schedule-market-aug-1", personId: priya, jobRoleId: bartender, startsAt: "2026-08-01T16:00:00-04:00", endsAt: "2026-08-01T23:30:00-04:00", period: "close", status: "published", unpaidBreakMinutes: 30, note: null, acknowledgedAt: null, createdAt: "2026-07-22T10:09:00-04:00", updatedAt: "2026-07-24T16:00:00-04:00" },
  ],
  shiftSwaps: [
    { id: "swap-imani-aug2", organizationId: orgId, locationId: gardenId, shiftId: "shift-imani-aug1", requestedBy: imani, offeredTo: null, acceptedBy: null, reason: "Looking for coverage if available", status: "open", reviewedBy: null, createdAt: "2026-07-31T18:00:00-04:00", updatedAt: "2026-07-31T18:00:00-04:00" },
  ],
  chatChannels: [
    { id: "channel-all-staff", organizationId: orgId, locationId: null, name: "All staff", kind: "all_staff", visibility: "all_members", participantIds: [], lastMessageAt: "2026-08-01T12:20:00-04:00", createdAt: "2026-01-02T11:00:00-05:00", updatedAt: "2026-08-01T12:20:00-04:00" },
    { id: "channel-garden", organizationId: orgId, locationId: gardenId, name: "Garden Room", kind: "location", visibility: "location_members", participantIds: [], lastMessageAt: "2026-08-01T13:05:00-04:00", createdAt: "2026-01-02T11:01:00-05:00", updatedAt: "2026-08-01T13:05:00-04:00" },
    { id: "channel-market", organizationId: orgId, locationId: marketId, name: "Market Room", kind: "location", visibility: "location_members", participantIds: [], lastMessageAt: "2026-08-01T12:48:00-04:00", createdAt: "2026-03-10T11:01:00-05:00", updatedAt: "2026-08-01T12:48:00-04:00" },
    { id: "channel-management", organizationId: orgId, locationId: null, name: "Management", kind: "management", visibility: "management", participantIds: [donald, maris, aisha, mateo], lastMessageAt: "2026-08-01T11:30:00-04:00", createdAt: "2026-01-02T11:02:00-05:00", updatedAt: "2026-08-01T11:30:00-04:00" },
  ],
  chatMessages: [
    { id: "message-all-1", organizationId: orgId, channelId: "channel-all-staff", authorId: maris, body: "Happy Saturday. Please acknowledge the updated closing checklist before service.", attachmentIds: [], reactions: [{ emoji: "👍", personIds: [aisha, mateo, imani] }], readBy: [{ personId: donald, readAt: "2026-08-01T12:03:00-04:00" }, { personId: aisha, readAt: "2026-08-01T12:05:00-04:00" }, { personId: mateo, readAt: "2026-08-01T12:07:00-04:00" }], editedAt: null, createdAt: "2026-08-01T12:00:00-04:00", updatedAt: "2026-08-01T12:00:00-04:00" },
    { id: "message-all-2", organizationId: orgId, channelId: "channel-all-staff", authorId: imani, body: "Acknowledged — see everyone tonight.", attachmentIds: [], reactions: [], readBy: [{ personId: maris, readAt: "2026-08-01T12:21:00-04:00" }], editedAt: null, createdAt: "2026-08-01T12:20:00-04:00", updatedAt: "2026-08-01T12:20:00-04:00" },
    { id: "message-garden-1", organizationId: orgId, channelId: "channel-garden", authorId: aisha, body: "The patio station is reset and ready for lineup.", attachmentIds: [], reactions: [{ emoji: "✨", personIds: [imani] }], readBy: [{ personId: imani, readAt: "2026-08-01T13:08:00-04:00" }], editedAt: null, createdAt: "2026-08-01T13:05:00-04:00", updatedAt: "2026-08-01T13:05:00-04:00" },
    { id: "message-management-1", organizationId: orgId, channelId: "channel-management", authorId: donald, body: "Please review the flagged produce invoice before close.", attachmentIds: ["file-receipt-produce"], reactions: [], readBy: [{ personId: maris, readAt: "2026-08-01T11:31:00-04:00" }, { personId: aisha, readAt: "2026-08-01T11:34:00-04:00" }], editedAt: null, createdAt: "2026-08-01T11:30:00-04:00", updatedAt: "2026-08-01T11:30:00-04:00" },
  ],
  announcements: [
    { id: "announcement-checklist", organizationId: orgId, locationIds: [gardenId, marketId], authorId: maris, title: "Closing checklist refresh", body: "The closing checklist now includes refrigerator temperature verification. This demo does not prescribe a compliance policy.", priority: "important", publishedAt: "2026-07-31T16:00:00-04:00", expiresAt: "2026-08-08T00:00:00-04:00", acknowledgedBy: [{ personId: aisha, acknowledgedAt: "2026-07-31T16:20:00-04:00" }, { personId: mateo, acknowledgedAt: "2026-07-31T16:32:00-04:00" }], createdAt: "2026-07-31T15:50:00-04:00", updatedAt: "2026-07-31T16:32:00-04:00" },
  ],
  timecards: [
    { id: "timecard-aisha-aug1", organizationId: orgId, locationId: gardenId, personId: aisha, shiftId: "shift-aisha-aug1", jobRoleId: floorManager, clockedInAt: "2026-08-01T13:56:00-04:00", clockedOutAt: null, breaks: [], regularMinutes: 34, overtimeMinutes: 0, status: "open", source: "kiosk", createdAt: "2026-08-01T13:56:00-04:00", updatedAt: "2026-08-01T13:56:00-04:00" },
    { id: "timecard-leo-jul31", organizationId: orgId, locationId: gardenId, personId: leo, shiftId: null, jobRoleId: lineCook, clockedInAt: "2026-07-31T14:28:00-04:00", clockedOutAt: "2026-07-31T23:11:00-04:00", breaks: [{ id: "break-leo-jul31", kind: "unpaid", startsAt: "2026-07-31T18:00:00-04:00", endsAt: "2026-07-31T18:30:00-04:00" }], regularMinutes: 493, overtimeMinutes: 0, status: "correction_pending", source: "kiosk", createdAt: "2026-07-31T14:28:00-04:00", updatedAt: "2026-08-01T09:10:00-04:00" },
    { id: "timecard-priya-jul31", organizationId: orgId, locationId: marketId, personId: priya, shiftId: null, jobRoleId: bartender, clockedInAt: "2026-07-31T16:02:00-04:00", clockedOutAt: "2026-07-31T23:34:00-04:00", breaks: [{ id: "break-priya-jul31", kind: "unpaid", startsAt: "2026-07-31T19:12:00-04:00", endsAt: "2026-07-31T19:42:00-04:00" }], regularMinutes: 422, overtimeMinutes: 0, status: "approved", source: "kiosk", createdAt: "2026-07-31T16:02:00-04:00", updatedAt: "2026-08-01T10:00:00-04:00" },
  ],
  timecardCorrections: [
    { id: "correction-leo-jul31", organizationId: orgId, locationId: gardenId, timecardId: "timecard-leo-jul31", requestedBy: leo, requestedClockInAt: null, requestedClockOutAt: "2026-07-31T23:26:00-04:00", reason: "Forgot to clock out after finishing the station handoff.", status: "pending", reviewedBy: null, reviewedAt: null, createdAt: "2026-08-01T09:10:00-04:00", updatedAt: "2026-08-01T09:10:00-04:00" },
  ],
  closeouts: [
    { id: "closeout-garden-jul31", organizationId: orgId, locationId: gardenId, businessDate: "2026-07-31", preparedBy: aisha, approvedBy: maris, approvedAt: "2026-08-01T10:15:00-04:00", status: "approved", covers: 94, grossSalesCents: 1_128_400, netSalesCents: 1_081_200, cashSalesCents: 178_500, cardSalesCents: 902_700, compsCents: 31_200, voidsCents: 16_000, expectedCashCents: 181_500, actualCashCents: 181_200, cashVarianceCents: -300, notes: "Synthetic closeout; small cash variance reviewed.", attachmentIds: [], createdAt: "2026-08-01T00:10:00-04:00", updatedAt: "2026-08-01T10:15:00-04:00" },
    { id: "closeout-market-jul31", organizationId: orgId, locationId: marketId, businessDate: "2026-07-31", preparedBy: mateo, approvedBy: null, approvedAt: null, status: "submitted", covers: 71, grossSalesCents: 842_900, netSalesCents: 815_400, cashSalesCents: 102_000, cardSalesCents: 713_400, compsCents: 18_500, voidsCents: 9_000, expectedCashCents: 104_000, actualCashCents: 104_000, cashVarianceCents: 0, notes: "Ready for owner approval.", attachmentIds: [], createdAt: "2026-08-01T00:25:00-04:00", updatedAt: "2026-08-01T00:25:00-04:00" },
  ],
  tipPoolRules: [
    { id: "tip-rule-demo-v1", organizationId: orgId, name: "Demo weighted dinner pool", version: 1, effectiveFrom: "2026-07-01", effectiveTo: null, method: "weighted_points", eligibleJobRoleIds: [server, bartender, lineCook, prepCook], roleWeights: { [server]: 1, [bartender]: 1.1, [lineCook]: 0.7, [prepCook]: 0.65 }, serviceChargeIncluded: false, status: "active", createdAt: "2026-06-20T10:00:00-04:00", updatedAt: "2026-06-28T10:00:00-04:00" },
  ],
  tipPoolRuns: [
    { id: "tip-run-garden-jul31", organizationId: orgId, locationId: gardenId, ruleId: "tip-rule-demo-v1", businessDate: "2026-07-31", cashTipsCents: 18_600, cardTipsCents: 182_400, serviceChargesCents: 30_000, adjustmentsCents: 0, distributableCents: 201_000, status: "locked", approvedBy: donald, approvedAt: "2026-08-01T10:30:00-04:00", explanation: "Cash and card tips only; service charges remain separate. Allocations use eligible minutes × role weight with deterministic cent rounding.", allocations: [{ personId: imani, eligibleMinutes: 390, weight: 1, adjustmentCents: 0, allocatedCents: 69_300, excludedReason: null }, { personId: leo, eligibleMinutes: 493, weight: 0.7, adjustmentCents: 0, allocatedCents: 61_343, excludedReason: null }, { personId: aisha, eligibleMinutes: 480, weight: 0, adjustmentCents: 0, allocatedCents: 0, excludedReason: "Manager role is not eligible in this demo rule." }, { personId: priya, eligibleMinutes: 360, weight: 1.1, adjustmentCents: 0, allocatedCents: 70_357, excludedReason: null }], createdAt: "2026-08-01T09:30:00-04:00", updatedAt: "2026-08-01T10:30:00-04:00" },
  ],
  receipts: [
    { id: "receipt-produce-jul31", organizationId: orgId, locationId: gardenId, kind: "invoice", vendorId: "vendor-harbor-produce", purchaseOrderId: "po-garden-1042", expenseCategory: "food_and_beverage", documentNumber: "DEMO-INV-1042", documentDate: "2026-07-31", dueDate: "2026-08-30", subtotalCents: 54_120, taxCents: 0, totalCents: 54_120, currency: "USD", file: privateFile("file-receipt-produce", "demo-produce-invoice.pdf", `${orgId}/receipts/2026/07/demo-produce-invoice.pdf`, aisha, "2026-07-31T10:40:00-04:00", "application/pdf", 264_200), ocrText: "DEMO INVOICE Harbor Produce vegetables herbs total 541.20", extractionConfidence: 0.91, reviewStatus: "needs_review", duplicateOfId: null, reviewedBy: null, createdAt: "2026-07-31T10:40:00-04:00", updatedAt: "2026-07-31T10:41:00-04:00" },
    { id: "receipt-linen-jul30", organizationId: orgId, locationId: marketId, kind: "receipt", vendorId: "vendor-clear-linen", purchaseOrderId: null, expenseCategory: "operating_supplies", documentNumber: "DEMO-RCPT-883", documentDate: "2026-07-30", dueDate: null, subtotalCents: 18_800, taxCents: 1_669, totalCents: 20_469, currency: "USD", file: privateFile("file-receipt-linen", "demo-linen-receipt.jpg", `${orgId}/receipts/2026/07/demo-linen-receipt.jpg`, mateo, "2026-07-30T15:12:00-04:00", "image/jpeg", 1_820_000), ocrText: "DEMO RECEIPT Clear Linen subtotal 188.00 tax 16.69 total 204.69", extractionConfidence: 0.98, reviewStatus: "verified", duplicateOfId: null, reviewedBy: maris, createdAt: "2026-07-30T15:12:00-04:00", updatedAt: "2026-07-30T16:00:00-04:00" },
  ],
  inventoryItems: [
    { id: "item-tomatoes", organizationId: orgId, name: "Roma tomatoes", sku: "PROD-TOM-ROMA", category: "produce", baseUnit: "pound", purchaseUnit: "case", conversions: [{ from: "case", to: "pound", multiplier: 25 }], locationSettings: [{ locationId: gardenId, parLevel: 30, reorderPoint: 12, active: true }, { locationId: marketId, parLevel: 22, reorderPoint: 10, active: true }], preferredVendorId: "vendor-harbor-produce", lastUnitCostCents: 189, createdAt: "2026-03-01T09:00:00-05:00", updatedAt: "2026-07-31T11:00:00-04:00" },
    { id: "item-basil", organizationId: orgId, name: "Fresh basil", sku: "PROD-BASIL", category: "produce", baseUnit: "ounce", purchaseUnit: "case", conversions: [{ from: "case", to: "ounce", multiplier: 32 }], locationSettings: [{ locationId: gardenId, parLevel: 48, reorderPoint: 16, active: true }, { locationId: marketId, parLevel: 32, reorderPoint: 12, active: true }], preferredVendorId: "vendor-harbor-produce", lastUnitCostCents: 78, createdAt: "2026-03-01T09:00:00-05:00", updatedAt: "2026-07-31T11:00:00-04:00" },
    { id: "item-flour", organizationId: orgId, name: "Bread flour", sku: "DRY-FLOUR-BREAD", category: "dry_goods", baseUnit: "pound", purchaseUnit: "case", conversions: [{ from: "case", to: "pound", multiplier: 50 }], locationSettings: [{ locationId: gardenId, parLevel: 100, reorderPoint: 35, active: true }, { locationId: marketId, parLevel: 80, reorderPoint: 30, active: true }], preferredVendorId: "vendor-northstar-foods", lastUnitCostCents: 64, createdAt: "2026-03-01T09:00:00-05:00", updatedAt: "2026-07-29T11:00:00-04:00" },
    { id: "item-olive-oil", organizationId: orgId, name: "Extra virgin olive oil", sku: "PANTRY-EVOO", category: "pantry", baseUnit: "liter", purchaseUnit: "case", conversions: [{ from: "case", to: "liter", multiplier: 12 }], locationSettings: [{ locationId: gardenId, parLevel: 18, reorderPoint: 6, active: true }, { locationId: marketId, parLevel: 16, reorderPoint: 5, active: true }], preferredVendorId: "vendor-northstar-foods", lastUnitCostCents: 1_245, createdAt: "2026-03-01T09:00:00-05:00", updatedAt: "2026-07-29T11:00:00-04:00" },
  ],
  vendors: [
    { id: "vendor-harbor-produce", organizationId: orgId, name: "Harbor Produce — Demo", contactName: "Jamie Example", email: "orders@harbor-produce.example.invalid", phone: "+1-212-555-0130", accountNumberMasked: "••••1042", paymentTerms: "Net 30 — demo", active: true, createdAt: "2026-02-10T09:00:00-05:00", updatedAt: "2026-07-20T09:00:00-04:00" },
    { id: "vendor-northstar-foods", organizationId: orgId, name: "Northstar Foods — Demo", contactName: "Robin Example", email: "service@northstar-foods.example.invalid", phone: "+1-212-555-0131", accountNumberMasked: "••••2031", paymentTerms: "Net 15 — demo", active: true, createdAt: "2026-02-10T09:00:00-05:00", updatedAt: "2026-07-20T09:00:00-04:00" },
    { id: "vendor-clear-linen", organizationId: orgId, name: "Clear Linen — Demo", contactName: "Quinn Example", email: "dispatch@clear-linen.example.invalid", phone: "+1-212-555-0132", accountNumberMasked: "••••4418", paymentTerms: "Due on receipt — demo", active: true, createdAt: "2026-02-10T09:00:00-05:00", updatedAt: "2026-07-20T09:00:00-04:00" },
  ],
  purchaseOrders: [
    { id: "po-garden-1042", organizationId: orgId, locationId: gardenId, vendorId: "vendor-harbor-produce", orderNumber: "PO-DEMO-1042", orderedBy: aisha, orderedAt: "2026-07-29T09:00:00-04:00", expectedOn: "2026-07-31", status: "received", lines: [{ id: "po-line-tomatoes", itemId: "item-tomatoes", orderedQuantity: 4, receivedQuantity: 4, unit: "case", unitCostCents: 4_725 }, { id: "po-line-basil", itemId: "item-basil", orderedQuantity: 6, receivedQuantity: 6, unit: "case", unitCostCents: 2_496 }], totalCents: 33_876, createdAt: "2026-07-29T08:50:00-04:00", updatedAt: "2026-07-31T10:35:00-04:00" },
    { id: "po-market-2077", organizationId: orgId, locationId: marketId, vendorId: "vendor-northstar-foods", orderNumber: "PO-DEMO-2077", orderedBy: mateo, orderedAt: "2026-07-31T08:30:00-04:00", expectedOn: "2026-08-02", status: "submitted", lines: [{ id: "po-line-flour", itemId: "item-flour", orderedQuantity: 3, receivedQuantity: 0, unit: "case", unitCostCents: 3_200 }, { id: "po-line-oil", itemId: "item-olive-oil", orderedQuantity: 2, receivedQuantity: 0, unit: "case", unitCostCents: 14_940 }], totalCents: 39_480, createdAt: "2026-07-31T08:25:00-04:00", updatedAt: "2026-07-31T08:30:00-04:00" },
  ],
  deliveries: [
    { id: "delivery-garden-1042", organizationId: orgId, locationId: gardenId, purchaseOrderId: "po-garden-1042", vendorId: "vendor-harbor-produce", receivedBy: aisha, receivedAt: "2026-07-31T10:35:00-04:00", status: "complete", temperatureNote: "Condition accepted; synthetic demo record.", attachmentIds: ["file-receipt-produce"], createdAt: "2026-07-31T10:35:00-04:00", updatedAt: "2026-07-31T10:35:00-04:00" },
  ],
  inventoryCounts: [
    { id: "count-garden-jul31", organizationId: orgId, locationId: gardenId, countedBy: leo, businessDate: "2026-07-31", status: "submitted", lines: [{ itemId: "item-tomatoes", expectedQuantity: 24, countedQuantity: 21.5, unit: "pound", varianceQuantity: -2.5, varianceValueCents: -473 }, { itemId: "item-basil", expectedQuantity: 20, countedQuantity: 18, unit: "ounce", varianceQuantity: -2, varianceValueCents: -156 }, { itemId: "item-flour", expectedQuantity: 44, countedQuantity: 44, unit: "pound", varianceQuantity: 0, varianceValueCents: 0 }], approvedBy: null, createdAt: "2026-08-01T00:02:00-04:00", updatedAt: "2026-08-01T00:18:00-04:00" },
    { id: "count-market-jul31", organizationId: orgId, locationId: marketId, countedBy: priya, businessDate: "2026-07-31", status: "approved", lines: [{ itemId: "item-tomatoes", expectedQuantity: 17, countedQuantity: 17, unit: "pound", varianceQuantity: 0, varianceValueCents: 0 }, { itemId: "item-olive-oil", expectedQuantity: 5, countedQuantity: 4, unit: "liter", varianceQuantity: -1, varianceValueCents: -1_245 }], approvedBy: mateo, createdAt: "2026-08-01T00:12:00-04:00", updatedAt: "2026-08-01T09:00:00-04:00" },
  ],
  wasteRecords: [
    { id: "waste-basil-jul31", organizationId: orgId, locationId: gardenId, itemId: "item-basil", quantity: 3, unit: "ounce", valueCents: 234, reason: "spoilage", recordedBy: leo, occurredAt: "2026-07-31T14:40:00-04:00", note: "Wilted at receiving review.", createdAt: "2026-07-31T14:45:00-04:00", updatedAt: "2026-07-31T14:45:00-04:00" },
  ],
  inventoryTransfers: [
    { id: "transfer-flour-jul30", organizationId: orgId, fromLocationId: gardenId, toLocationId: marketId, itemId: "item-flour", quantity: 10, unit: "pound", status: "received", requestedBy: mateo, receivedBy: priya, createdAt: "2026-07-30T10:00:00-04:00", updatedAt: "2026-07-30T13:15:00-04:00" },
  ],
  inventoryPrices: [
    { id: "price-tomatoes-jun", organizationId: orgId, vendorId: "vendor-harbor-produce", itemId: "item-tomatoes", unit: "pound", unitCostCents: 174, effectiveOn: "2026-06-20", sourceReceiptId: null, createdAt: "2026-06-20T11:00:00-04:00", updatedAt: "2026-06-20T11:00:00-04:00" },
    { id: "price-tomatoes-jul", organizationId: orgId, vendorId: "vendor-harbor-produce", itemId: "item-tomatoes", unit: "pound", unitCostCents: 189, effectiveOn: "2026-07-31", sourceReceiptId: "receipt-produce-jul31", createdAt: "2026-07-31T10:41:00-04:00", updatedAt: "2026-07-31T10:41:00-04:00" },
  ],
  recipes: [
    { id: "recipe-tomato-toast", organizationId: orgId, name: "Tomato toast — demo", menuCode: "DEMO-TT", yieldQuantity: 1, yieldUnit: "each", ingredients: [{ itemId: "item-tomatoes", quantity: 0.4, unit: "pound", costCents: 76 }, { itemId: "item-basil", quantity: 0.25, unit: "ounce", costCents: 20 }, { itemId: "item-flour", quantity: 0.3, unit: "pound", costCents: 19 }, { itemId: "item-olive-oil", quantity: 0.02, unit: "liter", costCents: 25 }], totalCostCents: 140, costPerYieldCents: 140, menuPriceCents: 1_400, foodCostPercentage: 10, createdAt: "2026-06-01T10:00:00-04:00", updatedAt: "2026-07-31T11:00:00-04:00" },
  ],
  guests: [
    { id: "guest-nora-demo", organizationId: orgId, firstName: "Nora", lastName: "Example", contact: { email: "nora@example.invalid", phone: "+1-212-555-0140", preferredChannel: "email" }, birthdayMonthDay: "08-18", preferences: ["window table", "sparkling water"], allergies: ["tree nuts"], tags: ["regular", "anniversary"], vip: true, notes: "Synthetic guest record. Confirm allergy verbally at every visit.", lifetimeSpendCents: 146_800, visitCount: 12, lastVisitAt: "2026-07-26T19:00:00-04:00", mergedIntoId: null, createdAt: "2026-02-14T18:00:00-05:00", updatedAt: "2026-07-26T22:00:00-04:00" },
    { id: "guest-eli-demo", organizationId: orgId, firstName: "Eli", lastName: "Sample", contact: { email: "eli.sample@example.invalid", phone: "+1-212-555-0141", preferredChannel: "sms" }, birthdayMonthDay: null, preferences: ["bar seating"], allergies: [], tags: ["neighborhood"], vip: false, notes: "Synthetic guest record.", lifetimeSpendCents: 39_500, visitCount: 4, lastVisitAt: "2026-07-31T18:30:00-04:00", mergedIntoId: null, createdAt: "2026-05-20T17:00:00-04:00", updatedAt: "2026-07-31T21:00:00-04:00" },
    { id: "guest-eli-duplicate-demo", organizationId: orgId, firstName: "Eli", lastName: "Sample", contact: { email: "e.sample@example.invalid", phone: "+1-212-555-0141", preferredChannel: "none" }, birthdayMonthDay: null, preferences: [], allergies: [], tags: [], vip: false, notes: "Potential synthetic duplicate awaiting review.", lifetimeSpendCents: 8_200, visitCount: 1, lastVisitAt: "2026-07-12T20:00:00-04:00", mergedIntoId: null, createdAt: "2026-07-12T18:00:00-04:00", updatedAt: "2026-07-12T22:00:00-04:00" },
  ],
  guestVisits: [
    { id: "visit-nora-jul26", organizationId: orgId, locationId: gardenId, guestId: "guest-nora-demo", reservationId: "reservation-nora-jul26", visitedAt: "2026-07-26T19:00:00-04:00", partySize: 2, spendCents: 18_600, serverPersonId: imani, source: "resy", notes: "Anniversary dinner; synthetic record.", createdAt: "2026-07-26T18:55:00-04:00", updatedAt: "2026-07-26T22:00:00-04:00" },
    { id: "visit-eli-jul31", organizationId: orgId, locationId: marketId, guestId: "guest-eli-demo", reservationId: null, visitedAt: "2026-07-31T18:30:00-04:00", partySize: 1, spendCents: 9_800, serverPersonId: priya, source: "walk_in", notes: "Bar seat; synthetic record.", createdAt: "2026-07-31T18:30:00-04:00", updatedAt: "2026-07-31T21:00:00-04:00" },
  ],
  reservations: [
    { id: "reservation-nora-jul26", organizationId: orgId, locationId: gardenId, guestId: "guest-nora-demo", externalId: "resy-demo-1001", startsAt: "2026-07-26T19:00:00-04:00", partySize: 2, status: "completed", source: "resy", tableLabel: "G-12", notes: "Synthetic imported reservation.", createdAt: "2026-07-10T11:00:00-04:00", updatedAt: "2026-07-26T22:00:00-04:00" },
    { id: "reservation-nora-aug8", organizationId: orgId, locationId: marketId, guestId: "guest-nora-demo", externalId: null, startsAt: "2026-08-08T19:30:00-04:00", partySize: 4, status: "booked", source: "phone", tableLabel: null, notes: "Birthday visit; allergy flag visible to authorized staff.", createdAt: "2026-07-31T13:00:00-04:00", updatedAt: "2026-07-31T13:00:00-04:00" },
  ],
  consentRecords: [
    { id: "consent-nora-email", organizationId: orgId, guestId: "guest-nora-demo", channel: "email", status: "granted", capturedAt: "2026-02-14T18:00:00-05:00", source: "reservation_form_demo", createdAt: "2026-02-14T18:00:00-05:00", updatedAt: "2026-02-14T18:00:00-05:00" },
    { id: "consent-eli-sms", organizationId: orgId, guestId: "guest-eli-demo", channel: "sms", status: "withdrawn", capturedAt: "2026-07-31T21:05:00-04:00", source: "guest_request_demo", createdAt: "2026-05-20T17:00:00-04:00", updatedAt: "2026-07-31T21:05:00-04:00" },
  ],
  duplicateGuestCandidates: [
    { id: "duplicate-eli-demo", organizationId: orgId, guestId: "guest-eli-demo", possibleDuplicateId: "guest-eli-duplicate-demo", confidence: 0.96, reasons: ["Matching phone number", "Matching first and last name"], status: "open", reviewedBy: null, createdAt: "2026-07-31T22:05:00-04:00", updatedAt: "2026-07-31T22:05:00-04:00" },
  ],
  tasks: [
    { id: "task-check-patio", organizationId: orgId, locationId: gardenId, title: "Reset patio service station", description: "Restock service items and confirm the station is ready for lineup.", category: "opening", priority: "high", assignedTo: imani, assignedRole: null, dueAt: "2026-08-01T15:30:00-04:00", status: "in_progress", completedBy: null, completedAt: null, createdAt: "2026-07-31T20:00:00-04:00", updatedAt: "2026-08-01T13:10:00-04:00" },
    { id: "task-review-invoice", organizationId: orgId, locationId: gardenId, title: "Review produce invoice extraction", description: "Check the OCR total and link each line to the received purchase order.", category: "operations", priority: "high", assignedTo: aisha, assignedRole: null, dueAt: "2026-08-01T18:00:00-04:00", status: "todo", completedBy: null, completedAt: null, createdAt: "2026-07-31T10:42:00-04:00", updatedAt: "2026-07-31T10:42:00-04:00" },
    { id: "task-market-filter", organizationId: orgId, locationId: marketId, title: "Confirm ice machine service window", description: "Coordinate a demo service window; no vendor appointment has been made.", category: "maintenance", priority: "normal", assignedTo: mateo, assignedRole: null, dueAt: "2026-08-03T12:00:00-04:00", status: "todo", completedBy: null, completedAt: null, createdAt: "2026-08-01T09:00:00-04:00", updatedAt: "2026-08-01T09:00:00-04:00" },
    { id: "task-handbook", organizationId: orgId, locationId: null, title: "Acknowledge closing checklist update", description: "Read and acknowledge SOP version 3.", category: "training", priority: "normal", assignedTo: null, assignedRole: "employee", dueAt: "2026-08-05T17:00:00-04:00", status: "todo", completedBy: null, completedAt: null, createdAt: "2026-07-31T16:00:00-04:00", updatedAt: "2026-07-31T16:00:00-04:00" },
  ],
  checklists: [
    { id: "checklist-garden-opening", organizationId: orgId, locationId: gardenId, name: "Garden opening", kind: "opening", items: [{ id: "check-open-1", label: "Complete dining room walkthrough", required: true, sopId: "sop-opening-demo" }, { id: "check-open-2", label: "Confirm service stations are stocked", required: true, sopId: "sop-opening-demo" }, { id: "check-open-3", label: "Review reservations and allergy notes", required: true, sopId: null }], active: true, createdAt: "2026-05-01T09:00:00-04:00", updatedAt: "2026-07-31T15:45:00-04:00" },
    { id: "checklist-market-closing", organizationId: orgId, locationId: marketId, name: "Market closing", kind: "closing", items: [{ id: "check-close-1", label: "Reconcile closeout", required: true, sopId: "sop-closing-demo" }, { id: "check-close-2", label: "Record refrigerator temperature", required: true, sopId: "sop-closing-demo" }, { id: "check-close-3", label: "Arm entry system", required: true, sopId: null }], active: true, createdAt: "2026-05-01T09:00:00-04:00", updatedAt: "2026-07-31T15:45:00-04:00" },
  ],
  checklistRuns: [
    { id: "checklist-run-garden-aug1", organizationId: orgId, locationId: gardenId, checklistId: "checklist-garden-opening", businessDate: "2026-08-01", completedItems: [{ itemId: "check-open-1", completedBy: aisha, completedAt: "2026-08-01T14:12:00-04:00", note: null }, { itemId: "check-open-2", completedBy: imani, completedAt: "2026-08-01T14:25:00-04:00", note: "Patio station finishing next." }], status: "in_progress", approvedBy: null, createdAt: "2026-08-01T14:00:00-04:00", updatedAt: "2026-08-01T14:25:00-04:00" },
  ],
  sopDocuments: [
    { id: "sop-opening-demo", organizationId: orgId, title: "Opening service readiness — demo", category: "service", version: 2, body: "Illustrative checklist instructions for development. Owners must replace this with approved operating procedures.", status: "published", publishedAt: "2026-07-15T10:00:00-04:00", ownerId: maris, locationIds: [gardenId, marketId], acknowledgements: [{ personId: aisha, version: 2, acknowledgedAt: "2026-07-15T10:20:00-04:00" }, { personId: mateo, version: 2, acknowledgedAt: "2026-07-15T10:22:00-04:00" }], createdAt: "2026-05-01T09:00:00-04:00", updatedAt: "2026-07-15T10:22:00-04:00" },
    { id: "sop-closing-demo", organizationId: orgId, title: "Closing controls — demo", category: "closing", version: 3, body: "Illustrative closing workflow for development. Temperature, cash, and security policies require owner approval before production use.", status: "published", publishedAt: "2026-07-31T16:00:00-04:00", ownerId: donald, locationIds: [gardenId, marketId], acknowledgements: [{ personId: aisha, version: 3, acknowledgedAt: "2026-07-31T16:20:00-04:00" }, { personId: mateo, version: 3, acknowledgedAt: "2026-07-31T16:32:00-04:00" }], createdAt: "2026-05-01T09:00:00-04:00", updatedAt: "2026-07-31T16:32:00-04:00" },
  ],
  maintenanceRequests: [
    { id: "maintenance-ice-machine", organizationId: orgId, locationId: marketId, title: "Ice machine filter alert", description: "Indicator is illuminated; inspect and schedule qualified service if needed.", asset: "Ice machine — demo asset", priority: "normal", reportedBy: priya, assignedTo: mateo, status: "reported", resolvedAt: null, createdAt: "2026-08-01T08:50:00-04:00", updatedAt: "2026-08-01T09:00:00-04:00" },
  ],
  incidents: [
    { id: "incident-glassware-jul29", organizationId: orgId, locationId: gardenId, kind: "safety", occurredAt: "2026-07-29T21:15:00-04:00", reportedBy: imani, summary: "Glassware broke near service station", details: "Area was isolated and cleared. This synthetic entry is for workflow demonstration only.", involvedPersonIds: [], witnessNames: [], status: "closed", reviewedBy: aisha, attachmentIds: [], createdAt: "2026-07-29T21:25:00-04:00", updatedAt: "2026-07-30T09:00:00-04:00" },
  ],
  savedReports: [
    { id: "report-labor-weekly", organizationId: orgId, name: "Weekly labor pulse", kind: "labor", ownerId: donald, locationIds: [gardenId, marketId], filters: { startsOn: "2026-07-27", endsOn: "2026-08-02", groupBy: "location" }, columns: ["location", "scheduled_hours", "worked_hours", "overtime_hours", "labor_cost_cents"], supportedExports: ["csv", "pdf"], lastRunAt: "2026-08-01T08:00:00-04:00", schedule: "weekly", createdAt: "2026-06-01T09:00:00-04:00", updatedAt: "2026-08-01T08:00:00-04:00" },
    { id: "report-inventory-variance", organizationId: orgId, name: "Inventory variance", kind: "inventory_variance", ownerId: maris, locationIds: [gardenId, marketId], filters: { startsOn: "2026-07-01", endsOn: "2026-07-31", category: ["produce", "pantry"] }, columns: ["item", "expected_quantity", "counted_quantity", "variance_value_cents"], supportedExports: ["csv", "pdf"], lastRunAt: "2026-08-01T09:00:00-04:00", schedule: "monthly", createdAt: "2026-06-01T09:00:00-04:00", updatedAt: "2026-08-01T09:00:00-04:00" },
    { id: "report-guest-activity", organizationId: orgId, name: "Guest activity", kind: "guest_activity", ownerId: maris, locationIds: [gardenId, marketId], filters: { startsOn: "2026-07-01", endsOn: "2026-07-31", segment: "all" }, columns: ["guest", "visits", "spend_cents", "last_visit"], supportedExports: ["csv", "pdf"], lastRunAt: null, schedule: "none", createdAt: "2026-07-20T09:00:00-04:00", updatedAt: "2026-07-20T09:00:00-04:00" },
  ],
  reportSnapshots: [
    { id: "snapshot-labor-aug1", organizationId: orgId, reportId: "report-labor-weekly", generatedBy: donald, generatedAt: "2026-08-01T08:00:00-04:00", locationIds: [gardenId, marketId], summary: "Worked hours are tracking near the published schedule; one punch correction remains open.", metrics: [{ key: "worked_hours", label: "Worked hours", value: 238.4, unit: "hours" }, { key: "scheduled_hours", label: "Scheduled hours", value: 244, unit: "hours" }, { key: "overtime_hours", label: "Overtime", value: 2.1, unit: "hours" }, { key: "schedule_variance", label: "Schedule variance", value: -2.3, unit: "percentage" }], exportFileIds: ["file-report-labor-csv", "file-report-labor-pdf"], createdAt: "2026-08-01T08:00:00-04:00", updatedAt: "2026-08-01T08:00:00-04:00" },
  ],
  integrationConnections: [
    { id: "integration-toast-demo", organizationId: orgId, locationIds: [gardenId, marketId], provider: "toast", mode: "manual_import", status: "not_configured", encryptedCredentialRef: null, lastSyncAt: null, nextRetryAt: null, retryCount: 0, capabilities: ["read_sales", "import_csv"], createdAt: "2026-06-01T09:00:00-04:00", updatedAt: "2026-07-31T09:00:00-04:00" },
    { id: "integration-resy-demo", organizationId: orgId, locationIds: [gardenId, marketId], provider: "resy", mode: "manual_import", status: "not_configured", encryptedCredentialRef: null, lastSyncAt: null, nextRetryAt: null, retryCount: 0, capabilities: ["read_reservations", "import_csv"], createdAt: "2026-06-01T09:00:00-04:00", updatedAt: "2026-07-31T09:00:00-04:00" },
    { id: "integration-csv-demo", organizationId: orgId, locationIds: [gardenId, marketId], provider: "csv", mode: "manual_import", status: "connected", encryptedCredentialRef: null, lastSyncAt: "2026-08-01T07:31:00-04:00", nextRetryAt: null, retryCount: 0, capabilities: ["import_csv"], createdAt: "2026-06-01T09:00:00-04:00", updatedAt: "2026-08-01T07:31:00-04:00" },
  ],
  integrationSyncs: [
    { id: "sync-sales-csv-aug1", organizationId: orgId, connectionId: "integration-csv-demo", direction: "import", startedAt: "2026-08-01T07:30:00-04:00", completedAt: "2026-08-01T07:31:00-04:00", status: "succeeded", recordsRead: 42, recordsWritten: 42, recordsRejected: 0, attempt: 1, errorSummary: null, importFileId: "file-demo-sales-csv", createdAt: "2026-08-01T07:30:00-04:00", updatedAt: "2026-08-01T07:31:00-04:00" },
    { id: "sync-resy-csv-jul31", organizationId: orgId, connectionId: "integration-resy-demo", direction: "import", startedAt: "2026-07-31T07:30:00-04:00", completedAt: "2026-07-31T07:31:00-04:00", status: "partial", recordsRead: 18, recordsWritten: 17, recordsRejected: 1, attempt: 1, errorSummary: "One synthetic row lacked a guest identifier and is queued for review.", importFileId: "file-demo-reservations-csv", createdAt: "2026-07-31T07:30:00-04:00", updatedAt: "2026-07-31T07:31:00-04:00" },
  ],
  aiInsights: [
    { id: "ai-insight-produce", organizationId: orgId, locationIds: [gardenId], kind: "extraction", title: "Produce invoice needs a quick review", summary: "The total is high confidence, but two line descriptions did not match inventory items exactly.", confidence: 0.91, citations: [{ id: "citation-produce-receipt", entityType: "receipt", entityId: "receipt-produce-jul31", label: "Demo produce invoice", excerpt: "Detected total: $541.20; two unmatched descriptions", occurredAt: "2026-07-31T10:41:00-04:00" }, { id: "citation-produce-po", entityType: "purchase_order", entityId: "po-garden-1042", label: "PO-DEMO-1042", excerpt: "Purchase order received with two inventory lines", occurredAt: "2026-07-31T10:35:00-04:00" }], proposedAction: "post_inventory_adjustment", status: "awaiting_human_review", reviewedBy: null, reviewedAt: null, createdAt: "2026-07-31T10:42:00-04:00", updatedAt: "2026-07-31T10:42:00-04:00" },
    { id: "ai-insight-tomato-price", organizationId: orgId, locationIds: [gardenId, marketId], kind: "anomaly", title: "Tomato cost increased", summary: "The latest synthetic unit cost is 8.6% above the prior recorded price.", confidence: 0.99, citations: [{ id: "citation-price-jun", entityType: "inventory_price", entityId: "price-tomatoes-jun", label: "June tomato price", excerpt: "$1.74 per pound", occurredAt: "2026-06-20T11:00:00-04:00" }, { id: "citation-price-jul", entityType: "inventory_price", entityId: "price-tomatoes-jul", label: "July tomato price", excerpt: "$1.89 per pound", occurredAt: "2026-07-31T10:41:00-04:00" }], proposedAction: null, status: "informational", reviewedBy: null, reviewedAt: null, createdAt: "2026-08-01T08:05:00-04:00", updatedAt: "2026-08-01T08:05:00-04:00" },
    { id: "ai-insight-labor", organizationId: orgId, locationIds: [gardenId], kind: "forecast", title: "Open shift may leave service coverage light", summary: "One published Garden Room server shift remains open for tonight. Forecast confidence is moderate because live sales and reservations are not connected.", confidence: 0.72, citations: [{ id: "citation-open-shift", entityType: "shift", entityId: "shift-open-server-aug1", label: "Open server shift", excerpt: "5:00 PM–10:30 PM remains unclaimed", occurredAt: "2026-07-30T11:00:00-04:00" }, { id: "citation-toast-offline", entityType: "integration_connection", entityId: "integration-toast-demo", label: "Toast connection", excerpt: "Live sales connection is not configured", occurredAt: "2026-07-31T09:00:00-04:00" }], proposedAction: null, status: "informational", reviewedBy: null, reviewedAt: null, createdAt: "2026-08-01T09:00:00-04:00", updatedAt: "2026-08-01T09:00:00-04:00" },
  ],
  alerts: [
    { id: "alert-open-shift", organizationId: orgId, locationId: gardenId, kind: "labor", severity: "warning", title: "Server shift is still open", detail: "Tonight · 5:00 PM–10:30 PM", sourceEntityType: "shift", sourceEntityId: "shift-open-server-aug1", status: "open", assignedTo: aisha, createdAt: "2026-08-01T08:00:00-04:00", updatedAt: "2026-08-01T08:00:00-04:00" },
    { id: "alert-punch-correction", organizationId: orgId, locationId: gardenId, kind: "attendance", severity: "info", title: "Punch correction awaiting review", detail: "Leo requested a clock-out correction for July 31.", sourceEntityType: "timecard_correction", sourceEntityId: "correction-leo-jul31", status: "open", assignedTo: aisha, createdAt: "2026-08-01T09:10:00-04:00", updatedAt: "2026-08-01T09:10:00-04:00" },
    { id: "alert-tomato-variance", organizationId: orgId, locationId: gardenId, kind: "inventory", severity: "warning", title: "Tomato count is below expectation", detail: "Variance: −2.5 lb (synthetic data).", sourceEntityType: "inventory_count", sourceEntityId: "count-garden-jul31", status: "open", assignedTo: aisha, createdAt: "2026-08-01T00:18:00-04:00", updatedAt: "2026-08-01T00:18:00-04:00" },
    { id: "alert-market-closeout", organizationId: orgId, locationId: marketId, kind: "cash", severity: "info", title: "Closeout awaiting approval", detail: "Market Room closeout for July 31 is submitted.", sourceEntityType: "closeout", sourceEntityId: "closeout-market-jul31", status: "open", assignedTo: maris, createdAt: "2026-08-01T00:25:00-04:00", updatedAt: "2026-08-01T00:25:00-04:00" },
  ],
  notifications: [
    { id: "notification-imani-schedule", organizationId: orgId, recipientId: imani, kind: "schedule", title: "Schedule published", body: "Your Garden Room schedule for Jul 27–Aug 2 is ready.", actionUrl: "/schedule", readAt: "2026-07-24T15:20:00-04:00", createdAt: "2026-07-24T15:00:00-04:00", updatedAt: "2026-07-24T15:20:00-04:00" },
    { id: "notification-aisha-correction", organizationId: orgId, recipientId: aisha, kind: "approval", title: "Punch correction needs review", body: "Leo requested a clock-out correction for July 31.", actionUrl: "/time/pending", readAt: null, createdAt: "2026-08-01T09:10:00-04:00", updatedAt: "2026-08-01T09:10:00-04:00" },
    { id: "notification-maris-closeout", organizationId: orgId, recipientId: maris, kind: "approval", title: "Closeout submitted", body: "Market Room · July 31 is ready for approval.", actionUrl: "/closeouts/closeout-market-jul31", readAt: null, createdAt: "2026-08-01T00:25:00-04:00", updatedAt: "2026-08-01T00:25:00-04:00" },
    { id: "notification-mateo-maintenance", organizationId: orgId, recipientId: mateo, kind: "task", title: "Maintenance request assigned", body: "Confirm the ice machine service window.", actionUrl: "/operations/maintenance-ice-machine", readAt: "2026-08-01T09:03:00-04:00", createdAt: "2026-08-01T09:00:00-04:00", updatedAt: "2026-08-01T09:03:00-04:00" },
  ],
  auditEvents: [
    { id: "audit-schedule-publish", organizationId: orgId, locationId: gardenId, actorId: aisha, actorType: "user", action: "schedule.published", entityType: "schedule", entityId: "schedule-garden-aug-1", occurredAt: "2026-07-24T15:00:00-04:00", ipAddressMasked: "192.0.2.x", metadata: { shiftCount: 4, notificationCount: 4 }, immutable: true },
    { id: "audit-closeout-approve", organizationId: orgId, locationId: gardenId, actorId: maris, actorType: "user", action: "closeout.approved", entityType: "closeout", entityId: "closeout-garden-jul31", occurredAt: "2026-08-01T10:15:00-04:00", ipAddressMasked: "198.51.100.x", metadata: { cashVarianceCents: -300 }, immutable: true },
    { id: "audit-tip-lock", organizationId: orgId, locationId: gardenId, actorId: donald, actorType: "user", action: "tip_pool.locked", entityType: "tip_pool_run", entityId: "tip-run-garden-jul31", occurredAt: "2026-08-01T10:30:00-04:00", ipAddressMasked: "203.0.113.x", metadata: { distributableCents: 201000, ruleVersion: 1 }, immutable: true },
    { id: "audit-csv-import", organizationId: orgId, locationId: null, actorId: null, actorType: "integration", action: "integration.import_succeeded", entityType: "integration_sync", entityId: "sync-sales-csv-aug1", occurredAt: "2026-08-01T07:31:00-04:00", ipAddressMasked: null, metadata: { recordsWritten: 42, provider: "csv" }, immutable: true },
    { id: "audit-ai-proposal", organizationId: orgId, locationId: gardenId, actorId: null, actorType: "system", action: "ai.proposed_inventory_adjustment", entityType: "ai_insight", entityId: "ai-insight-produce", occurredAt: "2026-07-31T10:42:00-04:00", ipAddressMasked: null, metadata: { confidence: 0.91, automaticallyExecuted: false, humanApprovalRequired: true }, immutable: true },
  ],
};

export type DemoWorkspaceData = DemoWorkspace;
