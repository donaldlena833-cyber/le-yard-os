import type { AcceptanceRole } from "./attestation-preflight";

export const CONNECTED_SOAK_SESSION_COUNT = 14;
export const CONNECTED_SOAK_REFRESH_P95_BUDGET_MS = 3_000;

export const connectedSoakPlan: ReadonlyArray<{
  session: number;
  role: AcceptanceRole;
  reservationsExpected: boolean;
}> = [
  { session: 1, role: "Owner", reservationsExpected: true },
  { session: 2, role: "Manager", reservationsExpected: true },
  { session: 3, role: "Host", reservationsExpected: true },
  { session: 4, role: "ViewOnly", reservationsExpected: true },
  { session: 5, role: "OperateOnly", reservationsExpected: true },
  { session: 6, role: "Denied", reservationsExpected: false },
  { session: 7, role: "Expired", reservationsExpected: false },
  { session: 8, role: "CrossLocation", reservationsExpected: false },
  { session: 9, role: "Owner", reservationsExpected: true },
  { session: 10, role: "Manager", reservationsExpected: true },
  { session: 11, role: "Host", reservationsExpected: true },
  { session: 12, role: "ViewOnly", reservationsExpected: true },
  { session: 13, role: "OperateOnly", reservationsExpected: true },
  { session: 14, role: "Owner", reservationsExpected: true },
];

export function percentile95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}
