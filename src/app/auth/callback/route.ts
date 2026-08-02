import { NextResponse } from "next/server";
import { safeInternalRedirect } from "@/lib/auth/safe-redirect";
import { publicEnv } from "@/lib/env";
import { getServerRuntimeConfiguration } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = safeInternalRedirect(requestUrl.searchParams.get("next"));
  const applicationOrigin = publicEnv.NEXT_PUBLIC_APP_URL;
  const runtime = getServerRuntimeConfiguration();

  // Demo and hosted playground sessions never consult a connected identity
  // provider, even when an inherited callback query is supplied.
  if (runtime.mode === "demo") {
    return NextResponse.redirect(new URL("/sign-in", applicationOrigin));
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, applicationOrigin));
    }
  }

  const errorUrl = new URL("/sign-in", applicationOrigin);
  errorUrl.searchParams.set("error", "invite_expired");
  return NextResponse.redirect(errorUrl);
}
