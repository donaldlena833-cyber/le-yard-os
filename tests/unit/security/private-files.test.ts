import { describe, expect, it } from "vitest";
import {
  buildAvatarObjectPath,
  buildPrivateObjectPath,
  normalizePrivateFileName,
  parsePrivateObjectPath,
  PRIVATE_BUCKET_DATABASE_POLICIES,
  PRIVATE_BUCKET_POLICIES,
  PRIVATE_BUCKETS,
  validatePrivateFile,
} from "@/lib/storage/private-files";

const organizationId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const resourceId = "33333333-3333-4333-8333-333333333333";
const uploadId = "44444444-4444-4444-8444-444444444444";

describe("private file contract", () => {
  it("builds an exact tenant/location/resource path", () => {
    expect(
      buildPrivateObjectPath({
        organizationId,
        locationId,
        resourceKind: "receipts",
        resourceId,
        uploadId,
        fileName: "Produce Invoice (August).PDF",
      }),
    ).toBe(
      `${organizationId}/${locationId}/receipts/${resourceId}/${uploadId}-Produce-Invoice-August-.PDF`,
    );
  });

  it("normalizes traversal and separator-like filename content", () => {
    expect(normalizePrivateFileName("../../secrets\\invoice?.pdf")).toBe(
      "secrets-invoice-.pdf",
    );
  });

  it("builds the avatar shape required by the profile-owner storage policy", () => {
    expect(
      buildAvatarObjectPath({
        organizationId,
        userId: resourceId,
        mimeType: "image/webp",
      }),
    ).toBe(`${organizationId}/global/${resourceId}.webp`);
  });

  it("rejects malformed, encoded, or cross-shape object paths", () => {
    expect(parsePrivateObjectPath(`${organizationId}/global/reports/file.pdf`)).not.toBeNull();
    expect(parsePrivateObjectPath(`not-a-uuid/global/reports/file.pdf`)).toBeNull();
    expect(parsePrivateObjectPath(`${organizationId}/../reports/file.pdf`)).toBeNull();
    expect(parsePrivateObjectPath(`${organizationId}/%2f/reports/file.pdf`)).toBeNull();
    expect(parsePrivateObjectPath(`${organizationId}\\global\\file.pdf`)).toBeNull();
  });

  it("enforces bucket MIME and byte ceilings", () => {
    expect(validatePrivateFile("receipts", "application/pdf", 1_024)).toEqual({ ok: true });
    expect(validatePrivateFile("receipts", "text/html", 1_024).ok).toBe(false);
    expect(validatePrivateFile("profile-avatars", "image/png", 6 * 1_048_576).ok).toBe(false);
    expect(validatePrivateFile("imports", "text/csv", 0).ok).toBe(false);
  });

  it("never permits an upload larger than the database bucket ceiling", () => {
    for (const bucket of PRIVATE_BUCKETS) {
      expect(PRIVATE_BUCKET_POLICIES[bucket].maxBytes).toBeLessThanOrEqual(
        PRIVATE_BUCKET_DATABASE_POLICIES[bucket].maxBytes,
      );
    }
  });
});
