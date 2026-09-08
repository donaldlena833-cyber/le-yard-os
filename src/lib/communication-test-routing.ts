// Optional, time-bounded live acceptance testing with the configured Donald
// contact. This never changes voice routing or other contacts' notifications.
export function communicationTestOwner(phone: string | undefined, env: Record<string, string | undefined>, now = Date.now()) {
  if (!phone || phone !== env.TWILIO_FORWARD_DONALD?.trim()) return null;
  const until = Date.parse(env.COMMUNICATIONS_TEST_UNTIL ?? "");
  if (!Number.isFinite(until) || now >= until) return null;
  const id = env.COMMUNICATIONS_TEST_OWNER_ID;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Test notification recipient is not configured.");
  }
  return id;
}
