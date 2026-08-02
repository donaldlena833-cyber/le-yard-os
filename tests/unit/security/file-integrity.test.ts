import { describe, expect, it } from "vitest";
import {
  hasExpectedFileSignature,
  sha256Hex,
} from "@/lib/storage/file-integrity";

describe("private file integrity", () => {
  it.each([
    ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]],
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    [
      "image/webp",
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
    ],
  ])("accepts a real %s signature", (mimeType, values) => {
    expect(hasExpectedFileSignature(Uint8Array.from(values), mimeType)).toBe(true);
  });

  it("rejects a renamed executable and unsupported formats", () => {
    const executable = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]);
    expect(hasExpectedFileSignature(executable, "application/pdf")).toBe(false);
    expect(hasExpectedFileSignature(executable, "application/octet-stream")).toBe(false);
  });

  it("produces a stable SHA-256 fingerprint", () => {
    expect(sha256Hex(new TextEncoder().encode("Le Yard OS"))).toBe(
      "8c1e58eae2d638d913b9ebac5036dda6e97b7f6e7a7e16cbb62cb4f3b2ae6272",
    );
  });
});
