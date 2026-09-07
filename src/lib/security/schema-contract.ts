export const EXPECTED_SCHEMA_CONTRACT = {
  contractVersion: "runtime-schema-v2",
  migrationHead: "20260904195313",
} as const;

export type RuntimeSchemaContract = {
  contractVersion: string | null;
  migrationHead: string | null;
  publicFunctionCount: number | null;
  tableFingerprint: string | null;
  functionFingerprint: string | null;
  accessFingerprint: string | null;
  schemaFingerprint: string | null;
  matchesExpected: boolean | null;
};

const sha256Pattern = /^[0-9a-f]{64}$/;

export function matchesRuntimeSchemaContract(
  value: Partial<RuntimeSchemaContract> | null | undefined,
): boolean {
  return Boolean(
    value &&
      value.contractVersion === EXPECTED_SCHEMA_CONTRACT.contractVersion &&
      value.migrationHead === EXPECTED_SCHEMA_CONTRACT.migrationHead &&
      value.matchesExpected === true &&
      typeof value.publicFunctionCount === "number" &&
      value.publicFunctionCount > 0 &&
      sha256Pattern.test(value.tableFingerprint ?? "") &&
      sha256Pattern.test(value.functionFingerprint ?? "") &&
      sha256Pattern.test(value.accessFingerprint ?? "") &&
      sha256Pattern.test(value.schemaFingerprint ?? ""),
  );
}
