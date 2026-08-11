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
const todayWorkspace = readFileSync(
  join(
    process.cwd(),
    "src/components/today/live-today-workspace.tsx",
  ),
  "utf8",
);

describe("reservation Realtime payload boundary", () => {
  it("broadcasts scoped identity only and requires an exact reservation capability", () => {
    const functionBody = migration.match(
      /create or replace function public\.broadcast_reservation_change\(\)[\s\S]*?\n\$\$;/,
    )?.[0];
    expect(functionBody).toBeTruthy();
    expect(functionBody).toMatch(
      /jsonb_build_object\([\s\S]*?'id'[\s\S]*?'organization_id'[\s\S]*?'location_id'/,
    );
    expect(functionBody).toMatch(
      /realtime\.broadcast_changes\(\$1,\$2,\$3,\$4,\$5,\$6,\$7\)[\s\S]*new_identity,[\s\S]*old_identity/,
    );
    expect(functionBody).not.toMatch(/new_record|old_record|raw_payload/);

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

  it("routes Today reservation invalidation through the same private topic", () => {
    expect(todayWorkspace).not.toMatch(
      /todayRealtimeBindings[\s\S]*?table:\s*"reservations"/,
    );
    expect(todayWorkspace).toMatch(
      /channelName:\s*`reservations:\$\{workspace\.organization\.id\}:\$\{workspace\.activeLocation\.id\}`/,
    );
    expect(todayWorkspace).toMatch(/privateChannel:\s*true/);
    expect(todayWorkspace).toMatch(
      /todayReservationBroadcastEvents\s*=\s*\["INSERT",\s*"UPDATE",\s*"DELETE"\]/,
    );
  });
});
