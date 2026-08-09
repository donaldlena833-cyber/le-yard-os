"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
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
  PLAYGROUND_SESSION_COOKIE,
  PLAYGROUND_SESSION_TTL_SECONDS,
  authenticatePlaygroundUser,
  issuePlaygroundSessionToken,
} from "@/lib/auth/playground-auth.server";
import { PlaygroundLoginRateLimiter } from "@/lib/auth/playground-login-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = {
  status: "idle" | "error" | "success";
  message?: string;
};

const signInSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
  next: z.string().optional(),
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
  });

  if (!parsed.success) {
    return { status: "error", message: "Enter a valid username or email and password." };
  }

  const runtime = getServerRuntimeConfiguration();
  if (runtime.mode === "demo" && runtime.playground) {
    if (!playgroundPasswordCandidateSchema.safeParse(parsed.data.password).success) {
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
    const token = principal ? issuePlaygroundSessionToken(principal) : null;
    if (!principal || !token) {
      return { status: "error", message: "The username or password did not match." };
    }

    const cookieStore = await cookies();
    cookieStore.set(PLAYGROUND_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: PLAYGROUND_SESSION_TTL_SECONDS,
      priority: "high",
    });
    redirect(safeInternalRedirect(parsed.data.next));
  }

  if (isDemoMode && runtime.ready) {
    redirect(safeInternalRedirect(parsed.data.next));
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
    return { status: "error", message: "Enter a valid username or email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password: parsed.data.password,
  });

  if (error) {
    return { status: "error", message: "The username or password did not match." };
  }

  redirect(safeInternalRedirect(parsed.data.next));
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
      if (isSupabaseAuthCookieName(cookie.name)) cookieStore.delete(cookie.name);
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
    return { status: "error", message: "This invitation is missing its organization scope." };
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

  const { error: activationError } = await supabase.rpc("accept_my_invitation", {
    p_organization_id: parsedOrganizationId.data,
  });
  if (activationError) {
    return {
      status: "error",
      message: "Your password was saved, but tenant access could not be activated. Ask an owner to review the invitation.",
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
    return { status: "error", message: "Review the invite details and try again." };
  }

  if (isDemoMode) {
    return {
      status: "success",
      message: `Demo invitation prepared for ${parsed.data.email}.`,
    };
  }

  const workspaceResolution = await resolveWorkspaceSession();
  if (workspaceResolution.status !== "ready" || workspaceResolution.context.mode !== "live") {
    return { status: "error", message: "Your active organization could not be verified." };
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
  if (["manager", "employee"].includes(parsed.data.role) && locationIds.length === 0) {
    return { status: "error", message: "Managers and employees need a location assignment." };
  }

  if (parsed.data.locationId) {
    const location = workspace.locations.find(
      (candidate) => candidate.id === parsed.data.locationId,
    );
    if (!location || location.organizationId !== organizationId) {
      return { status: "error", message: "Choose an active location in this organization." };
    }
  }

  const [{ data: pendingInvitation }, { data: existingEmployee }] = await Promise.all([
    supabase
      .from("user_invitations")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("email", normalizedEmail)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .maybeSingle(),
    supabase
      .from("employees")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("email", normalizedEmail)
      .maybeSingle(),
  ]);
  if (pendingInvitation || existingEmployee) {
    return { status: "error", message: "This person already has access or a pending invitation." };
  }

  const tracking = createInvitationTracking();

  const admin = createAdminClient();
  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
    data: {
      display_name: parsed.data.fullName,
      requested_role: parsed.data.role,
      organization_id: organizationId,
      location_ids: locationIds,
      invited_by: userId,
    },
    redirectTo: invitationCallbackUrl(publicEnv.NEXT_PUBLIC_APP_URL, organizationId),
  });

  if (error || !invited.user) {
    return { status: "error", message: "The invitation could not be sent. Check the email or existing access." };
  }

  const { error: metadataError } = await admin.auth.admin.updateUserById(invited.user.id, {
    app_metadata: {
      ...invited.user.app_metadata,
      pending_organization_id: organizationId,
      pending_role: parsed.data.role,
      invited_by: userId,
    },
  });

  if (metadataError) {
    await admin.auth.admin.deleteUser(invited.user.id);
    return { status: "error", message: "The invitation could not be securely scoped. No account was provisioned." };
  }

  const { error: provisioningError } = await supabase.rpc("provision_user_invitation", {
    p_auth_user_id: invited.user.id,
    p_organization_id: organizationId,
    p_email: normalizedEmail,
    p_display_name: parsed.data.fullName,
    p_role: parsed.data.role,
    p_location_ids: locationIds,
    p_token_hash: tracking.tokenHash,
    p_expires_at: tracking.expiresAt,
    p_employee_id: tracking.employeeId,
  });

  if (provisioningError) {
    await admin.auth.admin.deleteUser(invited.user.id);
    await admin.from("user_invitations").delete().eq("organization_id", organizationId).eq("token_hash", tracking.tokenHash);
    await admin.from("employees").delete().eq("organization_id", organizationId).eq("id", tracking.employeeId).eq("employment_status", "invited");
    return { status: "error", message: "The invitation could not be provisioned atomically. No access was granted." };
  }

  return {
    status: "success",
    message: `Invitation sent to ${normalizedEmail}.`,
  };
}
