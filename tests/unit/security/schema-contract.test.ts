import { describe, expect, it } from "vitest";
import {
  EXPECTED_SCHEMA_CONTRACT,
  matchesRuntimeSchemaContract,
} from "@/lib/security/schema-contract";

describe("runtime schema contract", () => {
  it("accepts the exact checked-in migration and function contract", () => {
    expect(matchesRuntimeSchemaContract(EXPECTED_SCHEMA_CONTRACT)).toBe(true);
  });

  it.each([
    { migrationHead: "20260812013549" },
    { publicFunctionCount: EXPECTED_SCHEMA_CONTRACT.publicFunctionCount - 1 },
    { contractVersion: "runtime-schema-v0" },
  ])("rejects drift: %o", (drift) => {
    expect(
      matchesRuntimeSchemaContract({ ...EXPECTED_SCHEMA_CONTRACT, ...drift }),
    ).toBe(false);
  });
});
