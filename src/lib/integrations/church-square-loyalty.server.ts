import "server-only";

import { z } from "zod";
import { churchSquareCountConfiguration } from "./church-square-configuration.server";
import { emptyLoyaltySnapshot, loyaltyBirthday, loyaltyPageSize, type LoyaltySnapshot } from "./church-square-loyalty";
import { SquareCountClient, type SquareCountConfiguration } from "./square-counts.server";
import { SQUARE_API_VERSION } from "./square-source";

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
