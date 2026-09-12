import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { resolveLeYardTenant } from "@/lib/communications.server";
import { createAdminClient } from "@/lib/supabase/admin";

export type CommunicationMessageLink =
  | { status: "ready"; phone: string; group: "clients" | "team" }
  | { status: "unavailable"; message: string };

const unavailable: CommunicationMessageLink = {
  status: "unavailable",
  message:
    "This conversation link is unavailable in the current workspace. Check the workspace and try the link again, or choose a group below to find the conversation.",
};

// The caller supplies the context resolved from the authenticated server session.
// The SID locates a saved message; it never grants access to the conversation.
export async function resolveCommunicationMessageLink(
  workspace: WorkspaceContextValue,
  sid: unknown,
): Promise<CommunicationMessageLink> {
  if (
    workspace.mode !== "live" ||
    !["owner", "admin"].includes(workspace.role)
  ) {
    return {
      status: "unavailable",
      message:
        "Sign in to the live workspace with a Le Yard owner or admin account to open this conversation link.",
    };
  }
  if (typeof sid !== "string" || !/^(SM|MM)[a-f0-9]{32}$/i.test(sid)) {
    return {
      status: "unavailable",
      message:
        "This conversation link is invalid. Open the complete link from your Le Yard message alert, or choose a group below.",
    };
  }

  try {
    const tenant = await resolveLeYardTenant();
    if (
      tenant.organizationId !== workspace.organization.id ||
      tenant.locationId !== workspace.activeLocation.id
    ) {
      return unavailable;
    }
    const result = await createAdminClient()
      .from("communication_messages")
      .select("phone,audience")
      .eq("organization_id", workspace.organization.id)
      .eq("location_id", workspace.activeLocation.id)
      .eq("sid", sid)
      .maybeSingle();

    if (
      result.error ||
      !result.data ||
      !/^\+[1-9]\d{7,14}$/.test(result.data.phone ?? "") ||
      !["client", "team"].includes(result.data.audience)
    ) {
      return unavailable;
    }
    return {
      status: "ready",
      phone: result.data.phone!,
      group: result.data.audience === "team" ? "team" : "clients",
    };
  } catch {
    return unavailable;
  }
}
