import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

const toastReferenceSchema = z.object({
  guid: z.string().min(1),
  externalId: z.string().min(1).nullish(),
});

const toastEmployeeSchema = toastReferenceSchema.extend({
  externalEmployeeId: z.string().min(1).nullish(),
  email: z.string().nullish(),
  deleted: z.boolean().optional(),
});

const toastJobSchema = toastReferenceSchema.extend({
  title: z.string().min(1),
  deleted: z.boolean().optional(),
});

const toastBreakSchema = z.object({
  guid: z.string().min(1),
  paid: z.boolean().optional(),
  inDate: z.string().min(1),
  outDate: z.string().nullish(),
  missed: z.boolean().optional(),
});

const toastTimeEntrySchema = toastReferenceSchema.extend({
  modifiedDate: z.string().min(1),
  deletedDate: z.string().nullish(),
  deleted: z.boolean().optional(),
  employeeReference: toastReferenceSchema,
  jobReference: toastReferenceSchema,
  inDate: z.string().min(1),
  outDate: z.string().nullish(),
  autoClockedOut: z.boolean().optional(),
  breaks: z.array(toastBreakSchema).optional(),
});

const authenticationSchema = z.object({
  status: z.string(),
  token: z.object({
    accessToken: z.string().min(1),
  }),
});

export type ToastEmployee = z.infer<typeof toastEmployeeSchema>;
export type ToastJob = z.infer<typeof toastJobSchema>;
export type ToastTimeEntry = z.infer<typeof toastTimeEntrySchema>;

export interface ToastLaborConfiguration {
  clientId: string;
  clientSecret: string;
  restaurantGuid: string;
  baseUrl?: string;
}

const allowedBaseUrls = new Set([
  "https://ws-api.toasttab.com",
  "https://ws-sandbox-api.toasttab.com",
]);

export function requireToastLaborConfiguration(): ToastLaborConfiguration {
  const clientId = process.env.TOAST_CLIENT_ID?.trim();
  const clientSecret = process.env.TOAST_CLIENT_SECRET?.trim();
  const restaurantGuid = process.env.TOAST_RESTAURANT_GUID?.trim();
  const requestedBaseUrl =
    process.env.TOAST_API_BASE_URL?.trim() || "https://ws-api.toasttab.com";
  if (!clientId || !clientSecret || !restaurantGuid) {
    throw new Error("Toast Labor API configuration is unavailable.");
  }
  if (!allowedBaseUrls.has(requestedBaseUrl)) {
    throw new Error("Toast Labor API host is not allowed.");
  }
  return { clientId, clientSecret, restaurantGuid, baseUrl: requestedBaseUrl };
}

export class ToastLaborApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "ToastLaborApiError";
  }
}

function timeoutSignal() {
  return AbortSignal.timeout(15_000);
}

async function readJson(response: Response) {
  if (!response.ok) {
    throw new ToastLaborApiError(
      `Toast Labor API request failed (${response.status}).`,
      response.status,
      response.headers.get("x-request-id"),
    );
  }
  return response.json() as Promise<unknown>;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function toastTimeEntryPayloadHash(entry: ToastTimeEntry) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(entry)), "utf8")
    .digest("hex");
}

export class ToastLaborClient {
  private readonly baseUrl: string;

  constructor(
    private readonly configuration: ToastLaborConfiguration,
    private readonly request: typeof fetch = fetch,
  ) {
    const baseUrl = configuration.baseUrl ?? "https://ws-api.toasttab.com";
    if (!allowedBaseUrls.has(baseUrl)) {
      throw new Error("Toast Labor API host is not allowed.");
    }
    this.baseUrl = baseUrl;
  }

  private async accessToken() {
    const response = await this.request(
      `${this.baseUrl}/authentication/v1/authentication/login`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: this.configuration.clientId,
          clientSecret: this.configuration.clientSecret,
          userAccessType: "TOAST_MACHINE_CLIENT",
        }),
        cache: "no-store",
        signal: timeoutSignal(),
      },
    );
    const parsed = authenticationSchema.parse(await readJson(response));
    if (parsed.status !== "SUCCESS") {
      throw new ToastLaborApiError("Toast authentication failed.", 502, null);
    }
    return parsed.token.accessToken;
  }

  private async laborGet(path: string, accessToken: string) {
    const response = await this.request(`${this.baseUrl}/labor/v1${path}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "Toast-Restaurant-External-ID": this.configuration.restaurantGuid,
      },
      cache: "no-store",
      signal: timeoutSignal(),
    });
    return readJson(response);
  }

  async readModifiedTimeEntries(start: Date, end: Date) {
    const rangeMs = end.getTime() - start.getTime();
    if (!Number.isFinite(rangeMs) || rangeMs <= 0 || rangeMs > 31 * 86_400_000) {
      throw new Error("Toast time-entry sync window must be between zero and 31 days.");
    }

    const accessToken = await this.accessToken();
    const params = new URLSearchParams({
      modifiedStartDate: start.toISOString(),
      modifiedEndDate: end.toISOString(),
      includeMissedBreaks: "false",
    });
    const [employees, jobs, timeEntries] = await Promise.all([
      this.laborGet("/employees", accessToken),
      this.laborGet("/jobs", accessToken),
      this.laborGet(`/timeEntries?${params.toString()}`, accessToken),
    ]);

    return {
      employees: z.array(toastEmployeeSchema).parse(employees),
      jobs: z.array(toastJobSchema).parse(jobs),
      timeEntries: z.array(toastTimeEntrySchema).parse(timeEntries),
    };
  }
}
