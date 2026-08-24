export const EXPECTED_SCHEMA_CONTRACT = {
  contractVersion: "runtime-schema-v1",
  migrationHead: "20260824205728",
  publicFunctionCount: 295,
} as const;

export type RuntimeSchemaContract = {
  contractVersion: string | null;
  migrationHead: string | null;
  publicFunctionCount: number | null;
};

export function matchesRuntimeSchemaContract(
  value: Partial<RuntimeSchemaContract> | null | undefined,
): boolean {
  return Boolean(
    value &&
      value.contractVersion === EXPECTED_SCHEMA_CONTRACT.contractVersion &&
      value.migrationHead === EXPECTED_SCHEMA_CONTRACT.migrationHead &&
      value.publicFunctionCount === EXPECTED_SCHEMA_CONTRACT.publicFunctionCount,
  );
}
