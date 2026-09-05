import "server-only";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function elevenLabsConfigured() {
  return Boolean(
    process.env.ELEVENLABS_AGENT_ID?.trim() &&
      process.env.ELEVENLABS_API_KEY?.trim(),
  );
}

export async function registerElevenLabsTwilioCall(input: {
  fromNumber: string;
  toNumber: string;
  callSid: string;
  guestId?: string | null;
  guestName?: string | null;
}) {
  const response = await fetch(
    "https://api.elevenlabs.io/v1/convai/twilio/register-call",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": required("ELEVENLABS_API_KEY"),
      },
      body: JSON.stringify({
        agent_id: required("ELEVENLABS_AGENT_ID"),
        from_number: input.fromNumber,
        to_number: input.toNumber,
        direction: "inbound",
        conversation_initiation_client_data: {
          dynamic_variables: {
            caller_number: input.fromNumber,
            le_yard_call_sid: input.callSid,
            guest_id: input.guestId ?? "",
            guest_name: input.guestName ?? "",
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `ElevenLabs register-call failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  return response.text();
}

export function validateAgentToolSecret(request: Request) {
  const expected = process.env.LE_YARD_AGENT_TOOL_SECRET?.trim();
  if (!expected || expected.length < 32) return false;
  const authorization = request.headers.get("authorization")?.trim();
  const header = request.headers.get("x-le-yard-agent-secret")?.trim();
  return authorization === `Bearer ${expected}` || header === expected;
}
