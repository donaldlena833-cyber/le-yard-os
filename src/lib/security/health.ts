export interface HealthState {
  statusCode: 200 | 503;
  body: {
    status: "ready" | "not_ready";
    liveness: "ok";
    readiness: "ok" | "blocked";
    checkedAt: string;
  };
}

/** Separates process liveness from configuration readiness. */
export function buildHealthState(ready: boolean, checkedAt: string): HealthState {
  return {
    statusCode: ready ? 200 : 503,
    body: {
      status: ready ? "ready" : "not_ready",
      liveness: "ok",
      readiness: ready ? "ok" : "blocked",
      checkedAt,
    },
  };
}
