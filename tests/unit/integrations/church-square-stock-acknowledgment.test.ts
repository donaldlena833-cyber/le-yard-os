import { beforeEach, expect, it, vi } from "vitest";
import { acknowledgeChurchSquareStockAlertAction } from "@/app/actions/workflows/church-square-stock-alerts";
import { readChurchSquareStockAlerts } from "@/data/read-models/church-square-stock-alerts";
import type { WorkflowError } from "@/data/errors";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), configuration: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/lib/integrations/church-square-webhook.server", () => ({ churchSquareWebhookConfiguration: mocks.configuration }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/data/execute", () => ({
  executeWorkflowAction: async (options: {
    input: unknown;
    schema: { parse(value: unknown): unknown };
    run(context: { actor: { userId: string }; supabase: { rpc: typeof mocks.rpc } }, value: unknown): unknown;
  }) => {
    try {
      const data = await options.run({ actor: { userId: "operator" }, supabase: { rpc: mocks.rpc } }, options.schema.parse(options.input));
      return { ok: true, persisted: true, mode: "live", data };
    } catch (error) {
      return { ok: false, persisted: false, code: (error as WorkflowError).code ?? "validation" };
    }
  },
}));

const itemId = "10000000-0000-4000-8000-000000000001";
const episodeId = "10000000-0000-4000-8000-000000000002";
const workspace = {
  mode: "live", role: "employee", identity: { userId: "operator" }, activeLocation: { id: "church" },
  serviceSettings: { serviceModel: "counter" }, capabilities: ["inventory.count.create"],
};
const acknowledgment = { acknowledgedAt: "2026-11-14T11:00:00Z", acknowledgedByName: "Shift Lead" };
const low = { id: itemId, episode: episodeId, label: "Fixture", quantity: "5", calculatedAt: "2026-11-14T10:59:00Z" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: workspace });
  mocks.configuration.mockReturnValue({});
});

it("records the exact episode for the session's location and projects only actor name and time", async () => {
  mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: { ...acknowledgment, actor: "private" }, error: null }) });
  expect(await acknowledgeChurchSquareStockAlertAction({ itemId, episodeId })).toMatchObject({ ok: true, data: acknowledgment });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("acknowledge_church_square_stock_alert", {
    p_location_id: "church", p_item_id: itemId, p_episode_id: episodeId,
  });
  expect(mocks.revalidate).toHaveBeenCalledWith("/inventory");
  mocks.rpc.mockReturnValueOnce({ abortSignal: async () => ({ error: { code: "PT409" } }) });
  expect(await acknowledgeChurchSquareStockAlertAction({ itemId, episodeId })).toMatchObject({ ok: false, code: "stale" });
});

it("blocks unassigned staff, a mismatched session actor, and user-supplied location", async () => {
  mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, capabilities: [] } });
  expect(await acknowledgeChurchSquareStockAlertAction({ itemId, episodeId })).toMatchObject({ ok: false, code: "forbidden" });
  mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, identity: { userId: "other" } } });
  expect(await acknowledgeChurchSquareStockAlertAction({ itemId, episodeId })).toMatchObject({ ok: false, code: "forbidden" });
  expect(await acknowledgeChurchSquareStockAlertAction({ itemId, episodeId, locationId: "other" })).toMatchObject({ ok: false, code: "validation" });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("keeps a shared acknowledgment on the current low row and rejects a partial receipt", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: [low], error: null });
  expect(await readChurchSquareStockAlerts("church")).toEqual({
    status: "ready", alerts: [{ ...low, acknowledgedAt: null, acknowledgedByName: null }],
  });
  mocks.rpc.mockResolvedValueOnce({ data: [{ ...low, ...acknowledgment }], error: null });
  expect(await readChurchSquareStockAlerts("church")).toEqual({ status: "ready", alerts: [{ ...low, ...acknowledgment }] });
  mocks.rpc.mockResolvedValueOnce({ data: [{ ...low, acknowledgedAt: acknowledgment.acknowledgedAt }], error: null });
  expect(await readChurchSquareStockAlerts("church")).toEqual({ status: "unavailable" });
});
