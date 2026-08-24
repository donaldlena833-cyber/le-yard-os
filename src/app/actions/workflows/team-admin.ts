"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { createClient } from "@/lib/supabase/server";

export type TeamAdminActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

const inputSchema = z.object({
  intent: z.enum(["update_access", "suspend", "reactivate"]),
  membershipId: z.string().uuid(),
  role: z.enum(["owner", "admin", "manager", "employee"]).optional(),
  locationIds: z.array(z.string().uuid()).max(100),
  primaryLocationId: z.string().uuid().optional(),
});

export async function administerTeamMemberAction(
  _previousState: TeamAdminActionState,
  formData: FormData,
): Promise<TeamAdminActionState> {
  const parsed = inputSchema.safeParse({
    intent: formData.get("intent"),
    membershipId: formData.get("membershipId"),
    role: formData.get("role") || undefined,
    locationIds: formData.getAll("locationIds"),
    primaryLocationId: formData.get("primaryLocationId") || undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: "Review the access details and try again." };
  }

  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") {
    return { status: "error", message: "Your active organization could not be verified." };
  }
  const workspace = resolution.context;
  if (workspace.role !== "owner" && workspace.role !== "admin") {
    return { status: "error", message: "Only owners and admins can manage account access." };
  }
  const supabase = await createClient();
  const { data: target, error: targetError } = await supabase
    .from("organization_memberships")
    .select("id, organization_id, user_id, role, status")
    .eq("id", parsed.data.membershipId)
    .eq("organization_id", workspace.organization.id)
    .maybeSingle();
  if (targetError || !target) {
    return { status: "error", message: "That team membership is no longer available." };
  }

  const { data: currentLocations, error: locationError } = await supabase
    .from("location_memberships")
    .select("location_id, is_primary")
    .eq("organization_id", workspace.organization.id)
    .eq("user_id", target.user_id);
  if (locationError) {
    return { status: "error", message: "The current location scope could not be verified." };
  }

  const requestedLocations =
    parsed.data.intent === "update_access"
      ? [...new Set(parsed.data.locationIds)]
      : (currentLocations ?? []).map((location) => location.location_id);
  const primaryLocationId = parsed.data.intent === "update_access"
    ? parsed.data.primaryLocationId ?? null
    : (currentLocations ?? []).find((location) => location.is_primary)?.location_id ?? null;
  const role = parsed.data.intent === "update_access" && parsed.data.role
    ? parsed.data.role
    : target.role;
  const status = parsed.data.intent === "suspend"
    ? "suspended"
    : parsed.data.intent === "reactivate"
      ? "active"
      : target.status;

  if (["manager", "employee"].includes(role) && requestedLocations.length === 0) {
    return { status: "error", message: "Managers and employees need at least one location." };
  }
  if (requestedLocations.length > 0 && !primaryLocationId) {
    return { status: "error", message: "Choose one selected location as the primary location." };
  }
  if (primaryLocationId && !requestedLocations.includes(primaryLocationId)) {
    return { status: "error", message: "The primary location must also be selected for access." };
  }
  if (requestedLocations.some((id) => !workspace.locations.some((location) => location.id === id))) {
    return { status: "error", message: "Choose only active locations in this organization." };
  }

  const { error } = await supabase.rpc("administer_organization_member", {
    p_request_id: crypto.randomUUID(),
    p_membership_id: target.id,
    p_role: role,
    p_status: status,
    p_location_ids: requestedLocations,
    p_primary_location_id: primaryLocationId,
  });
  if (error) {
    return {
      status: "error",
      message:
        error.code === "42501"
          ? "This change is not permitted. Owner accounts and the final active owner are protected."
          : "Account access could not be updated. Try again.",
    };
  }

  revalidatePath("/team");
  revalidatePath("/today");
  return {
    status: "success",
    message:
      parsed.data.intent === "suspend"
        ? "Account access suspended."
        : parsed.data.intent === "reactivate"
          ? "Account access restored."
          : "Role and location access updated.",
  };
}
