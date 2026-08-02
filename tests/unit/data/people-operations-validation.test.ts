import { describe, expect, it } from "vitest";
import {
  decideTimeOffInputSchema,
  employeeDocumentUploadInputSchema,
  finalizeEmployeeDocumentInputSchema,
  saveAvailabilityInputSchema,
  saveCertificationInputSchema,
  saveEmergencyContactInputSchema,
  saveTimeOffInputSchema,
} from "@/data/people-operations-schemas";

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  employee: "22222222-2222-4222-8222-222222222222",
  location: "33333333-3333-4333-8333-333333333333",
};

const availability = {
  requestId: ids.request,
  employeeId: ids.employee,
  ruleId: null,
  locationId: ids.location,
  weekday: 1,
  availableFrom: "09:00",
  availableUntil: "17:00",
  isAvailable: true,
  effectiveFrom: "2026-08-03",
  effectiveTo: null,
  notes: null,
};

describe("People Operations validation", () => {
  it("accepts bounded actor-free availability and time-off payloads", () => {
    expect(saveAvailabilityInputSchema.safeParse(availability).success).toBe(true);
    expect(
      saveTimeOffInputSchema.safeParse({
        requestId: ids.request,
        employeeId: ids.employee,
        timeOffId: null,
        locationId: ids.location,
        startsAtLocal: "2026-08-10T09:00",
        endsAtLocal: "2026-08-10T17:00",
        reason: "Appointment",
      }).success,
    ).toBe(true);
  });

  it("enforces the availability mode and effective-date contract", () => {
    expect(
      saveAvailabilityInputSchema.safeParse({
        ...availability,
        isAvailable: false,
        availableFrom: null,
        availableUntil: null,
      }).success,
    ).toBe(true);
    expect(
      saveAvailabilityInputSchema.safeParse({
        ...availability,
        isAvailable: false,
      }).success,
    ).toBe(false);
    expect(
      saveAvailabilityInputSchema.safeParse({
        ...availability,
        effectiveTo: "2026-08-02",
      }).success,
    ).toBe(false);
  });

  it("rejects reversed leave ranges and unexplained denials", () => {
    expect(
      saveTimeOffInputSchema.safeParse({
        requestId: ids.request,
        employeeId: ids.employee,
        timeOffId: null,
        locationId: ids.location,
        startsAtLocal: "2026-08-10T17:00",
        endsAtLocal: "2026-08-10T09:00",
        reason: null,
      }).success,
    ).toBe(false);
    expect(
      decideTimeOffInputSchema.safeParse({
        requestId: ids.request,
        timeOffId: ids.employee,
        approve: false,
        decisionNote: "   ",
      }).success,
    ).toBe(false);
  });

  it("checks certification dates and emergency-contact details", () => {
    expect(
      saveCertificationInputSchema.safeParse({
        requestId: ids.request,
        employeeId: ids.employee,
        certificationId: null,
        certificationType: "Food handler",
        issuer: "City Health",
        credentialNumber: null,
        issuedOn: "2026-08-10",
        expiresOn: "2026-08-09",
        verified: false,
      }).success,
    ).toBe(false);
    expect(
      saveEmergencyContactInputSchema.safeParse({
        requestId: ids.request,
        employeeId: ids.employee,
        contactId: null,
        name: "Jamie Rivera",
        relationship: "Partner",
        phone: "call-me-maybe",
        email: "not-an-email",
        isPrimary: true,
      }).success,
    ).toBe(false);
  });

  it("allows only bounded PDF and image document uploads", () => {
    const upload = {
      uploadId: ids.request,
      employeeId: ids.employee,
      locationId: ids.location,
      documentType: "handbook",
      title: "Signed handbook",
      mimeType: "application/pdf",
      sizeBytes: 2_048,
      employeeVisible: true,
      fileName: "signed-handbook.pdf",
    };
    expect(employeeDocumentUploadInputSchema.safeParse(upload).success).toBe(true);
    expect(
      employeeDocumentUploadInputSchema.safeParse({
        ...upload,
        mimeType: "text/html",
      }).success,
    ).toBe(false);
    expect(
      employeeDocumentUploadInputSchema.safeParse({
        ...upload,
        sizeBytes: 25 * 1_048_576 + 1,
      }).success,
    ).toBe(false);
  });

  it("rejects browser-supplied tenant or actor fields", () => {
    expect(
      finalizeEmployeeDocumentInputSchema.safeParse({
        requestId: ids.request,
        employeeId: ids.employee,
        locationId: ids.location,
        documentType: "handbook",
        title: "Signed handbook",
        mimeType: "application/pdf",
        sizeBytes: 2_048,
        employeeVisible: true,
        objectPath: `${ids.employee}/${ids.location}/employee-documents/file.pdf`,
        organizationId: ids.employee,
        uploadedBy: ids.request,
      }).success,
    ).toBe(false);
  });
});
