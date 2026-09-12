const PROCESSOR = "https://phone.leyardny.com/api/internal/communications/owner-alerts";

export async function drain(env) {
  if (!env.OWNER_SMS_ALERTS_SECRET || env.OWNER_SMS_ALERTS_SECRET.length < 32)
    throw new Error("Alert recovery is not configured.");
  const response = await fetch(PROCESSOR, {
    method: "GET",
    headers: { authorization: `Bearer ${env.OWNER_SMS_ALERTS_SECRET}` },
    redirect: "manual",
    signal: AbortSignal.timeout(50000),
  });
  if (!response.ok) throw new Error(`Alert recovery returned ${response.status}.`);
  const result = await response.json();
  if (result.ok !== true) throw new Error("Alert recovery was not acknowledged.");
  return { ok: true };
}

export default {
  async scheduled(_controller, env) {
    await drain(env);
  },
  fetch() {
    // Scheduling is the only trigger; the public endpoint cannot send texts.
    return Response.json({ service: "le-yard-message-alerts", ok: true });
  },
};
