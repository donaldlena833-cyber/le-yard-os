import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isPublicRequestPath } from "@/lib/auth/public-paths";
import { safeInternalRedirect } from "@/lib/auth/safe-redirect";
import { getServerRuntimeConfiguration } from "@/lib/env.server";
import { requireSupabasePublicEnv } from "@/lib/env";
import {
  PLAYGROUND_SESSION_COOKIE,
  readPlaygroundSessionToken,
} from "@/lib/auth/playground-auth.server";
import {
  CONNECTED_SESSION_DEADLINE_COOKIE,
  STANDARD_SESSION_TTL_SECONDS,
  connectedSessionCookieOptions,
  sessionSecondsRemaining,
} from "@/lib/auth/session-duration";
import { isSupabaseAuthCookieName } from "@/lib/auth/session-cookies";
import {
  defaultWorkspacePath,
  isRequestPathAllowedForAppSurface,
} from "@/lib/app-surface";

interface PendingCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

function configurationUnavailable(request: NextRequest): NextResponse {
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "Retry-After": "60",
    "X-Content-Type-Options": "nosniff",
  };

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Service configuration is unavailable." },
      { status: 503, headers },
    );
  }

  return new NextResponse("Service temporarily unavailable.", {
    status: 503,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function forwardRequest(
  request: NextRequest,
  additionalRequestHeaders?: Headers,
): NextResponse {
  if (!additionalRequestHeaders) return NextResponse.next({ request });

  const headers = new Headers(request.headers);
  additionalRequestHeaders.forEach((value, key) => headers.set(key, value));
  return NextResponse.next({ request: { headers } });
}

function securePlaygroundResponse(
  response: NextResponse,
  expireSession = false,
): NextResponse {
  response.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate, max-age=0",
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("X-Content-Type-Options", "nosniff");

  if (expireSession) {
    response.cookies.set(PLAYGROUND_SESSION_COOKIE, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
      priority: "high",
    });
  }
  return response;
}

function expireConnectedSession(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  request.cookies.getAll().forEach((cookie) => {
    if (!isSupabaseAuthCookieName(cookie.name)) return;
    response.cookies.set(cookie.name, "", {
      path: "/",
      sameSite: "lax",
      secure: true,
      maxAge: 0,
      expires: new Date(0),
    });
  });
  response.cookies.set(CONNECTED_SESSION_DEADLINE_COOKIE, "", {
    ...connectedSessionCookieOptions(0),
    expires: new Date(0),
  });
  return response;
}

function expiredConnectedSessionResponse(
  request: NextRequest,
  appUrl: string,
): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return expireConnectedSession(
      request,
      NextResponse.json(
        { error: "Your session expired. Sign in again." },
        { status: 401 },
      ),
    );
  }
  const signInUrl = new URL("/sign-in", appUrl);
  signInUrl.searchParams.set("notice", "session_expired");
  signInUrl.searchParams.set(
    "next",
    safeInternalRedirect(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      defaultWorkspacePath,
    ),
  );
  return expireConnectedSession(
    request,
    NextResponse.redirect(signInUrl),
  );
}

function updatePlaygroundSession(
  request: NextRequest,
  appUrl: string,
  additionalRequestHeaders?: Headers,
): NextResponse {
  const canonicalOrigin = new URL(appUrl).origin;
  if (request.nextUrl.origin !== canonicalOrigin) {
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      !request.nextUrl.pathname.startsWith("/api/")
    ) {
      return securePlaygroundResponse(
        NextResponse.redirect(
          new URL(
            `${request.nextUrl.pathname}${request.nextUrl.search}`,
            canonicalOrigin,
          ),
        ),
      );
    }
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return securePlaygroundResponse(
        NextResponse.json(
          { error: "Use the canonical playground origin." },
          { status: 421 },
        ),
      );
    }
    return securePlaygroundResponse(
      new NextResponse("Use the canonical playground origin.", {
        status: 421,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
  }

  const sessionCookie = request.cookies.get(PLAYGROUND_SESSION_COOKIE)?.value;
  const principal = readPlaygroundSessionToken(sessionCookie);
  const isPublicPath = isPublicRequestPath(request.nextUrl.pathname);
  const expireSession = Boolean(sessionCookie && !principal);

  if (principal && request.nextUrl.pathname === "/sign-in") {
    return securePlaygroundResponse(
      NextResponse.redirect(new URL("/today", appUrl)),
      expireSession,
    );
  }

  if (!principal && !isPublicPath) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return securePlaygroundResponse(
        NextResponse.json(
          { error: "Authentication is required." },
          { status: 401 },
        ),
        expireSession,
      );
    }

    const signInUrl = new URL("/sign-in", appUrl);
    signInUrl.searchParams.set(
      "next",
      safeInternalRedirect(
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      ),
    );
    return securePlaygroundResponse(
      NextResponse.redirect(signInUrl),
      expireSession,
    );
  }

  return securePlaygroundResponse(
    forwardRequest(request, additionalRequestHeaders),
    expireSession,
  );
}

export async function updateSession(
  request: NextRequest,
  additionalRequestHeaders?: Headers,
) {
  const runtime = getServerRuntimeConfiguration();

  // The health route reports the same readiness assessment with a 503. It is
  // the only route allowed to execute while configuration is invalid.
  if (!runtime.ready) {
    if (request.nextUrl.pathname === "/api/health") {
      return forwardRequest(request, additionalRequestHeaders);
    }
    return configurationUnavailable(request);
  }

  if (!isRequestPathAllowedForAppSurface(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL(defaultWorkspacePath, runtime.appUrl!));
  }

  if (runtime.mode === "demo") {
    if (runtime.playground) {
      return updatePlaygroundSession(
        request,
        runtime.appUrl!,
        additionalRequestHeaders,
      );
    }
    return forwardRequest(request, additionalRequestHeaders);
  }

  const { url, publishableKey } = requireSupabasePublicEnv();
  const authCookiesPresent = request.cookies
    .getAll()
    .some((cookie) => isSupabaseAuthCookieName(cookie.name));
  const sessionRemaining = sessionSecondsRemaining(
    request.cookies.get(CONNECTED_SESSION_DEADLINE_COOKIE)?.value,
  );
  if (authCookiesPresent && sessionRemaining === null) {
    return expiredConnectedSessionResponse(request, runtime.appUrl!);
  }
  const pendingCookies = new Map<string, PendingCookie>();
  const pendingHeaders = new Map<string, string>();

  function applyAuthMutations(response: NextResponse): NextResponse {
    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
    pendingHeaders.forEach((value, key) => {
      response.headers.set(key, value);
    });
    return response;
  }

  let response = forwardRequest(request, additionalRequestHeaders);
  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: {
      maxAge: sessionRemaining ?? STANDARD_SESSION_TTL_SECONDS,
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, responseHeaders) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          const key = `${name}\u0000${options.path ?? ""}\u0000${options.domain ?? ""}`;
          pendingCookies.set(key, { name, value, options });
        });
        Object.entries(responseHeaders).forEach(([key, value]) => {
          pendingHeaders.set(key, value);
        });
        response = applyAuthMutations(
          forwardRequest(request, additionalRequestHeaders),
        );
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isPublicPath = isPublicRequestPath(request.nextUrl.pathname);

  if (data?.claims && sessionRemaining === null) {
    return expiredConnectedSessionResponse(request, runtime.appUrl!);
  }

  if (!data?.claims && !isPublicPath) {
    const signInUrl = new URL("/sign-in", runtime.appUrl!);
    signInUrl.searchParams.set(
      "next",
      safeInternalRedirect(`${request.nextUrl.pathname}${request.nextUrl.search}`),
    );
    return applyAuthMutations(NextResponse.redirect(signInUrl));
  }

  return response;
}
