import "server-only";

import { z } from "zod";
import { churchSquareOrderConfiguration } from "./church-square-orders.server";
import { churchSquareResourceId } from "./church-square-order-projection";
import { churchSquarePayoutWindowDays, churchSquarePayoutWindowLimit } from "./church-square-payout-window";
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
const payoutMoney = z.object({
  amount: z.number().int().safe().refine((amount) => amount !== 0),
  currency: z.literal("USD").optional(),
  currency_code: z.literal("USD").optional(),
}).refine((money) => Boolean(money.currency ?? money.currency_code));
const payoutSchema = z.object({
  id: churchSquareResourceId,
  location_id: scopeId,
  status: z.string().regex(/^[A-Z][A-Z0-9_]{0,49}$/).nullish(),
  created_at: instant,
  updated_at: instant.nullish(),
  arrival_date: z.iso.date().nullish(),
  amount_money: payoutMoney.nullish(),
});

const pageSchema = z.object({
  payouts: z.array(payoutSchema).max(churchSquarePayoutWindowLimit).optional(),
  cursor: cursor.optional(),
  errors: z.array(z.unknown()).optional(),
});
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

async function readPayoutPage(response: Response) {
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
    const parsed = pageSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
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

  /** Read one page by payout creation time. Follow cursors only with the original bounds. */
  async listPayouts(input: ChurchSquarePayoutWindow): Promise<{ payouts: ChurchSquarePayout[]; nextCursor: string | null }> {
    const parsed = windowSchema.safeParse(input);
    if (!parsed.success) throw new ChurchSquarePayoutReadError("A bounded Square payout window is required.", "invalid_input");
    const { from, to, cursor } = parsed.data;
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (end <= start || end - start > churchSquarePayoutWindowDays * 86_400_000 || end > Date.now()) {
      throw new ChurchSquarePayoutReadError("Use an elapsed Square payout window of up to seven days.", "invalid_input");
    }

    const deadline = AbortSignal.timeout(15_000);
    try {
      await this.scopeClient.verifyScope(deadline);
    } catch (error) {
      if (error instanceof SquareCountError && error.code === "scope_mismatch") {
        throw new ChurchSquarePayoutReadError("Square did not verify the approved Church Street merchant and location.", "scope_mismatch");
      }
      throw new ChurchSquarePayoutReadError("Square scope verification is unavailable.", "provider_unavailable");
    }

    const query = new URLSearchParams({
      location_id: this.config.locationId,
      begin_time: from,
      end_time: to,
      sort_order: "DESC",
      limit: String(churchSquarePayoutWindowLimit),
      ...(cursor ? { cursor } : {}),
    });
    let response: Response;
    try {
      response = await this.request(`${origins[this.config.environment]}/v2/payouts?${query}`, {
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
      throw new ChurchSquarePayoutReadError("Square declined the payout read request.", "provider_unavailable", response.status);
    }

    const page = await readPayoutPage(response);
    if (cursor && page.cursor === cursor) {
      throw new ChurchSquarePayoutReadError("Square returned a repeated payout cursor.", "invalid_response");
    }
    const seen = new Set<string>();
    const payouts = (page.payouts ?? []).map((payout): ChurchSquarePayout => {
      if (payout.location_id !== this.config.locationId) {
        throw new ChurchSquarePayoutReadError("Square returned a payout outside Church Street.", "scope_mismatch");
      }
      const createdAt = Date.parse(payout.created_at);
      if (createdAt < start || createdAt > end || seen.has(payout.id)) {
        throw new ChurchSquarePayoutReadError("Square returned a duplicate or out-of-window payout.", "invalid_response");
      }
      seen.add(payout.id);
      const status = payout.status;
      return {
        id: payout.id,
        status: status === "SENT" || status === "FAILED" || status === "PAID" ? status : "UNKNOWN",
        amountCents: payout.amount_money?.amount ?? null,
        createdAt: payout.created_at,
        updatedAt: payout.updated_at ?? null,
        arrivalDate: payout.arrival_date ?? null,
      };
    });
    payouts.sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt) || first.id.localeCompare(second.id));
    return { payouts, nextCursor: page.cursor || null };
  }
}
