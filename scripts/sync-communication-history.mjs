// Reconcile Twilio's available history into the private Groups transcript.
// Default is read-only. --apply writes only to the existing Le Yard tenant.
// Supply credentials through the existing protected environment; never CLI args.
import twilio from "twilio";
import { createClient } from "@supabase/supabase-js";
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw Error(`${name} is required`);
  return value;
};
const apply = process.argv.includes("--apply");
const account = required("TWILIO_ACCOUNT_SID");
const key = process.env.TWILIO_API_KEY_SID?.trim();
const secret = process.env.TWILIO_API_KEY_SECRET?.trim();
if (Boolean(key) !== Boolean(secret))
  throw Error("Both API key fields are required");
const client = twilio(key || account, secret || required("TWILIO_AUTH_TOKEN"), {
  accountSid: account,
  autoRetry: false,
  timeout: 15000,
});
const db = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL"),
  required("SUPABASE_SECRET_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const business =
  process.env.TWILIO_FROM_NUMBER?.trim() || required("TWILIO_PHONE_NUMBER");
let tenantQuery = db
  .from("locations")
  .select("id,organization_id")
  .eq("is_active", true);
tenantQuery = process.env.LE_YARD_LOCATION_ID
  ? tenantQuery.eq("id", process.env.LE_YARD_LOCATION_ID)
  : tenantQuery.eq("name", "Le Yard");
const tenant = await tenantQuery.single();
if (tenant.error || !tenant.data)
  throw Error("Exactly one existing Le Yard location is required");
const { id: loc, organization_id: org } = tenant.data;
const staff = [
  process.env.TWILIO_FORWARD_DONALD,
  process.env.TWILIO_FORWARD_MARIS,
].filter(Boolean);
const contacts = new Map();
const seen = new Set();
let count = 0;
try {
  for (const scope of [{ to: business }, { from: business }]) {
    let page = await client.messages.page({ ...scope, pageSize: 100 });
    while (page) {
      const rows = [];
      for (const message of page.instances) {
        if (seen.has(message.sid)) continue;
        seen.add(message.sid);
        if (message.from !== business && message.to !== business)
          throw Error("Provider returned a message outside this number");
        count++;
        if (!apply) continue;
        const phone = message.from === business ? message.to : message.from;
        if (!contacts.has(phone)) {
          const match = await db.rpc("communication_employee_for_phone", {
            p_organization_id: org,
            p_phone: phone,
          });
          if (match.error) throw Error("Employee classification unavailable");
          contacts.set(phone, match.data?.[0] ?? null);
        }
        const employee = contacts.get(phone);
        const internal = Boolean(employee || staff.includes(phone));
        rows.push({
          organization_id: org,
          location_id: loc,
          sid: message.sid,
          from_number: message.from,
          to_number: message.to,
          body: message.body,
          direction: message.from === business ? "outbound" : "inbound",
          sender_kind:
            message.from === business
              ? message.direction === "outbound-reply"
                ? "automation"
                : "unknown"
              : internal
                ? "staff"
                : "client",
          audience: internal ? "team" : "client",
          contact_name: employee?.display_name ?? null,
          media_count: Math.min(10, Number(message.numMedia) || 0),
          status: message.status,
          error_code:
            message.errorCode == null ? null : String(message.errorCode),
          sent_at: (message.dateSent ?? message.dateCreated).toISOString(),
          synced_at: new Date().toISOString(),
        });
      }
      if (rows.length) {
        const prior = await db
          .from("communication_messages")
          .select("sid,sender_kind,actor_id,body,sent_at")
          .eq("organization_id", org)
          .in(
            "sid",
            rows.map((r) => r.sid),
          );
        if (prior.error) throw Error("Existing archive unavailable");
        const previous = new Map(prior.data.map((r) => [r.sid, r]));
        const saved = await db.from("communication_messages").upsert(
          rows.map((row) => {
            const old = previous.get(row.sid);
            return old
              ? {
                  ...row,
                  body: old.body,
                  sent_at: old.sent_at,
                  sender_kind:
                    old.sender_kind !== "unknown"
                      ? old.sender_kind
                      : row.sender_kind,
                  actor_id: old.actor_id,
                }
              : row;
          }),
          { onConflict: "organization_id,sid" },
        );
        if (saved.error) throw Error("Archive reconciliation failed");
      }
      page = await page.nextPage();
    }
  }
  console.log(
    JSON.stringify({
      mode: apply ? "applied" : "read-only",
      uniqueMessages: count,
      scope: "existing Le Yard number",
      providerHistoryExhausted: true,
    }),
  );
} catch {
  console.error(
    "History reconciliation incomplete. No credentials or message contents were logged. A rerun is safe.",
  );
  process.exitCode = 1;
}
