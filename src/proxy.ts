import { type NextRequest } from "next/server";
import { publicRuntimeConfiguration } from "@/lib/env";
import { buildContentSecurityPolicy } from "@/lib/security/content-security-policy";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    supabaseUrl: publicRuntimeConfiguration.supabaseUrl ?? undefined,
  });
  const requestHeaders = new Headers();
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:css|svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
