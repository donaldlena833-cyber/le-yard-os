import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPushSubscription } from "@/lib/notifications/push-subscription";

const pushClaimLimit = 8;
const pushLeaseSeconds = 120;
const pushProviderTimeoutMs = 10_000;
const pushAttemptLimit = 5;

type ClaimedPush = {
  id: string;
  claimToken: string;
  organizationId: string;
  notificationId: string;
  subscriptionId: string;
  attempts: number;
  deliveryTopic: string;
};

type DispatchingPush = {
  status: "dispatching";
  attempts: number;
  encryptedSubscription: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  entityId: string | null;
  deliveryTopic: string;
};

type PushRpcResult = {
  data: unknown;
  error: { code?: string } | null;
};

type PushRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<PushRpcResult>;

type PushCounters = {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
  uncertain: number;
  completionErrors: number;
  deferred: number;
};

function authorized(request: Request) {
  const expected = process.env.RESERVATION_DELIVERY_SECRET?.trim();
  const provided = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  if (!expected || !provided || expected.length < 32) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function encryptedBuffer(value: string) {
  const normalized = value.startsWith("\\x") ? value.slice(2) : value;
  if (
    normalized.length < 2 ||
    normalized.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(normalized)
  )
    throw new Error("Invalid encrypted push subscription encoding.");
  return Buffer.from(normalized, "hex");
}

function isClaimedPush(value: unknown): value is ClaimedPush {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.claimToken === "string" &&
    typeof row.organizationId === "string" &&
    typeof row.notificationId === "string" &&
    typeof row.subscriptionId === "string" &&
    Number.isInteger(row.attempts) &&
    typeof row.deliveryTopic === "string" &&
    /^[A-Za-z0-9_-]{1,32}$/.test(row.deliveryTopic)
  );
}

function isDispatchingPush(value: unknown): value is DispatchingPush {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.status === "dispatching" &&
    Number.isInteger(row.attempts) &&
    typeof row.encryptedSubscription === "string" &&
    typeof row.title === "string" &&
    (typeof row.body === "string" || row.body === null) &&
    (typeof row.actionUrl === "string" || row.actionUrl === null) &&
    (typeof row.entityId === "string" || row.entityId === null) &&
    typeof row.deliveryTopic === "string" &&
    /^[A-Za-z0-9_-]{1,32}$/.test(row.deliveryTopic)
  );
}

function providerStatusCode(value: unknown) {
  if (!value || typeof value !== "object" || !("statusCode" in value))
    return null;
  const parsed = Number((value as { statusCode: unknown }).statusCode);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599
    ? parsed
    : null;
}

async function completePush(
  rpc: PushRpc,
  push: ClaimedPush,
  input: {
    status: "sent" | "failed" | "cancelled" | "uncertain";
    errorCode: string | null;
    nextAttemptAt: string | null;
    providerStatusCode: number | null;
    blockSubscription: boolean;
    now: string;
  },
) {
  try {
    const completed = await rpc(
      "service_complete_reservation_push_delivery",
      {
        p_id: push.id,
        p_claim_token: push.claimToken,
        p_status: input.status,
        p_error_code: input.errorCode,
        p_next_attempt_at: input.nextAttemptAt,
        p_provider_status_code: input.providerStatusCode,
        p_block_subscription: input.blockSubscription,
        p_now: input.now,
      },
    );
    const result = completed.data as { status?: unknown } | null;
    return !completed.error && result?.status === input.status;
  } catch {
    return false;
  }
}

function response(
  counters: PushCounters,
  options: { error?: string; status?: number } = {},
) {
  return Response.json(
    options.error
      ? { error: options.error, data: counters }
      : { data: counters },
    {
      status: options.status ?? 200,
      headers: { "cache-control": "no-store" },
    },
  );
}

async function deliverReservationPush(request: Request) {
  const counters: PushCounters = {
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    uncertain: 0,
    completionErrors: 0,
    deferred: 0,
  };
  if (!authorized(request))
    return response(counters, { error: "Unauthorized", status: 401 });
  if (process.env.RESERVATION_PUSH_DELIVERY_ENABLED !== "true")
    return response(counters, {
      error: "Push delivery is disabled.",
      status: 503,
    });

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject)
    return response(counters, {
      error: "Push delivery is not configured.",
      status: 503,
    });
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch {
    return response(counters, {
      error: "Push delivery is not configured.",
      status: 503,
    });
  }

  let rpc: PushRpc;
  try {
    const admin = createAdminClient();
    rpc = admin.rpc as unknown as PushRpc;
  } catch {
    return response(counters, {
      error: "Reservation push storage is unavailable.",
      status: 503,
    });
  }

  const claimedAt = new Date();
  let claimResult: PushRpcResult;
  try {
    claimResult = await rpc("service_claim_reservation_push_deliveries", {
      p_worker_id: crypto.randomUUID(),
      p_limit: pushClaimLimit,
      p_lease_seconds: pushLeaseSeconds,
      p_now: claimedAt.toISOString(),
    });
  } catch {
    return response(counters, {
      error: "Reservation push deliveries could not be claimed.",
      status: 503,
    });
  }
  if (claimResult.error || !Array.isArray(claimResult.data))
    return response(counters, {
      error: "Reservation push deliveries could not be claimed.",
      status: 503,
    });
  if (!claimResult.data.every(isClaimedPush))
    return response(counters, {
      error: "Reservation push claim data was invalid.",
      status: 503,
    });

  const pushes = claimResult.data;
  counters.claimed = pushes.length;
  for (const [index, push] of pushes.entries()) {
    const dispatchAt = new Date();
    let began: PushRpcResult;
    try {
      began = await rpc("service_begin_reservation_push_delivery", {
        p_id: push.id,
        p_claim_token: push.claimToken,
        p_now: dispatchAt.toISOString(),
      });
    } catch {
      counters.completionErrors += 1;
      counters.deferred += pushes.length - index - 1;
      break;
    }
    const beginState = began.data as Record<string, unknown> | null;
    if (began.error || !beginState) {
      counters.completionErrors += 1;
      counters.deferred += pushes.length - index - 1;
      break;
    }
    if (beginState.status === "cancelled") {
      counters.skipped += 1;
      continue;
    }
    if (!isDispatchingPush(beginState)) {
      counters.completionErrors += 1;
      counters.deferred += pushes.length - index - 1;
      break;
    }

    let subscription: ReturnType<typeof decryptPushSubscription>;
    try {
      subscription = decryptPushSubscription(
        encryptedBuffer(beginState.encryptedSubscription),
      );
    } catch {
      const completed = await completePush(rpc, push, {
        status: "cancelled",
        errorCode: "subscription_ciphertext_invalid",
        nextAttemptAt: null,
        providerStatusCode: null,
        blockSubscription: true,
        now: new Date().toISOString(),
      });
      if (completed) counters.skipped += 1;
      else {
        counters.completionErrors += 1;
        counters.deferred += pushes.length - index - 1;
        break;
      }
      continue;
    }

    const attemptNumber = beginState.attempts;
    try {
      const delivered = await webpush.sendNotification(
        subscription,
        JSON.stringify({
          title: beginState.title,
          body: beginState.body,
          url: beginState.actionUrl || "/reservations",
          tag: `reservation-${beginState.entityId || push.notificationId}`,
        }),
        {
          TTL: 300,
          urgency: "high",
          timeout: pushProviderTimeoutMs,
          topic: beginState.deliveryTopic,
        },
      );
      const completed = await completePush(rpc, push, {
        status: "sent",
        errorCode: null,
        nextAttemptAt: null,
        providerStatusCode: providerStatusCode(delivered),
        blockSubscription: false,
        now: new Date().toISOString(),
      });
      if (completed) counters.sent += 1;
      else {
        counters.completionErrors += 1;
        counters.deferred += pushes.length - index - 1;
        break;
      }
    } catch (caught) {
      const statusCode = providerStatusCode(caught);
      const invalidSubscription = statusCode === 404 || statusCode === 410;
      const outcomeKnown = statusCode !== null;
      const canRetry =
        outcomeKnown &&
        !invalidSubscription &&
        attemptNumber < pushAttemptLimit;
      const completionStatus = invalidSubscription
        ? "cancelled"
        : outcomeKnown
          ? "failed"
          : "uncertain";
      const retryAt = canRetry
        ? new Date(
            Date.now() +
              Math.min(30, 2 ** Math.max(1, attemptNumber)) * 60_000,
          ).toISOString()
        : null;
      const completed = await completePush(rpc, push, {
        status: completionStatus,
        errorCode: invalidSubscription
          ? `subscription_rejected_${statusCode}`
          : outcomeKnown
            ? `provider_http_${statusCode}`
            : "provider_transport_outcome_unknown",
        nextAttemptAt: retryAt,
        providerStatusCode: statusCode,
        blockSubscription: invalidSubscription,
        now: new Date().toISOString(),
      });
      if (!completed) {
        counters.completionErrors += 1;
        counters.deferred += pushes.length - index - 1;
        break;
      }
      if (completionStatus === "cancelled") counters.skipped += 1;
      else if (completionStatus === "failed") counters.failed += 1;
      else counters.uncertain += 1;
    }
  }

  if (counters.completionErrors > 0)
    return response(counters, {
      error: "Reservation push completion could not be recorded.",
      status: 503,
    });
  return response(counters);
}

export async function GET(request: Request) {
  return deliverReservationPush(request);
}

export async function POST(request: Request) {
  return deliverReservationPush(request);
}
