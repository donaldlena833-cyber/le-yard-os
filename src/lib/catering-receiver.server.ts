import "server-only";
import { createHash } from "node:crypto";
import {
  cateringInquirySchema,
  cateringRequestId,
  type CateringInquiry,
} from "@/lib/catering-inquiry";

type Result = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};
export interface CateringReceiverStore {
  authenticate(keyHash: string): Promise<Result>;
  capture(
    clientId: string,
    requestId: string,
    payload: CateringInquiry,
  ): Promise<Result>;
}

const json = (body: unknown, status: number) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
class InputError extends Error {
  constructor(readonly status: number) {
    super("Invalid catering input");
  }
}

async function boundedJson(request: Request) {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > 16384))
    throw new InputError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError(400);
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new InputError(413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InputError(400);
  }
}

export async function receiveCateringInquiry(
  request: Request,
  options: {
    enabled: boolean;
    store: () => CateringReceiverStore;
  },
) {
  if (!options.enabled)
    return json(
      {
        error: {
          code: "intake_disabled",
          message: "Direct catering inquiries are not available.",
        },
      },
      503,
    );
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length < 32 || token.length > 512)
    return json({ error: { code: "unauthorized" } }, 401);
  try {
    const store = options.store();
    const client = await store.authenticate(
      createHash("sha256").update(token).digest("hex"),
    );
    if (client.error)
      return json({ error: { code: "intake_unavailable" } }, 503);
    const identity = client.data as { id?: string } | null;
    if (!identity?.id || !cateringRequestId.safeParse(identity.id).success)
      return json({ error: { code: "unauthorized" } }, 401);
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("content-type") || "",
      )
    )
      return json({ error: { code: "json_required" } }, 415);
    const id = cateringRequestId.safeParse(
      request.headers.get("idempotency-key"),
    );
    if (!id.success)
      return json({ error: { code: "idempotency_key_required" } }, 400);
    const input = cateringInquirySchema.safeParse(await boundedJson(request));
    if (!input.success)
      return json(
        {
          error: {
            code: "invalid_request",
            message: "Review the catering brief.",
          },
        },
        400,
      );
    const result = await store.capture(identity.id, id.data, input.data);
    if (result.error) {
      const status =
        result.error.code === "23505"
          ? 409
          : result.error.code === "22023"
            ? 400
            : result.error.code === "28000"
              ? 401
              : result.error.code === "P0001" &&
                  result.error.message === "catering_rate_limited"
                ? 429
                : 503;
      return json(
        {
          error: {
            code:
              status === 409
                ? "idempotency_conflict"
                : status === 429
                  ? "rate_limited"
                  : "inquiry_not_confirmed",
          },
        },
        status,
      );
    }
    const saved = result.data as {
      status?: string;
      stored?: boolean;
      inquiryId?: string;
    } | null;
    if (
      saved?.status !== "accepted" ||
      saved.stored !== true ||
      !cateringRequestId.safeParse(saved.inquiryId).success
    )
      return json({ error: { code: "inquiry_not_confirmed" } }, 503);
    // This proves a committed record only. No email, subscriber, booking or order action.
    return json(
      {
        data: { status: "accepted", stored: true, inquiryId: saved.inquiryId },
      },
      201,
    );
  } catch (error) {
    return json(
      {
        error: {
          code:
            error instanceof InputError
              ? "invalid_request"
              : "inquiry_not_confirmed",
        },
      },
      error instanceof InputError ? error.status : 503,
    );
  }
}
