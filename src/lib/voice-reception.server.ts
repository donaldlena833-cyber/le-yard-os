import type twilio from "twilio";

export const LE_YARD_RECEPTION_GREETING =
  "Thank you for calling Le Yard. One moment while we connect you with our team.";

function configuredGreetingUrl() {
  const value = process.env.TWILIO_RECEPTION_AUDIO_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function addReceptionGreeting(response: twilio.twiml.VoiceResponse) {
  const audioUrl = configuredGreetingUrl();
  if (audioUrl) {
    response.play(audioUrl);
    return "recorded" as const;
  }
  response.say(
    { voice: "Polly.Joanna", language: "en-US" },
    LE_YARD_RECEPTION_GREETING,
  );
  return "twilio" as const;
}
