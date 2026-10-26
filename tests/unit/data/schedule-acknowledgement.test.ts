import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
import { loadLiveSchedule } from "@/data/read-models/schedule";
const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: { userId: "owner", displayName: "Owner", email: null, aal: "aal1" },
  organization: { id: "org", name: "Fixture organization" },
  activeLocation: { id: "location", organizationId: "org", name: "Fixture location", isPrimary: true, timeZone: "America/New_York" },
  locations: [{ id: "location", organizationId: "org", name: "Fixture location", isPrimary: true }],
  availableWorkspaces: [], membershipId: "membership", role: "owner", organizationWide: true,
  capabilities: ["schedule.manage", "schedule.publish"],
};
type Row = Record<string, unknown>;
function clientFor(acknowledgements: Row[], employeeId: string | null) {
  const tables: Record<string, Row[]> = {
    locations: [{ id: "location", organization_id: "org", timezone: "America/New_York" }],
    organization_settings: [{ organization_id: "org", week_starts_on: 1 }],
    schedules: [{ id: "schedule", organization_id: "org", location_id: "location", week_start: "2026-11-02", status: "published", version: 1 }],
    job_roles: [{ id: "server", organization_id: "org", name: "Server", code: "SERVER", is_active: true }],
    employees: ["original", "replacement"].map((id) => ({ id, organization_id: "org", user_id: id, display_name: id, employment_status: "active" })),
    schedule_templates: [], schedule_template_shifts: [], shift_swap_requests: [], shift_swap_offers: [],
    shifts: [{ id: "shift", organization_id: "org", schedule_id: "schedule", employee_id: employeeId, job_role_id: "server", starts_at: "2026-11-02T16:00:00Z", ends_at: "2026-11-02T18:00:00Z", break_minutes: 0, status: employeeId ? "scheduled" : "open", is_open: employeeId === null, notes: null }],
    shift_acknowledgements: acknowledgements.map((ack) => ({ organization_id: "org", ...ack })),
  };
  return { from(table: string) {
    let rows = [...(tables[table] ?? [])];
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { rows = rows.filter((row) => row[key] === value); return query; },
      in(key: string, values: unknown[]) { rows = rows.filter((row) => values.includes(row[key])); return query; },
      order() { return query; }, limit(n: number) { rows = rows.slice(0, n); return query; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      single() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
    }; return query;
  } };
}
describe("schedule acknowledgement belongs to the current assigned person", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    { name: "current assignee", employeeId: "replacement", acks: [{ shift_id: "shift", employee_id: "replacement" }], expected: true },
    { name: "previous assignee only", employeeId: "replacement", acks: [{ shift_id: "shift", employee_id: "original" }], expected: false },
    { name: "both historical and current assignees", employeeId: "replacement", acks: [{ shift_id: "shift", employee_id: "original" }, { shift_id: "shift", employee_id: "replacement" }], expected: true },
    { name: "reopened unassigned shift", employeeId: null, acks: [{ shift_id: "shift", employee_id: "original" }], expected: false },
    { name: "another shift", employeeId: "replacement", acks: [{ shift_id: "other", employee_id: "replacement" }], expected: false },
    { name: "no acknowledgement", employeeId: "replacement", acks: [], expected: false },
  ])("uses $name", async ({ employeeId, acks, expected }) => {
    state.client = clientFor(acks, employeeId);
    const result = await loadLiveSchedule(workspace, "2026-11-02");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.data.shifts).toHaveLength(1);
    expect(result.data.shifts[0].employeeId).toBe(employeeId);
    expect(result.data.shifts[0].acknowledged).toBe(expected);
  });
});
