import "server-only";

import { z } from "zod";
import { churchSquareCountConfiguration } from "./church-square-configuration.server";
import { emptyLoyaltySnapshot, loyaltyBirthday, loyaltyPageSize, type LoyaltySnapshot } from "./church-square-loyalty";
import { SquareCountClient, type SquareCountConfiguration } from "./square-counts.server";
import { SQUARE_API_VERSION } from "./square-source";
import { regularsLocalDay, type RegularsVisit } from "./church-regulars-streak";

const id = z.string().regex(/^[A-Za-z0-9_:-]{1,192}$/);
const programSchema = z.object({
  id,
  status: z.enum(["ACTIVE", "INACTIVE"]),
  location_ids: z.array(id).min(1).max(1000),
  terminology: z.object({ one: z.string().max(100), other: z.string().max(100) }).optional(),
  reward_tiers: z.array(z.object({ id, name: z.string().max(500), points: z.number().int().safe().positive() })).max(100),
});
const accountSchema = z.object({
  id, program_id: id, customer_id: id,
  balance: z.number().int().safe(),
  lifetime_points: z.number().int().safe().nonnegative().optional(),
  enrolled_at: z.iso.datetime({ offset: true }).optional(),
  mapping: z.object({ phone_number: z.string().max(30) }),
});
const customerSchema = z.object({
  id,
  given_name: z.string().max(1000).optional(),
  family_name: z.string().max(1000).optional(),
  birthday: z.string().max(10).optional(),
});

class LoyaltyReadError extends Error {
  constructor(readonly reason: "not_configured" | "permissions_required" | "unavailable") {
    super("Square loyalty could not be read.");
  }
}

export class ChurchSquareLoyaltyClient {
  constructor(private readonly config: SquareCountConfiguration, private readonly request: typeof fetch = fetch) {}

  private async call(path: string, body?: object, programLookup = false): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.request(`${this.config.environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com"}${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          "Square-Version": SQUARE_API_VERSION,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
      });
    } catch { throw new LoyaltyReadError("unavailable"); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new LoyaltyReadError(response.status === 401 || response.status === 403
        ? "permissions_required" : response.status === 404 && programLookup ? "not_configured" : "unavailable");
    }
    // Bound provider bodies before parsing; never log provider contact payloads.
    if (Number(response.headers.get("content-length")) > 1_048_576) {
      await response.body?.cancel().catch(() => {});
      throw new LoyaltyReadError("unavailable");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new LoyaltyReadError("unavailable");
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1_048_576) { await reader.cancel(); throw new LoyaltyReadError("unavailable"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const envelope = z.object({ errors: z.array(z.unknown()).optional() }).passthrough().parse(
      JSON.parse(Buffer.concat(chunks, length).toString("utf8")),
    );
    if (envelope.errors?.length) throw new LoyaltyReadError("unavailable");
    return envelope;
  }

  private async program() {
    await new SquareCountClient(this.config, this.request).verifyScope(AbortSignal.timeout(10_000));
    const program = programSchema.parse((await this.call("/v2/loyalty/programs/main", undefined, true)).program);
    // Membership belongs to a seller's program. Never attribute visits to a café.
    if (!program.location_ids.includes(this.config.locationId)) throw new LoyaltyReadError("not_configured");
    return program;
  }

  async readiness(): Promise<"active" | "inactive"> {
    return (await this.program()).status === "ACTIVE" ? "active" : "inactive";
  }

  /** Read purchase evidence, never infer days from a points balance or manual adjustment. */
  async regularsVisits(accountId: string): Promise<RegularsVisit[]> {
    id.parse(accountId);
    const program = await this.program();
    if (program.status !== "ACTIVE") throw new LoyaltyReadError("not_configured");
    const account = accountSchema.parse((await this.call(`/v2/loyalty/accounts/${encodeURIComponent(accountId)}`)).loyalty_account);
    if (account.id !== accountId || account.program_id !== program.id) throw new LoyaltyReadError("unavailable");
    const orders = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let complete = false;
    for (let page = 0; page < 60; page++) {
      const payload = await this.call("/v2/loyalty/events/search", {
        limit: 30, ...(cursor ? { cursor } : {}),
        query: { filter: { loyalty_account_filter: { loyalty_account_id: accountId },
          date_time_filter: { created_at: { start_at: "2026-11-24T05:00:00Z" } } } },
      });
      const events = z.array(z.object({
        id, type: z.string(), loyalty_account_id: id, location_id: id.optional(),
        accumulate_points: z.object({ loyalty_program_id: id, points: z.number().int(), order_id: id.optional() }).optional(),
      })).max(30).parse(payload.events ?? []);
      for (const event of events) {
        if (event.loyalty_account_id !== accountId) throw new LoyaltyReadError("unavailable");
        if (event.type === "ACCUMULATE_POINTS" && event.location_id === this.config.locationId
          && event.accumulate_points?.loyalty_program_id === program.id
          && event.accumulate_points.points > 0 && event.accumulate_points.order_id) orders.add(event.accumulate_points.order_id);
      }
      const next = z.string().min(1).max(4096).optional().parse(payload.cursor);
      if (!next) { complete = true; break; }
      if (seenCursors.has(next)) throw new LoyaltyReadError("unavailable");
      seenCursors.add(next); cursor = next;
    }
    if (!complete) throw new LoyaltyReadError("unavailable");
    const money = z.object({ amount: z.number().int().safe().nonnegative(), currency: z.literal("USD") });
    const orderSchema = z.object({
      id, location_id: id, state: z.string(), closed_at: z.iso.datetime({ offset: true }).optional(),
      line_items: z.array(z.object({ catalog_object_id: id.optional(), item_type: z.string().optional() })).optional(),
      tenders: z.array(z.object({ id: id.optional(), payment_id: id.optional() })).optional(),
    });
    const paymentSchema = z.object({ id, location_id: id, order_id: id, status: z.string(),
      amount_money: money, refunded_money: money.optional() });
    const visits: RegularsVisit[] = [];
    const ids = [...orders];
    for (let index = 0; index < ids.length; index += 25) {
      const batch = ids.slice(index, index + 25);
      const response = await this.call("/v2/orders/batch-retrieve", { location_id: this.config.locationId, order_ids: batch });
      const loaded = z.array(orderSchema).max(25).parse(response.orders ?? []);
      if (loaded.length !== batch.length || new Set(loaded.map(order => order.id)).size !== batch.length
        || loaded.some(order => !batch.includes(order.id) || order.location_id !== this.config.locationId)) throw new LoyaltyReadError("unavailable");
      // Bound parallel provider reads. Payments are checked independently because
      // the original order's sale amounts alone do not prove refund status.
      for (let offset = 0; offset < loaded.length; offset += 6) {
        const results = await Promise.all(loaded.slice(offset, offset + 6).map(async order => {
          if (order.state !== "COMPLETED" || !order.closed_at) return null;
          if (order.line_items?.length && order.line_items.every(item => item.item_type === "GIFT_CARD"
            || Boolean(this.config.testVariationId && item.catalog_object_id === this.config.testVariationId))) return null;
          if (!order.tenders?.length) throw new LoyaltyReadError("unavailable");
          let paid = 0;
          const paymentIds = new Set<string>();
          for (const tender of order.tenders) {
            const paymentId = tender.payment_id ?? tender.id;
            if (!paymentId || paymentIds.has(paymentId)) throw new LoyaltyReadError("unavailable");
            paymentIds.add(paymentId);
            const payment = paymentSchema.parse((await this.call(`/v2/payments/${encodeURIComponent(paymentId)}`)).payment);
            if (payment.id !== paymentId || payment.order_id !== order.id || payment.location_id !== this.config.locationId) throw new LoyaltyReadError("unavailable");
            if ((payment.refunded_money?.amount ?? 0) > payment.amount_money.amount) throw new LoyaltyReadError("unavailable");
            if (payment.status === "COMPLETED") paid += Math.max(0, payment.amount_money.amount - (payment.refunded_money?.amount ?? 0));
          }
          return paid > 0 ? { day: regularsLocalDay(new Date(order.closed_at)), orderId: order.id } : null;
        }));
        for (const result of results) if (result) visits.push(result);
      }
    }
    return visits;
  }

  async read(input: { phone?: string; cursor?: string } = {}): Promise<LoyaltySnapshot> {
    const program = await this.program();
    const result = emptyLoyaltySnapshot(program.status === "ACTIVE" ? "active" : "inactive");
    result.program = {
      pointsLabel: program.terminology?.other || "points",
      rewards: [...program.reward_tiers].sort((a, b) => a.points - b.points).map(({ name, points }) => ({ name, points })),
      sharedAcrossLocations: program.location_ids.length > 1,
    };
    if (program.status !== "ACTIVE") return result;
    const accountsResponse = await this.call("/v2/loyalty/accounts/search", {
      limit: loyaltyPageSize,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.phone ? { query: { mappings: [{ phone_number: input.phone }] } } : {}),
    });
    const accounts = z.array(accountSchema).max(loyaltyPageSize).parse(accountsResponse.loyalty_accounts ?? []);
    if (accounts.some(account => account.program_id !== program.id) || new Set(accounts.map(a => a.id)).size !== accounts.length) {
      throw new LoyaltyReadError("unavailable");
    }
    result.cursor = z.string().min(1).max(2048).nullable().parse(accountsResponse.cursor ?? null);
    const customers = new Map<string, z.infer<typeof customerSchema>>();
    if (accounts.length) {
      try {
        const ids = [...new Set(accounts.map(a => a.customer_id))];
        const payload = await this.call("/v2/customers/bulk-retrieve", { customer_ids: ids });
        const responses = z.record(z.string(), z.unknown()).parse(payload.responses);
        for (const customerId of ids) {
          const parsed = z.object({ customer: customerSchema }).safeParse(responses[customerId]);
          if (parsed.success && parsed.data.customer.id === customerId) customers.set(customerId, parsed.data.customer);
        }
      } catch { /* Points remain available if customer profile access fails. */ }
    }
    result.profilesComplete = accounts.every(account => customers.has(account.customer_id));
    result.members = accounts.map(account => {
      const customer = customers.get(account.customer_id);
      const next = result.program!.rewards.find(reward => reward.points > account.balance)
        ?? result.program!.rewards.at(-1);
      return {
        id: account.id,
        name: [customer?.given_name, customer?.family_name].filter(Boolean).join(" ").trim() || "Loyalty member",
        phoneSuffix: account.mapping.phone_number.replace(/\D/g, "").slice(-4),
        points: account.balance,
        lifetimePoints: account.lifetime_points ?? null,
        birthday: loyaltyBirthday(customer?.birthday),
        enrolledAt: account.enrolled_at ?? null,
        profileAvailable: Boolean(customer),
        nextReward: next ? { name: next.name, pointsRemaining: Math.max(0, next.points - account.balance) } : null,
      };
    });
    result.checkedAt = new Date().toISOString();
    return result;
  }
}

let readinessCache: { until: number; value: Promise<LoyaltySnapshot["status"]> } | undefined;

/** Public health reads never retrieve accounts, names, phones or birthdays. */
export function churchLoyaltyReadiness(): Promise<LoyaltySnapshot["status"]> {
  if (readinessCache && readinessCache.until > Date.now()) return readinessCache.value;
  const value = (async (): Promise<LoyaltySnapshot["status"]> => {
    const config = churchSquareCountConfiguration();
    if (!config) return "not_configured";
    try { return await new ChurchSquareLoyaltyClient(config).readiness(); }
    catch (error) { return error instanceof LoyaltyReadError ? error.reason : "unavailable"; }
  })();
  // Coalesce health probes in a warm instance without caching customer data.
  readinessCache = { until: Date.now() + 60_000, value };
  return value;
}

export async function readChurchSquareLoyalty(input: { phone?: string; cursor?: string } = {}): Promise<LoyaltySnapshot> {
  const config = churchSquareCountConfiguration();
  if (!config) return emptyLoyaltySnapshot("not_configured");
  try { return await new ChurchSquareLoyaltyClient(config).read(input); }
  catch (error) { return emptyLoyaltySnapshot(error instanceof LoyaltyReadError ? error.reason : "unavailable"); }
}
