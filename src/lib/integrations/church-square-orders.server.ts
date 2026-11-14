import "server-only";

import { z } from "zod";
import { appSurface } from "@/lib/app-surface";
import { SquareCountClient, SquareCountError } from "./square-counts.server";
import { SQUARE_API_VERSION } from "./square-source";
import {
  churchSquareResourceId,
  churchSquareResourceKind,
  projectChurchSquareResource,
  type ChurchSquareInvoice,
  type ChurchSquareOrder,
  type ChurchSquarePayment,
  type ChurchSquareRefund,
  type ChurchSquareResource,
  type ChurchSquareResourceKind,
} from "./church-square-order-projection";

const configuration = z.strictObject({
  environment: z.enum(["sandbox", "production"]),
  accessToken: z.string().trim().regex(/^[!-~]{1,4096}$/),
  merchantId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  locationId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
});

const windowSchema = z.strictObject({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  cursor: z.string().min(1).max(4096).optional(),
  direction: z.enum(["ASC", "DESC"]).optional(),
});

const envelopeSchema = z.object({ errors: z.array(z.unknown()).optional() }).passthrough();
const searchSchema = z.object({
  orders: z.array(z.unknown()).max(100).optional(),
  cursor: z.string().max(4096).optional(),
});

const origins = { production: "https://connect.squareup.com", sandbox: "https://connect.squareupsandbox.com" } as const;
const paths = { order: "orders", payment: "payments", refund: "refunds", invoice: "invoices" } as const;
const maximumResponseBytes = 4 * 1024 * 1024;
const maximumSearchWindowMs = 7 * 24 * 60 * 60 * 1000;
const churchAddress = { street: "140 Church Street", postalCode: "10007", country: "US" } as const;

type ClientConfig = z.infer<typeof configuration>;
export type ChurchSquareOrderConfiguration = z.input<typeof configuration>;
export type ChurchSquareOrderWindow = z.input<typeof windowSchema>;
type ErrorCode = "invalid_input" | "scope_mismatch" | "provider_unavailable" | "invalid_response" | "response_too_large";

export class ChurchSquareOrderReadError extends Error {
  constructor(message: string, readonly code: ErrorCode, readonly status?: number) {
    super(message);
    this.name = "ChurchSquareOrderReadError";
  }
}

export function churchSquareOrderConfiguration(): ChurchSquareOrderConfiguration | undefined {
  if (appSurface !== "operations" || process.env.VERCEL_ENV !== "production"
    || process.env.LE_YARD_CHURCH_SQUARE_ORDER_READ_ENABLED?.trim() !== "true") return undefined;
  const result = configuration.safeParse({
    environment: "production",
    accessToken: process.env.SQUARE_CHURCH_ACCESS_TOKEN,
    merchantId: process.env.SQUARE_CHURCH_MERCHANT_ID?.trim(),
    locationId: process.env.SQUARE_CHURCH_LOCATION_ID?.trim(),
  });
  return result.success ? result.data : undefined;
}

async function readBounded(response: Response) {
  if (!response.body) throw new ChurchSquareOrderReadError("Square returned an empty response.", "invalid_response");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const entry = await reader.read();
      if (entry.done) break;
      bytes += entry.value.byteLength;
      if (bytes > maximumResponseBytes) {
        throw new ChurchSquareOrderReadError("Square response exceeded the allowable size.", "response_too_large");
      }
      chunks.push(entry.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof ChurchSquareOrderReadError) throw error;
    throw new ChurchSquareOrderReadError("Square returned an unreadable response.", "invalid_response");
  } finally {
    reader.releaseLock();
  }
}

/**
 * Keep this client per worker run or request. The identity proof is shared
 * only by operations performed by one client instance.
 */
export class ChurchSquareOrderClient {
  private readonly config: ClientConfig;
  private readonly scopeClient: SquareCountClient;
  private verifiedScope?: Promise<void>;

  constructor(config: ChurchSquareOrderConfiguration, private readonly request: typeof fetch = fetch) {
    const parsed = configuration.safeParse(config);
    if (!parsed.success) {
      throw new ChurchSquareOrderReadError("An exact Square merchant and location configuration is required.", "invalid_input");
    }
    this.config = parsed.data;
    this.scopeClient = new SquareCountClient({
      ...this.config,
      currency: "USD",
      timeZone: "America/New_York",
      ...(this.config.environment === "production" ? { address: churchAddress } : {}),
    }, request);
  }

  private verifyScope() {
    this.verifiedScope ??= this.scopeClient.verifyScope().catch(error => {
      this.verifiedScope = undefined;
      const scoped = error instanceof SquareCountError && error.code === "scope_mismatch";
      throw new ChurchSquareOrderReadError(
        scoped ? "Square did not verify the approved Church Street account and location."
          : "Square location verification is unavailable.",
        scoped ? "scope_mismatch" : "provider_unavailable",
        error instanceof SquareCountError ? error.status : undefined,
      );
    });
    return this.verifiedScope;
  }

  private async call(path: string, search?: object) {
    let response: Response;
    try {
      response = await this.request(origins[this.config.environment] + path, {
        method: search ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          "Square-Version": SQUARE_API_VERSION,
          accept: "application/json",
          ...(search ? { "content-type": "application/json" } : {}),
        },
        ...(search ? { body: JSON.stringify(search) } : {}),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ChurchSquareOrderReadError("Square did not respond to the read request.", "provider_unavailable");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new ChurchSquareOrderReadError("Square declined the read request.", "provider_unavailable", response.status);
    }
    const parsed = envelopeSchema.safeParse(await readBounded(response));
    if (!parsed.success || parsed.data.errors?.length) {
      throw new ChurchSquareOrderReadError("Square returned errors or an invalid response.", "invalid_response");
    }
    return parsed.data;
  }

  async get(kind: "order", id: string): Promise<ChurchSquareOrder>;
  async get(kind: "payment", id: string): Promise<ChurchSquarePayment>;
  async get(kind: "refund", id: string): Promise<ChurchSquareRefund>;
  async get(kind: "invoice", id: string): Promise<ChurchSquareInvoice>;
  async get(kind: ChurchSquareResourceKind, id: string): Promise<ChurchSquareResource>;
  async get(kind: ChurchSquareResourceKind, id: string): Promise<ChurchSquareResource> {
    if (!churchSquareResourceKind.safeParse(kind).success || !churchSquareResourceId.safeParse(id).success) {
      throw new ChurchSquareOrderReadError("A supported resource type and Square ID are required.", "invalid_input");
    }
    await this.verifyScope();
    const envelope = await this.call(`/v2/${paths[kind]}/${encodeURIComponent(id)}`);
    return projectChurchSquareResource(kind, envelope[kind], { locationId: this.config.locationId, id });
  }

  /** One reconciliation page. Keep the window and direction unchanged while following nextCursor. */
  async searchOrders(input: ChurchSquareOrderWindow): Promise<{ orders: ChurchSquareOrder[]; nextCursor: string | null }> {
    const parsed = windowSchema.safeParse(input);
    if (!parsed.success) throw new ChurchSquareOrderReadError("A reconciliation window is required.", "invalid_input");
    const { from, to, cursor, direction = "ASC" } = parsed.data;
    const fromMs = Date.parse(from), toMs = Date.parse(to);
    if (toMs <= fromMs || toMs - fromMs > maximumSearchWindowMs || toMs > Date.now() + 60_000) {
      throw new ChurchSquareOrderReadError("Use an elapsed Square reconciliation window of no more than seven days.", "invalid_input");
    }
    await this.verifyScope();
    const envelope = await this.call("/v2/orders/search", {
      location_ids: [this.config.locationId],
      return_entries: false,
      limit: 50,
      query: {
        filter: { date_time_filter: { updated_at: { start_at: from, end_at: to } } },
        sort: { sort_field: "UPDATED_AT", sort_order: direction },
      },
      ...(cursor ? { cursor } : {}),
    });
    const page = searchSchema.safeParse(envelope);
    if (!page.success || cursor && page.data.cursor === cursor) {
      throw new ChurchSquareOrderReadError("Square returned an invalid or repeated reconciliation page.", "invalid_response");
    }
    const orders = (page.data.orders ?? []).map(order => projectChurchSquareResource("order", order, {
      locationId: this.config.locationId,
    }));
    if (orders.some(record => Date.parse(record.updatedAt) < fromMs || Date.parse(record.updatedAt) > toMs)) {
      throw new ChurchSquareOrderReadError("Square returned an order outside the reconciliation window.", "invalid_response");
    }
    return { orders, nextCursor: page.data.cursor || null };
  }
}
