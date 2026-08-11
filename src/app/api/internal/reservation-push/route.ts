import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPushSubscription } from "@/lib/notifications/push-subscription";

function authorized(request: Request) {
  const expected = process.env.RESERVATION_DELIVERY_SECRET?.trim();
  const provided = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  return Boolean(
    expected && provided && expected.length >= 32 && provided === expected,
  );
}

function encryptedBuffer(value: string) {
  const normalized = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(normalized, "hex");
}

async function deliverReservationPush(request: Request) {
  if (!authorized(request))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject)
    return Response.json(
      { error: "Push delivery is not configured." },
      { status: 503 },
    );
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createAdminClient();
  const { data: notifications, error } = await admin
    .from("notifications")
    .select(
      "id,organization_id,user_id,title,body,action_url,entity_id,created_at",
    )
    .eq("notification_type", "reservation_changed")
    .is("read_at", null)
    .gte("created_at", new Date(Date.now() - 48 * 60 * 60_000).toISOString())
    .order("created_at")
    .limit(100);
  if (error)
    return Response.json(
      { error: "Notifications could not be loaded." },
      { status: 503 },
    );
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const notification of notifications ?? []) {
    const preferenceResult = await admin
      .from("notification_preferences")
      .select("push,quiet_hours")
      .eq("organization_id", notification.organization_id)
      .eq("user_id", notification.user_id)
      .eq("notification_type", "reservation_changed")
      .maybeSingle();
    if (!preferenceResult.data?.push) {
      skipped += 1;
      continue;
    }
    const reservationResult = notification.entity_id
      ? await admin
          .from("reservations")
          .select("location_id")
          .eq("id", notification.entity_id)
          .maybeSingle()
      : { data: null };
    if (!reservationResult.data) {
      skipped += 1;
      continue;
    }
    const settingsResult = await admin
      .from("reservation_settings")
      .select("staff_push_enabled")
      .eq("organization_id", notification.organization_id)
      .eq("location_id", reservationResult.data.location_id)
      .maybeSingle();
    if (!settingsResult.data?.staff_push_enabled) {
      skipped += 1;
      continue;
    }
    const subscriptionsResult = await admin
      .from("push_subscriptions")
      .select("id,encrypted_subscription")
      .eq("organization_id", notification.organization_id)
      .eq("user_id", notification.user_id);
    for (const subscriptionRow of subscriptionsResult.data ?? []) {
      const existing = await admin
        .from("reservation_push_deliveries")
        .select("id,status,attempts")
        .eq("notification_id", notification.id)
        .eq("subscription_id", subscriptionRow.id)
        .maybeSingle();
      if (
        existing.data?.status === "sent" ||
        (existing.data?.attempts ?? 0) >= 5
      ) {
        skipped += 1;
        continue;
      }
      try {
        const subscription = decryptPushSubscription(
          encryptedBuffer(subscriptionRow.encrypted_subscription),
        );
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: notification.title,
            body: notification.body,
            url: notification.action_url || "/reservations",
            tag: `reservation-${notification.entity_id || notification.id}`,
          }),
          { TTL: 300, urgency: "high" },
        );
        await admin.from("reservation_push_deliveries").upsert(
          {
            id: existing.data?.id,
            organization_id: notification.organization_id,
            notification_id: notification.id,
            subscription_id: subscriptionRow.id,
            status: "sent",
            attempts: (existing.data?.attempts ?? 0) + 1,
            sent_at: new Date().toISOString(),
            last_error_code: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "notification_id,subscription_id" },
        );
        sent += 1;
      } catch (caught) {
        const statusCode =
          typeof caught === "object" && caught && "statusCode" in caught
            ? String((caught as { statusCode: unknown }).statusCode)
            : "delivery_failed";
        await admin.from("reservation_push_deliveries").upsert(
          {
            id: existing.data?.id,
            organization_id: notification.organization_id,
            notification_id: notification.id,
            subscription_id: subscriptionRow.id,
            status: "failed",
            attempts: (existing.data?.attempts ?? 0) + 1,
            last_error_code: statusCode.slice(0, 120),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "notification_id,subscription_id" },
        );
        if (["404", "410"].includes(statusCode))
          await admin
            .from("push_subscriptions")
            .delete()
            .eq("id", subscriptionRow.id);
        failed += 1;
      }
    }
  }
  return Response.json(
    { data: { sent, failed, skipped } },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function GET(request: Request) {
  return deliverReservationPush(request);
}

export async function POST(request: Request) {
  return deliverReservationPush(request);
}
