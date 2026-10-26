import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parseSquareSource, SQUARE_API_VERSION, type SquareSourceSnapshot } from "./square-source";

const reference = z.string().regex(/^[A-Za-z0-9_-]{1,192}$/);
const configSchema = z.object({
  environment: z.enum(["sandbox", "production"]), accessToken: z.string().trim().min(1).max(4096),
  merchantId: reference, locationId: reference, currency: z.string().regex(/^[A-Z]{3}$/),
  timeZone: z.string().min(1).max(100),
});
export type SquareReadConfiguration = z.infer<typeof configSchema>;
const hosts = { sandbox: "https://connect.squareupsandbox.com", production: "https://connect.squareup.com" } as const;
const pageSchema = z.object({ cursor: z.string().min(1).max(4096).optional(), errors: z.array(z.unknown()).optional() });
const MAX_PAGES = 100;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_WINDOW_BYTES = 32 * 1024 * 1024;
export class SquareReadError extends Error {
  constructor(message: string, readonly status: number | null = null) { super(message); this.name = "SquareReadError"; }
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}
export function squareSourceHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

export function verifySquareWebhookSignature(input: { notificationUrl: string; signatureKey: string; rawBody: Uint8Array; signature: string | null }): boolean {
  if (!input.signatureKey || !input.signature || !/^[A-Za-z0-9+/]{43}=$/.test(input.signature)) return false;
  const url = new URL(input.notificationUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new SquareReadError("An exact HTTPS Square notification URL is required.");
  const expected = createHmac("sha256", input.signatureKey).update(input.notificationUrl).update(input.rawBody).digest();
  const received = Buffer.from(input.signature, "base64");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export class SquareReadClient {
  private readonly configuration: SquareReadConfiguration;
  private readonly baseUrl: string;
  constructor(configuration: SquareReadConfiguration, private readonly request: typeof fetch = fetch) {
    this.configuration = configSchema.parse(configuration);
    new Intl.DateTimeFormat("en-US", { timeZone: this.configuration.timeZone });
    this.baseUrl = hosts[this.configuration.environment];
  }
  private async read(path: string, body?: object): Promise<Record<string, unknown>> {
    // These fixed call sites are read endpoints. POST is used only by SearchOrders.
    if (!(path.startsWith("/v2/payments?") || path.startsWith("/v2/refunds?") || /^\/v2\/(merchants|locations)\/[A-Za-z0-9_-]+$/.test(path) || path === "/v2/orders/search")) throw new SquareReadError("Square read endpoint is not allowed.");
    const response = await this.request(this.baseUrl + path, {
      method: body ? "POST" : "GET", headers: { authorization: `Bearer ${this.configuration.accessToken}`,
        "Square-Version": SQUARE_API_VERSION, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new SquareReadError(`Square read request failed (${response.status}).`, response.status); }
    const reader = response.body?.getReader();
    if (!reader) throw new SquareReadError("Square read response body is missing.");
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength;
        if (bytes > MAX_BYTES) throw new SquareReadError("Square response exceeds the bounded source page size."); chunks.push(item.value); }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SquareReadError("Square response must be an object.");
    const envelope = pageSchema.parse(parsed);
    if (envelope.errors?.length) throw new SquareReadError("Square returned source errors; no complete window is accepted.");
    return parsed as Record<string, unknown>;
  }
  async verifyScope(): Promise<void> {
    const merchant = z.object({ id: reference, country: z.string(), currency: z.string().optional(), status: z.string().optional() }).parse((await this.read(`/v2/merchants/${this.configuration.merchantId}`)).merchant);
    const location = z.object({ id: reference, merchant_id: reference, status: z.string(), currency: z.string(), timezone: z.string() }).parse((await this.read(`/v2/locations/${this.configuration.locationId}`)).location);
    if (merchant.id !== this.configuration.merchantId || location.id !== this.configuration.locationId || location.merchant_id !== merchant.id || location.status !== "ACTIVE" || location.currency !== this.configuration.currency || location.timezone !== this.configuration.timeZone || (merchant.currency && merchant.currency !== this.configuration.currency) || (merchant.status && merchant.status !== "ACTIVE")) throw new SquareReadError("Square account/location does not match the approved scope.");
  }
  async readWindow(from: string, to: string): Promise<SquareSourceSnapshot[]> {
    const begin = z.iso.datetime({ offset: true }).parse(from), end = z.iso.datetime({ offset: true }).parse(to);
    const startMs = Date.parse(begin), endMs = Date.parse(end);
    if (endMs <= startMs || endMs - startMs > 31 * 86400000 || endMs > Date.now() + 60000) throw new SquareReadError("Square source window must be a bounded elapsed range of at most31 days.");
    await this.verifyScope();
    const snapshots = new Map<string, SquareSourceSnapshot>(); let retainedBytes = 0;
    for (const kind of ["order", "payment", "refund"] as const) {
      let cursor: string | undefined; const cursors = new Set<string>();
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw new SquareReadError("Square pagination is incomplete; source watermark must not advance.");
        const result = kind === "order" ? await this.read("/v2/orders/search", {
          location_ids: [this.configuration.locationId], limit: 100, return_entries: false,
          query: { filter: { date_time_filter: { updated_at: { start_at: begin, end_at: end } } }, sort: { sort_field: "UPDATED_AT", sort_order: "ASC" } }, ...(cursor ? { cursor } : {}),
        }) : await this.read(`/v2/${kind === "payment" ? "payments" : "refunds"}?` + new URLSearchParams({
          location_id: this.configuration.locationId, limit: "100", sort_field: "UPDATED_AT", sort_order: "ASC",
          // Override the API's default one-year created-at bound, retaining late changes to older sales.
          begin_time: "1970-01-01T00:00:00.000Z", end_time: end,
          updated_at_begin_time: begin, updated_at_end_time: end, ...(cursor ? { cursor } : {}),
        }));
        const field = kind === "order" ? "orders" : kind === "payment" ? "payments" : "refunds";
        const rows = result[field] === undefined ? [] : z.array(z.unknown()).max(1000).parse(result[field]);
        for (const row of rows) {
          const snapshot = parseSquareSource(kind, row, this.configuration), updated = Date.parse(snapshot.sourceUpdatedAt);
          if (updated < startMs || updated > endMs) throw new SquareReadError("Square returned source facts outside the requested update window.");
          const key = `${kind}:${snapshot.externalId}:${snapshot.objectVersion ?? snapshot.sourceUpdatedAt}`;
          const prior = snapshots.get(key);
          if (prior && squareSourceHash(prior.facts) !== squareSourceHash(snapshot.facts)) throw new SquareReadError("Square returned conflicting facts for one source version.");
          if (!prior) retainedBytes += Buffer.byteLength(JSON.stringify(snapshot));
          snapshots.set(key, snapshot);
          if (snapshots.size > 10000 || retainedBytes > MAX_WINDOW_BYTES) throw new SquareReadError("Square source window exceeds bounded capacity; narrow the window without advancing its watermark.");
        }
        cursor = pageSchema.parse(result).cursor;
        if (!cursor) break;
        if (cursors.has(cursor)) throw new SquareReadError("Square repeated a pagination cursor; source window is incomplete.");
        cursors.add(cursor);
      }
    }
    return [...snapshots.values()];
  }
}
