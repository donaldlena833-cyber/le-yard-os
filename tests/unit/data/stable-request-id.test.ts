import { describe, expect, it } from "vitest";
import {
  PayloadRequestRegistry,
  stablePayloadFingerprint,
} from "@/lib/idempotency/stable-request-id";

describe("payload-bound request ids", () => {
  it("canonicalizes object keys without changing array order", () => {
    expect(stablePayloadFingerprint({ b: 2, a: { z: 3, y: [2, 1] } })).toBe(
      stablePayloadFingerprint({ a: { y: [2, 1], z: 3 }, b: 2 }),
    );
    expect(stablePayloadFingerprint({ values: [1, 2] })).not.toBe(
      stablePayloadFingerprint({ values: [2, 1] }),
    );
  });

  it("reuses retries, rotates on payload changes, success, or close", () => {
    let sequence = 0;
    const registry = new PayloadRequestRegistry(() => `request-${++sequence}`);

    const first = registry.requestId("receipt.finalize", { receiptId: "one", size: 8 });
    expect(registry.requestId("receipt.finalize", { size: 8, receiptId: "one" })).toBe(first);
    expect(registry.requestId("receipt.finalize", { receiptId: "one", size: 9 })).not.toBe(first);

    const beforeSuccess = registry.requestId("operations.checklist.start", { date: "2026-08-01" });
    registry.rotate("operations.checklist.start");
    expect(registry.requestId("operations.checklist.start", { date: "2026-08-01" })).not.toBe(beforeSuccess);

    const beforeClose = registry.requestId("settings.notification", { enabled: true });
    registry.rotateAll();
    expect(registry.requestId("settings.notification", { enabled: true })).not.toBe(beforeClose);
  });
});
