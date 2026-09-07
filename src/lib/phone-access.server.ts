import "server-only";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { resolveLeYardTenant } from "@/lib/communications.server";

export async function requirePhoneAccess() {
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") throw new Response("Sign in to use the phone.", { status: 401 });
  const w = session.context;
  if (w.mode !== "live" || !["owner", "admin"].includes(w.role))
    throw new Response("Phone access requires an owner or admin account.", { status: 403 });
  const tenant = await resolveLeYardTenant();
  if (tenant.organizationId !== w.organization.id || tenant.locationId !== w.activeLocation.id)
    throw new Response("Phone is not available for this workspace.", { status: 403 });
  return w;
}
