import "server-only";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { appSurface } from "@/lib/app-surface";
import { createClient } from "@/lib/supabase/server";

export function canReadChurchLoyalty(workspace: WorkspaceContextValue) {
  return appSurface === "operations" && workspace.mode === "live"
    && workspace.serviceSettings?.serviceModel === "counter"
    && (workspace.role === "owner" || workspace.role === "admin");
}

export async function verifyChurchLoyaltyScope(workspace: WorkspaceContextValue) {
  if (!canReadChurchLoyalty(workspace)) return false;
  const client = await createClient();
  // These reads use the actor's session and RLS, never an admin credential.
  const [organization, location] = await Promise.all([
    client.from("organizations").select("id").eq("id", workspace.organization.id)
      .eq("slug", "le-yard-church-street").eq("status", "active").maybeSingle(),
    client.from("locations").select("id").eq("id", workspace.activeLocation.id)
      .eq("organization_id", workspace.organization.id).eq("code", "CHURCH").eq("is_active", true).maybeSingle(),
  ]);
  if (organization.error || location.error) throw new Error("Loyalty workspace could not be verified.");
  return Boolean(organization.data && location.data);
}
