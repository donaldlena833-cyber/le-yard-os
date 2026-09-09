import "server-only";
import { logCommunicationEvent } from "@/lib/communications.server";

// Twilio imposes a hard webhook deadline. Diagnostics may never consume the
// caller's remaining response budget after model inference and speech synthesis.
export async function recordVoiceEvent(input: Parameters<typeof logCommunicationEvent>[0]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      logCommunicationEvent(input).catch(() => false),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 300); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
