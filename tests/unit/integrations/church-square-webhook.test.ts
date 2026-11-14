import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/integrations/square/webhook/route";
import { churchSquareWebhookUrl } from "@/lib/integrations/church-square-webhook.server";
import { createAdminClient } from "@/lib/supabase/admin";

const schedule = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after: schedule }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
const mockAdmin = vi.mocked(createAdminClient);
const rpc = vi.fn();
const result = vi.fn();
const key = "synthetic-square-signature-key";
const createdAt = "2026-11-14T12:00:00.29574314Z";
const merchant = "MERCHANT_1";
const location = "CHURCH_1";

function event(type: string, object: unknown, id = "resource-1") {
  return { type, data: { id, object }, merchant_id: merchant, event_id: "event-1", created_at: createdAt };
}

function request(payload: unknown, signedBody?: string, signUrl = churchSquareWebhookUrl) {
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signature = createHmac("sha256", key).update(signUrl).update(signedBody ?? rawBody).digest("base64");
  return new Request(churchSquareWebhookUrl, {
    method: "POST",
    headers: { "X-Square-HmacSha256-Signature": signature, "Content-Type": "application/json" },
    body: rawBody,
  });
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("LE_YARD_CHURCH_SQUARE_WEBHOOK_ENABLED", "true");
  vi.stubEnv("SQUARE_CHURCH_WEBHOOK_SIGNATURE_KEY", key);
  vi.stubEnv("SQUARE_CHURCH_MERCHANT_ID", merchant);
  vi.stubEnv("SQUARE_CHURCH_LOCATION_ID", location);
  result.mockResolvedValue({ error: null, data: true });
  rpc.mockReturnValue({ abortSignal: result });
  mockAdmin.mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("signed Church Street Square webhooks", () => {
  it("rejects wrong notification URL or changed original bytes before touching the database", async () => {
    const body = JSON.stringify(event("payment.updated", { payment: { id: "resource-1", location_id: location } }));
    expect((await POST(request(body, body, "https://host.leyardny.com/api/integrations/square/webhook"))).status).toBe(401);
    expect((await POST(request(body + " ", body))).status).toBe(401);
    expect(mockAdmin).not.toHaveBeenCalled();
  });

  it("writes only scoped, nonestimated in-stock projections and notification identifiers", async () => {
    const count = { catalog_object_id: "VARIATION_1", catalog_object_type: "ITEM_VARIATION", calculated_at: createdAt,
      state: "IN_STOCK", quantity: "5", location_id: location, extraneous: "private" };
    const body = event("inventory.count.updated", { inventory_counts: [
      count, { ...count, location_id: "OTHER_LOCATION" }, { ...count, is_estimated: true }, { ...count, state: "SOLD" },
    ] });
    expect((await POST(request(body))).status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("service_record_church_square_webhook", {
      p_merchant_id: merchant, p_square_location_id: location, p_event_id: "event-1",
      p_event_type: "inventory.count.updated", p_created_at: createdAt, p_resource_id: "resource-1",
      p_related_order_id: undefined,
      p_inventory: [{ variationId: "VARIATION_1", quantity: "5", calculatedAt: createdAt }],
    });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("suppresses unrelated sellers, locations, and resource mismatches", async () => {
    const valid = event("invoice.payment_made", { invoice: { id: "resource-1", location_id: location } });
    expect((await POST(request({ ...valid, merchant_id: "FOREIGN" }))).status).toBe(204);
    expect((await POST(request({ ...valid, location_id: "OTHER_LOCATION" }))).status).toBe(204);
    expect((await POST(request(event("invoice.payment_made", { invoice: { id: "other-resource", location_id: location } })))).status).toBe(204);
    expect(mockAdmin).not.toHaveBeenCalled();
  });

  it("accepts a signed inventory event whose data identifier is blank", async () => {
    const inventory = { inventory_counts: [{
      catalog_object_id: "VARIATION_1", catalog_object_type: "ITEM_VARIATION", calculated_at: createdAt,
      state: "IN_STOCK", quantity: "5", location_id: location,
    }] };
    expect((await POST(request(event("inventory.count.updated", inventory, "")))).status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("service_record_church_square_webhook", expect.objectContaining({
      p_event_id: "event-1", p_resource_id: "event-1",
    }));
  });

  it("drops the invoice recipient and customer information while retaining a resource link", async () => {
    const invoice = { id: "inv:synthetic-1", order_id: "order-1", location_id: location,
      primary_recipient: { email_address: "user@example.invalid" } };
    expect((await POST(request(event("invoice.payment_made", { invoice }, invoice.id)))).status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("service_record_church_square_webhook", {
      p_merchant_id: merchant, p_square_location_id: location, p_event_id: "event-1",
      p_event_type: "invoice.payment_made", p_created_at: createdAt, p_resource_id: invoice.id,
      p_related_order_id: "order-1", p_inventory: [],
    });
    expect(schedule).toHaveBeenCalledOnce();
  });

  it("acknowledges a duplicate only after persistence and returns a retry status during failures", async () => {
    const body = event("order.updated", { order_updated: { order_id: "resource-1", location_id: location } });
    result.mockResolvedValueOnce({ error: null, data: false }).mockResolvedValueOnce({ error: { message: "private" } });
    expect((await POST(request(body))).status).toBe(204);
    const failed = await POST(request(body));
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe("");
    expect(schedule).toHaveBeenCalledOnce();
  });

  it("keeps the receiver disabled in preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await POST(request({}))).status).toBe(503);
    expect(mockAdmin).not.toHaveBeenCalled();
  });
});
