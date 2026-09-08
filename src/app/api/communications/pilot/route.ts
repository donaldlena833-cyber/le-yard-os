import { after } from "next/server";
import { requirePhoneAccess } from "@/lib/phone-access.server";
import {
  processSmsPilotQueue,
  smsPilotStatus,
} from "@/lib/sms-ai-pilot.server";
export const maxDuration = 60;
export async function GET() {
  try {
    await requirePhoneAccess();
    return Response.json(await smsPilotStatus(), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return error instanceof Response
      ? error
      : Response.json(
          { error: "AI pilot status unavailable" },
          { status: 503 },
        );
  }
}
export async function POST(request: Request) {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL;
    if (!origin || request.headers.get("origin") !== new URL(origin).origin)
      return new Response("Forbidden", { status: 403 });
    const workspace = await requirePhoneAccess();
    if (
      ![
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ].includes(workspace.identity.userId)
    )
      return new Response("Owner pilot only", { status: 403 });
    after(processSmsPilotQueue);
    return Response.json({ status: "scheduled" }, { status: 202 });
  } catch (error) {
    return error instanceof Response
      ? error
      : new Response("Pilot unavailable", { status: 503 });
  }
}
