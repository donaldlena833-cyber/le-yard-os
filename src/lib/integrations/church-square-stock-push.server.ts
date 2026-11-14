import "server-only";

import { createECDH, createHash, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import { appSurface } from "@/lib/app-surface";
import { decryptPushSubscription } from "@/lib/notifications/push-subscription";
import { createAdminClient } from "@/lib/supabase/admin";

export function isChurchSquareStockPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    if ((url.hostname === "fcm.googleapis.com" || url.hostname === "android.googleapis.com")) {
      return url.pathname.startsWith("/fcm/send/") || url.pathname.startsWith("/gcm/send/");
    }
    if (url.hostname === "updates.push.services.mozilla.com") return url.pathname.startsWith("/wpush/");
    if (url.hostname === "web.push.apple.com") return url.pathname.length > 1;
    return url.hostname.endsWith(".notify.windows.com") && url.pathname === "/w/";
  } catch {
    return false;
  }
}

export const churchSquareStockPushSubscription = z.strictObject({
  endpoint: z.string().max(2048).refine(isChurchSquareStockPushEndpoint, "This browser's notification service is unsupported."),
  expirationTime: z.number().int().positive().nullable(),
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/).refine((value) => Buffer.from(value, "base64url")[0] === 4),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});

function stockPushConfiguration() {
  if (appSurface !== "operations" || process.env.VERCEL_ENV !== "production"
    || process.env.LE_YARD_CHURCH_SQUARE_STOCK_PUSH_ENABLED !== "true") return null;
  const publicKey = process.env.LE_YARD_CHURCH_SQUARE_STOCK_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = process.env.LE_YARD_CHURCH_SQUARE_STOCK_VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = process.env.LE_YARD_CHURCH_SQUARE_STOCK_VAPID_SUBJECT?.trim() ?? "";
  const encryptionKey = process.env.LE_YARD_CHURCH_SQUARE_STOCK_PUSH_ENCRYPTION_KEY?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)
    || !(subject === "https://operations.leyardny.com" || /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject))
    || !/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey)) return null;
  try {
    const ec = createECDH("prime256v1");
    ec.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (!timingSafeEqual(ec.getPublicKey(), Buffer.from(publicKey, "base64url"))) return null;
    return { vapid: { publicKey, privateKey, subject }, encryptionKey };
  } catch {
    return null;
  }
}

export function churchSquareStockPushPublicKey() {
  return stockPushConfiguration()?.vapid.publicKey ?? null;
}

export function churchSquareStockPushEncryptionKey() {
  return stockPushConfiguration()?.encryptionKey ?? null;
}

const claimSchema = z.strictObject({
  id: z.uuid(),
  claimToken: z.uuid(),
  episodeId: z.uuid(),
  encryptedSubscription: z.string().max(16386).regex(/^\\x(?:[0-9a-f]{2}){30,8192}$/i),
});

type PushOutcome = "sent" | "gone" | "failed" | "uncertain";

async function deliverStockPush(
  claim: z.infer<typeof claimSchema>,
  configuration: NonNullable<ReturnType<typeof stockPushConfiguration>>,
): Promise<PushOutcome> {
  const topic = createHash("sha256").update(claim.episodeId).digest("base64url").slice(0, 32);
  let subscription;
  try {
    subscription = churchSquareStockPushSubscription.parse(
      decryptPushSubscription(Buffer.from(claim.encryptedSubscription.slice(2), "hex"), configuration.encryptionKey),
    );
  } catch {
    return "failed";
  }
  if (subscription.expirationTime !== null && subscription.expirationTime <= Date.now()) return "gone";

  try {
    await webpush.sendNotification(subscription, JSON.stringify({
      title: "Church Street inventory",
      body: "Low stock needs attention. Open Operations to review the current count.",
      url: "/inventory",
      tag: `church-stock-${topic}`,
    }), {
      TTL: 120, urgency: "high", timeout: 4_000, topic, vapidDetails: configuration.vapid,
    });
    return "sent";
  } catch (error) {
    const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : null;
    if (status === 404 || status === 410) return "gone";
    if (typeof status === "number" && status >= 300 && status <= 599) return "failed";
    return "uncertain";
  }
}

export async function processChurchSquareStockPush(): Promise<void> {
  const configuration = stockPushConfiguration();
  if (!configuration) return;

  try {
    const client = createAdminClient();
    const workerId = crypto.randomUUID();
    // Claim each delivery at dispatch time so a recent acknowledgment, restock
    // or device opt-out can still cancel the rest of the queue.
    for (let index = 0; index < 4; index += 1) {
      const claimed = await client.rpc("service_claim_church_square_stock_push", {
        p_worker_id: workerId,
      }).abortSignal(AbortSignal.timeout(3_000));
      if (claimed.error) throw new Error("Stock push claim failed.");
      if (claimed.data === null) return;
      const claim = claimSchema.parse(claimed.data);
      const status = await deliverStockPush(claim, configuration);
      const completed = await client.rpc("service_complete_church_square_stock_push", {
        p_id: claim.id, p_claim_token: claim.claimToken, p_status: status,
      }).abortSignal(AbortSignal.timeout(3_000));
      if (completed.error || completed.data !== true) throw new Error("Stock push result could not be recorded.");
      if (status === "failed" || status === "uncertain") console.warn("Church Street stock push was not confirmed.", status);
    }
  } catch {
    // Push is ancillary to accepting the Square webhook and confirming counts.
    // Provider endpoints, claims and private keys never enter application logs.
    console.error("Church Street stock push checks did not finish.");
  }
}
