"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { isDemoMode, publicEnv } from "@/lib/env";
import { getServerRuntimeConfiguration } from "@/lib/env.server";
import {
  canInviteRole,
  createInvitationTracking,
  invitationCallbackUrl,
} from "@/lib/auth/invitations";
import { safeInternalRedirect } from "@/lib/auth/safe-redirect";
import { isSupabaseAuthCookieName } from "@/lib/auth/session-cookies";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import {
  PLAYGROUND_PASSWORD_MINIMUM_LENGTH,
  PLAYGROUND_REMEMBERED_SESSION_TTL_SECONDS,
  PLAYGROUND_SESSION_COOKIE,
  PLAYGROUND_SESSION_TTL_SECONDS,
  authenticatePlaygroundUser,
  issuePlaygroundSessionToken,
} from "@/lib/auth/playground-auth.server";
import { PlaygroundLoginRateLimiter } from "@/lib/auth/playground-login-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { defaultWorkspacePath } from "@/lib/app-surface";
import {
  CONNECTED_SESSION_DEADLINE_COOKIE,
  connectedSessionCookieOptions,
  sessionDeadlineValue,
  sessionTtlSeconds,
} from "@/lib/auth/session-duration";

export type AuthActionState = {
  status: "idle" | "error" | "success";
  message?: string;
};

const signInSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
  next: z.string().optional(),
  rememberFor30Days: z.boolean(),
});
const playgroundPasswordCandidateSchema = z
  .string()
  .min(PLAYGROUND_PASSWORD_MINIMUM_LENGTH)
  .max(128);
const playgroundLoginRateLimiter = new PlaygroundLoginRateLimiter();

const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .regex(/[A-Z]/, "Add an uppercase letter.")
  .regex(/[a-z]/, "Add a lowercase letter.")
  .regex(/[0-9]/, "Add a number.");

export async function signInAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
    next: formData.get("next") || undefined,
    rememberFor30Days: formData.get("remember") === "30-days",
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid username or email and password.",
    };
  }

  const runtime = getServerRuntimeConfiguration();
  if (runtime.mode === "demo" && runtime.playground) {
    if (
      !playgroundPasswordCandidateSchema.safeParse(parsed.data.password).success
    ) {
      return {
        status: "error",
        message: "The username or password did not match.",
      };
    }
    const requestHeaders = await headers();
    const rateLimit = playgroundLoginRateLimiter.consume({
      identifier: parsed.data.identifier,
      vercelForwardedFor: requestHeaders.get("x-vercel-forwarded-for"),
      forwardedFor: requestHeaders.get("x-forwarded-for"),
    });
    if (!rateLimit.allowed) {
      return {
        status: "error",
        message: "Too many sign-in attempts. Try again later.",
      };
    }

    const principal = authenticatePlaygroundUser(
      parsed.data.identifier,
      parsed.data.password,
    );
    const sessionTtlSeconds = parsed.data.rememberFor30Days
      ? PLAYGROUND_REMEMBERED_SESSION_TTL_SECONDS
      : PLAYGROUND_SESSION_TTL_SECONDS;
    const token = principal
      ? issuePlaygroundSessionToken(principal, sessionTtlSeconds)
      : null;
    if (!principal || !token) {
      return {
        status: "error",
        message: "The username or password did not match.",
      };
    }

    const cookieStore = await cookies();
    cookieStore.set(PLAYGROUND_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: sessionTtlSeconds,
      priority: "high",
    });
    redirect(safeInternalRedirect(parsed.data.next, defaultWorkspacePath));
  }

  if (isDemoMode && runtime.ready) {
    redirect(safeInternalRedirect(parsed.data.next, defaultWorkspacePath));
  }

  // Le Yard's connected tenant accepts the same short usernames as the
  // playground accounts. They resolve to tenant-owned auth emails without
  // exposing an email directory in the sign-in UI.
  const identifier = parsed.data.identifier.toLowerCase();
  const emailValue = identifier.includes("@")
    ? identifier
    : `${identifier}@le-yard.local`;
  const email = z.string().email().safeParse(emailValue);
  if (!email.success) {
    return {
      status: "error",
      message: "Enter a valid username or email and password.",
    };
  }

  const connectedSessionTtl = sessionTtlSeconds(
    parsed.data.rememberFor30Days,
  );
  const supabase = await createClient({ cookieMaxAge: connectedSessionTtl });
  const { error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password: parsed.data.password,
  });

  if (error) {
    return {
      status: "error",
      message: "The username or password did not match.",
    };
  }

  const cookieStore = await cookies();
  cookieStore.set(
    CONNECTED_SESSION_DEADLINE_COOKIE,
    sessionDeadlineValue(connectedSessionTtl),
    connectedSessionCookieOptions(connectedSessionTtl),
  );
  redirect(safeInternalRedirect(parsed.data.next, defaultWorkspacePath));
}

export async function signOutAction() {
  let globalSignOutFailed = false;
  const runtime = getServerRuntimeConfiguration();
  const cookieStore = await cookies();

  cookieStore.set(PLAYGROUND_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    priority: "high",
  });
  cookieStore.set(CONNECTED_SESSION_DEADLINE_COOKIE, "", {
    ...connectedSessionCookieOptions(0),
    expires: new Date(0),
  });

  if (runtime.mode === "connected") {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.signOut();
      globalSignOutFailed = Boolean(error);
    } catch {
      globalSignOutFailed = true;
    }

    // A failed provider call must not leave this browser authenticated while
    // the UI claims sign-out succeeded. Expire only Supabase auth cookies.
    cookieStore.getAll().forEach((cookie) => {
      if (isSupabaseAuthCookieName(cookie.name))
        cookieStore.delete(cookie.name);
    });
  }

  redirect(globalSignOutFailed ? "/sign-in?notice=local_sign_out" : "/sign-in");
}

export async function setInvitedUserPasswordAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const password = formData.get("password");
  const confirmPassword = formData.get("confirmPassword");
  const organizationId = formData.get("organizationId");

  if (password !== confirmPassword) {
    return { status: "error", message: "The passwords do not match." };
  }

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message };
  }

  if (isDemoMode) {
    return { status: "success", message: "Demo password saved." };
  }

  const parsedOrganizationId = z.string().uuid().safeParse(organizationId);
  if (!parsedOrganizationId.success) {
    return {
      status: "error",
      message: "This invitation is missing its organization scope.",
    };
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) {
    return { status: "error", message: "This invitation is no longer valid." };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    return { status: "error", message: error.message };
  }

  const { error: activationError } = await supabase.rpc(
    "accept_my_invitation",
    {
      p_organization_id: parsedOrganizationId.data,
    },
  );
  if (activationError) {
    return {
      status: "error",
      message:
        "Your password was saved, but tenant access could not be activated. Ask an owner to review the invitation.",
    };
  }

  redirect("/today");
}

const inviteSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(2).max(80),
  role: z.enum(["owner", "admin", "manager", "employee"]),
  organizationId: z.string().uuid(),
  locationId: z.string().uuid().optional().or(z.literal("")),
});

export async function inviteUserAction(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    role: formData.get("role"),
    organizationId: formData.get("organizationId"),
    locationId: formData.get("locationId") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Review the invite details and try again.",
    };
  }

  if (isDemoMode) {
    return {
      status: "success",
      message: `Demo invitation prepared for ${parsed.data.email}.`,
    };
  }

  const workspaceResolution = await resolveWorkspaceSession();
  if (
    workspaceResolution.status !== "ready" ||
    workspaceResolution.context.mode !== "live"
  ) {
    return {
      status: "error",
      message: "Your active organization could not be verified.",
    };
  }

  const workspace = workspaceResolution.context;
  const organizationId = workspace.organization.id;
  const userId = workspace.identity.userId;

  if (!canInviteRole(workspace.role, parsed.data.role)) {
    return {
      status: "error",
      message:
        workspace.role === "owner" || workspace.role === "admin"
          ? "Only an owner can invite another owner."
          : "Only owners and admins can invite users.",
    };
  }

  const supabase = await createClient();

  const normalizedEmail = parsed.data.email.toLowerCase();
  const locationIds = parsed.data.locationId ? [parsed.data.locationId] : [];
  if (
    ["manager", "employee"].includes(parsed.data.role) &&
    locationIds.length === 0
  ) {
    return {
      status: "error",
      message: "Managers and employees need a location assignment.",
    };
  }

  if (parsed.data.locationId) {
    const location = workspace.locations.find(
      (candidate) => candidate.id === parsed.data.locationId,
    );
    if (!location || location.organizationId !== organizationId) {
      return {
        status: "error",
        message: "Choose an active location in this organization.",
      };
    }
  }

  if (parsed.data.organizationId !== organizationId) {
    return {
      status: "error",
      message: "The invitation organization does not match your active workspace.",
    };
  }

  const tracking = createInvitationTracking();
  const requestId = crypto.randomUUID();
  const { data: begun, error: beginError } = await supabase.rpc(
    "begin_user_invitation_request",
    {
      p_request_id: requestId,
      p_organization_id: organizationId,
      p_email: normalizedEmail,
      p_display_name: parsed.data.fullName,
      p_role: parsed.data.role,
      p_location_ids: locationIds,
      p_employee_id: tracking.employeeId,
      p_expires_at: tracking.expiresAt,
    } as never,
  );
  if (beginError) {
    return {
      status: "error",
      message:
        beginError.code === "23505"
          ? "This person already has access or a pending invitation."
          : "The invitation request could not be opened safely. Verify MFA and try again.",
    };
  }

  const admin = createAdminClient();
  const saga = begun as {
    requestId?: string;
    state?: string;
    authUserId?: string | null;
  } | null;
  const sagaRequestId = saga?.requestId ?? requestId;
  const callback = invitationCallbackUrl(
    publicEnv.NEXT_PUBLIC_APP_URL,
    organizationId,
  );
  const linkResult = saga?.authUserId
    ? await admin.auth.admin.generateLink({
        type: "recovery",
        email: normalizedEmail,
        options: { redirectTo: callback },
      })
    : await admin.auth.admin.generateLink({
        type: "invite",
        email: normalizedEmail,
        options: {
          redirectTo: callback,
          data: {
            invitation_request_id: sagaRequestId,
            display_name: parsed.data.fullName,
          },
        },
      });
  const authUserId = saga?.authUserId ?? linkResult.data?.user?.id ?? null;
  const actionUrl = linkResult.data?.properties?.action_link ?? null;
  if (linkResult.error || !authUserId || !actionUrl) {
    await admin.rpc("service_reconcile_user_invitation_auth", {
      p_request_id: sagaRequestId,
      p_auth_user_id: authUserId,
      p_error_code: "auth_link_uncertain",
    } as never);
    return {
      status: "error",
      message:
        "The invitation is saved but Auth link creation is unresolved. It was not reported as sent.",
    };
  }

  const { error: metadataError } = await admin.auth.admin.updateUserById(
    authUserId,
    {
      app_metadata: {
        ...(linkResult.data.user?.app_metadata ?? {}),
        pending_organization_id: organizationId,
        pending_role: parsed.data.role,
        invited_by: userId,
        invitation_request_id: sagaRequestId,
      },
    },
  );

  if (metadataError) {
    await admin.rpc("service_reconcile_user_invitation_auth", {
      p_request_id: sagaRequestId,
      p_auth_user_id: authUserId,
      p_error_code: "auth_metadata_failed",
    } as never);
    return {
      status: "error",
      message:
        "The Auth account exists but secure invitation scope needs reconciliation. No invitation was reported as sent.",
    };
  }

  const reconciled = await admin.rpc("service_reconcile_user_invitation_auth", {
    p_request_id: sagaRequestId,
    p_auth_user_id: authUserId,
    p_error_code: null,
  } as never);
  const provisioned = reconciled.error
    ? reconciled
    : await admin.rpc("service_provision_user_invitation_request", {
        p_request_id: sagaRequestId,
      } as never);

  if (provisioned.error) {
    return {
      status: "error",
      message:
        "The Auth account exists, but tenant provisioning needs reconciliation. No invitation was reported as sent.",
    };
  }

  const queued = await admin.rpc("service_queue_user_invitation_delivery", {
    p_request_id: sagaRequestId,
    p_action_url: actionUrl,
  } as never);
  if (queued.error) {
    return {
      status: "error",
      message:
        "Tenant access is staged, but delivery could not be queued. The invitation was not reported as sent.",
    };
  }

  const deliverySecret = process.env.IDENTITY_DELIVERY_SECRET?.trim();
  if (deliverySecret && deliverySecret.length >= 32) {
    const workerUrl = new URL(
      "/api/internal/identity-delivery",
      publicEnv.NEXT_PUBLIC_APP_URL,
    );
    after(async () => {
      try {
        await fetch(workerUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${deliverySecret}` },
          cache: "no-store",
          signal: AbortSignal.timeout(25_000),
        });
      } catch {
        // Durable queued work remains available to the scheduled worker.
      }
    });
  }

  return {
    status: "success",
    message: `Invitation prepared for ${normalizedEmail}. Delivery is queued and will be confirmed separately.`,
  };
}
