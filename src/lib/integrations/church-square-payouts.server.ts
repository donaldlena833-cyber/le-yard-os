import "server-only";

import { z } from "zod";
import { churchSquareOrderConfiguration } from "./church-square-orders.server";
import { churchSquareResourceId } from "./church-square-order-projection";
import { churchSquarePayoutEntryLimit, churchSquarePayoutWindowDays, churchSquarePayoutWindowLimit } from "./church-square-payout-window";
import { SquareCountClient, SquareCountError } from "./square-counts.server";
import { SQUARE_API_VERSION } from "./square-source";

const scopeId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const configuration = z.strictObject({
  environment: z.enum(["sandbox", "production"]),
  accessToken: z.string().trim().regex(/^[!-~]{1,4096}$/),
  merchantId: scopeId,
  locationId: scopeId,
});
const instant = z.iso.datetime({ offset: true }).max(40);
const cursor = z.string().max(4096).regex(/^[^\p{Cc}\p{Cf}]*$/u);
const windowSchema = z.strictObject({ from: instant, to: instant, cursor: cursor.min(1).optional() });
const providerType = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullish();
const moneySchema = z.object({
  amount: z.number().int().safe(),
  currency: z.literal("USD").optional(),
  currency_code: z.literal("USD").optional(),
}).refine((money) => Boolean(money.currency ?? money.currency_code));
const payoutMoney = moneySchema.refine(({ amount }) => amount !== 0);
const payoutSchema = z.object({
  id: churchSquareResourceId,
  location_id: scopeId,
  status: z.string().regex(/^[A-Z][A-Z0-9_]{0,49}$/).nullish(),
  created_at: instant,
  updated_at: instant.nullish(),
  arrival_date: z.iso.date().nullish(),
  amount_money: payoutMoney.nullish(),
});

const envelopeSchema = z.object({ errors: z.array(z.unknown()).optional() });
const pageSchema = envelopeSchema.extend({
  payouts: z.array(payoutSchema).max(churchSquarePayoutWindowLimit).optional(),
  cursor: cursor.optional(),
});
const detailSchema = envelopeSchema.extend({ payout: payoutSchema.extend({ type: providerType }) });
const entrySchema = z.object({
  id: churchSquareResourceId,
  payout_id: churchSquareResourceId,
  type: providerType,
  effective_at: instant.nullish(),
  gross_amount_money: moneySchema.nullish(),
  fee_amount_money: moneySchema.nullish(),
  net_amount_money: moneySchema.nullish(),
  type_charge_details: z.unknown().optional(),
  type_refund_details: z.unknown().optional(),
});
const chargeDetails = z.object({ payment_id: churchSquareResourceId });
const refundDetails = z.object({ refund_id: churchSquareResourceId, payment_id: churchSquareResourceId.nullish() });
const entriesSchema = envelopeSchema.extend({
  payout_entries: z.array(entrySchema).max(churchSquarePayoutEntryLimit).optional(),
  cursor: cursor.optional(),
});
const windowMilliseconds = churchSquarePayoutWindowDays * 86_400_000;
const maximumBodyBytes = 1024 * 1024;
const origins = { production: "https://connect.squareup.com", sandbox: "https://connect.squareupsandbox.com" } as const;

export type ChurchSquarePayoutConfiguration = z.input<typeof configuration>;
export type ChurchSquarePayoutWindow = z.input<typeof windowSchema>;
export type ChurchSquarePayout = {
  id: string;
  status: "SENT" | "FAILED" | "PAID" | "UNKNOWN";
  amountCents: number | null;
  createdAt: string;
  updatedAt: string | null;
  arrivalDate: string | null;
};
type PayoutTransaction = { kind: "charge"; paymentId: string }
  | { kind: "refund"; refundId: string; paymentId: string | null };
export type ChurchSquarePayoutEntries = {
  payout: ChurchSquarePayout & { payoutType: "BATCH" | "SIMPLE" | "UNKNOWN" };
  entries: {
    reference: string;
    type: string | null;
    effectiveAt: string | null;
    grossCents: number | null;
    feeCents: number | null;
    netCents: number | null;
    /** Exact provider IDs for server-side lookup. Keep these out of public response projections. */
    transaction?: PayoutTransaction;
  }[];
  hasMore: boolean;
};

type ErrorCode = "invalid_input" | "scope_mismatch" | "provider_unavailable" | "invalid_response" | "response_too_large";

export class ChurchSquarePayoutReadError extends Error {
  constructor(message: string, readonly code: ErrorCode, readonly status?: number) {
    super(message);
    this.name = "ChurchSquarePayoutReadError";
  }
}

export function churchSquarePayoutConfiguration(): ChurchSquarePayoutConfiguration | undefined {
  return churchSquareOrderConfiguration();
}

async function readPayoutResponse<T extends { errors?: unknown[] }>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.body) throw new ChurchSquarePayoutReadError("Square returned an empty payout response.", "invalid_response");

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBodyBytes) {
        throw new ChurchSquarePayoutReadError("Square returned an oversized payout response.", "response_too_large");
      }
      chunks.push(value);
    }
    const parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
    if (!parsed.success || parsed.data.errors?.length) {
      throw new ChurchSquarePayoutReadError("Square returned an invalid payout response.", "invalid_response");
    }
    return parsed.data;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ChurchSquarePayoutReadError) throw error;
    throw new ChurchSquarePayoutReadError("Square returned an unreadable payout response.", "invalid_response");
  } finally {
    reader.releaseLock();
  }
}

function projectPayout(payout: z.infer<typeof payoutSchema>): ChurchSquarePayout {
  const status = payout.status;
  return {
    id: payout.id,
    status: status === "SENT" || status === "FAILED" || status === "PAID" ? status : "UNKNOWN",
    amountCents: payout.amount_money?.amount ?? null,
    createdAt: payout.created_at,
    updatedAt: payout.updated_at ?? null,
    arrivalDate: payout.arrival_date ?? null,
  };
}

function projectPayoutTransaction(entry: z.infer<typeof entrySchema>): PayoutTransaction | undefined {
  if (entry.type === "CHARGE") {
    const result = chargeDetails.safeParse(entry.type_charge_details);
    if (result.success) return { kind: "charge", paymentId: result.data.payment_id };
  }
  if (entry.type === "REFUND") {
    const result = refundDetails.safeParse(entry.type_refund_details);
    if (result.success) return { kind: "refund", refundId: result.data.refund_id, paymentId: result.data.payment_id ?? null };
  }
}

export class ChurchSquarePayoutClient {
  private readonly config: ChurchSquarePayoutConfiguration;
  private readonly scopeClient: SquareCountClient;

  constructor(config: ChurchSquarePayoutConfiguration, private readonly request: typeof fetch = fetch) {
    const parsed = configuration.safeParse(config);
    if (!parsed.success) {
      throw new ChurchSquarePayoutReadError("An exact Church Street Square merchant and location are required.", "invalid_input");
    }
    this.config = parsed.data;
    this.scopeClient = new SquareCountClient({
      ...this.config,
      currency: "USD",
      timeZone: "America/New_York",
      ...(this.config.environment === "production" ? {
        address: { street: "140 Church Street", postalCode: "10007", country: "US" },
      } : {}),
    }, request);
  }

  private async verifyScope(deadline: AbortSignal) {
    try {
      await this.scopeClient.verifyScope(deadline);
    } catch (error) {
      if (error instanceof SquareCountError && error.code === "scope_mismatch") {
        throw new ChurchSquarePayoutReadError("Square did not verify the approved Church Street merchant and location.", "scope_mismatch");
      }
      throw new ChurchSquarePayoutReadError("Square scope verification is unavailable.", "provider_unavailable");
    }
  }

  private async get(path: string, deadline: AbortSignal, allowMissing: true): Promise<Response | null>;
  private async get(path: string, deadline: AbortSignal): Promise<Response>;
  private async get(path: string, deadline: AbortSignal, allowMissing = false): Promise<Response | null> {
    let response: Response;
    try {
      response = await this.request(`${origins[this.config.environment]}${path}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          "Square-Version": SQUARE_API_VERSION,
          accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: deadline,
      });
    } catch {
      throw new ChurchSquarePayoutReadError("Square payout transport is unavailable.", "provider_unavailable");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (allowMissing && response.status === 404) return null;
      throw new ChurchSquarePayoutReadError("Square declined the payout read request.", "provider_unavailable", response.status);
    }
    return response;
  }

  /** Read one page by payout creation time. Follow cursors only with the original bounds. */
  async listPayouts(input: ChurchSquarePayoutWindow): Promise<{ payouts: ChurchSquarePayout[]; nextCursor: string | null }> {
    const parsed = windowSchema.safeParse(input);
    if (!parsed.success) throw new ChurchSquarePayoutReadError("A bounded Square payout window is required.", "invalid_input");
    const { from, to, cursor } = parsed.data;
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (end <= start || end - start > windowMilliseconds || end > Date.now()) {
      throw new ChurchSquarePayoutReadError("Use an elapsed Square payout window of up to seven days.", "invalid_input");
    }

    const deadline = AbortSignal.timeout(15_000);
    await this.verifyScope(deadline);
    const query = new URLSearchParams({
      location_id: this.config.locationId,
      begin_time: from,
      end_time: to,
      sort_order: "DESC",
      limit: String(churchSquarePayoutWindowLimit),
      ...(cursor ? { cursor } : {}),
    });
    const response = await this.get(`/v2/payouts?${query}`, deadline);

    const page = await readPayoutResponse(response, pageSchema);
    if (cursor && page.cursor === cursor) {
      throw new ChurchSquarePayoutReadError("Square returned a repeated payout cursor.", "invalid_response");
    }
    const seen = new Set<string>();
    const payouts = (page.payouts ?? []).map((payout) => {
      if (payout.location_id !== this.config.locationId) {
        throw new ChurchSquarePayoutReadError("Square returned a payout outside Church Street.", "scope_mismatch");
      }
      const createdAt = Date.parse(payout.created_at);
      if (createdAt < start || createdAt > end || seen.has(payout.id)) {
        throw new ChurchSquarePayoutReadError("Square returned a duplicate or out-of-window payout.", "invalid_response");
      }
      seen.add(payout.id);
      return projectPayout(payout);
    });
    payouts.sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt) || first.id.localeCompare(second.id));
    return { payouts, nextCursor: page.cursor || null };
  }

  async getPayoutEntries(payoutId: string): Promise<ChurchSquarePayoutEntries | null> {
    if (!churchSquareResourceId.safeParse(payoutId).success) {
      throw new ChurchSquarePayoutReadError("An exact Square payout ID is required.", "invalid_input");
    }

    const now = Date.now();
    const deadline = AbortSignal.timeout(15_000);
    await this.verifyScope(deadline);
    const path = `/v2/payouts/${encodeURIComponent(payoutId)}`;
    const response = await this.get(path, deadline, true);
    if (!response) return null;

    const { payout } = await readPayoutResponse(response, detailSchema);
    if (payout.id !== payoutId) {
      throw new ChurchSquarePayoutReadError("Square did not return the requested payout.", "scope_mismatch");
    }
    const createdAt = Date.parse(payout.created_at);
    if (payout.location_id !== this.config.locationId || createdAt < now - windowMilliseconds || createdAt > now) return null;
    const payoutType = payout.type === "BATCH" || payout.type === "SIMPLE" ? payout.type : "UNKNOWN";
    const detail: ChurchSquarePayoutEntries["payout"] = { ...projectPayout(payout), payoutType };
    // SIMPLE transfers have no component entries. Square books the transfer in a later BATCH.
    if (payoutType === "SIMPLE") return { payout: detail, entries: [], hasMore: false };

    const query = new URLSearchParams({ sort_order: "DESC", limit: String(churchSquarePayoutEntryLimit) });
    const page = await readPayoutResponse(await this.get(`${path}/payout-entries?${query}`, deadline), entriesSchema);
    const seen = new Set<string>();
    const entries = (page.payout_entries ?? []).map((entry) => {
      if (entry.payout_id !== payoutId || seen.has(entry.id)) {
        throw new ChurchSquarePayoutReadError("Square returned duplicate or unrelated payout entries.", "scope_mismatch");
      }
      seen.add(entry.id);
      const transaction = projectPayoutTransaction(entry);
      return {
        reference: entry.id,
        type: entry.type ?? null,
        effectiveAt: entry.effective_at ?? null,
        grossCents: entry.gross_amount_money?.amount ?? null,
        feeCents: entry.fee_amount_money?.amount ?? null,
        netCents: entry.net_amount_money?.amount ?? null,
        ...(transaction === undefined ? {} : { transaction }),
      };
    });
    return { payout: detail, entries, hasMore: Boolean(page.cursor) };
  }
}
