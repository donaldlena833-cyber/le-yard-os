import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260811092658_core_realtime_invalidation_and_reservation_payload_boundary.sql",
  ),
  "utf8",
);
const compatibilityMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260812171801_realtime_identity_broadcast_compatibility.sql",
  ),
  "utf8",
);
const todayWorkspace = readFileSync(
  join(
    process.cwd(),
    "src/components/today/live-today-workspace.tsx",
  ),
  "utf8",
);

describe("reservation Realtime payload boundary", () => {
  it("preserves the historical identity-only upgrade boundary before the current-scope migration", () => {
    const functionBody = compatibilityMigration.match(
      /create or replace function public\.broadcast_reservation_change\(\)[\s\S]*?\n\$\$;/,
    )?.[0];
    expect(functionBody).toBeTruthy();
    expect(functionBody).toMatch(
      /jsonb_build_object\([\s\S]*?'id'[\s\S]*?'organization_id'[\s\S]*?'location_id'/,
    );
    expect(functionBody).toMatch(
      /realtime\.send\(\$1,\$2,\$3,\$4\)[\s\S]*broadcast_payload/,
    );
    expect(functionBody).not.toMatch(/raw_payload/);
    expect(functionBody).toMatch(/'record', new_identity/);
    expect(functionBody).toMatch(/'old_record', old_identity/);

    const policy = migration.match(
      /create policy le_yard_reservation_broadcast_read[\s\S]*?\n\s*\$policy\$/,
    )?.[0];
    expect(policy).toBeTruthy();
    expect(policy).toMatch(/public\.has_current_location_capability/g);
    expect(policy).toMatch(/'reservations\.view'/);
    expect(policy).toMatch(/'reservations\.operate'/);
    expect(policy).toMatch(/'reservations\.override'/);
    expect(policy).toMatch(/'reservations\.configure'/);
    expect(policy).not.toMatch(/can_access_location/);
  });

  it("uses current-scope safe counters for Today, Host and Service", () => {
    for (const path of ["src/components/today/live-today-workspace.tsx", "src/components/reservations/reservations-workspace.tsx", "src/components/service/live-service-control-workspace.tsx"]) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source).not.toMatch(/privateChannel:\s*true/);
      expect(source).not.toMatch(/broadcastEvents:/);
      expect(source).toMatch(/table: "(?:reservation|service_control)_invalidation_signals"/);
    }
    expect(todayWorkspace).toMatch(/table: "reservation_invalidation_signals"/);
    expect(todayWorkspace).toMatch(/table: "service_control_invalidation_signals"/);
  });
});
