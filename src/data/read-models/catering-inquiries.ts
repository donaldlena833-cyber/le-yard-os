import "server-only";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import { cateringPageSize, decodeCateringRegisterRows, type CateringRegisterQuery, type CateringRegisterResult } from "@/lib/catering-register";

export async function loadCateringRegister(workspace: WorkspaceContextValue, query: CateringRegisterQuery): Promise<CateringRegisterResult> {
  if (workspace.role !== "owner" || workspace.mode !== "live") return { ok: false, message: "Owner access is required to read catering inquiries." };
  try {
    // Session-bound public client: RLS remains authoritative, including revoked membership.
    const supabase = await createClient();
    let request = supabase.from("catering_inquiries")
      .select("id, created_at, payload, status, notification_status")
      .eq("organization_id", workspace.organization.id)
      .eq("location_id", workspace.activeLocation.id);
    if (query.audience !== "all") request = request.eq("payload->>audience", query.audience);
    const offset = (query.page - 1) * cateringPageSize;
    const result = await request.order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + cateringPageSize);
    if (result.error) return { ok: false, message: "Catering inquiries could not be loaded. Try again." };
    return decodeCateringRegisterRows(result.data);
  } catch {
    return { ok: false, message: "Catering inquiries could not be loaded. Try again." };
  }
}
