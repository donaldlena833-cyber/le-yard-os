import type { Metadata } from "next";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";
import { PhoneWorkspace } from "@/components/phone/phone-workspace";
export const metadata:Metadata={title:"Phone"};
export default async function PhonePage() {
  const session=await resolveWorkspaceSession();if(session.status!=="ready") return null;
  requireWorkspaceRouteAccess("/phone",session.context);
  return <PhoneWorkspace live={session.context.mode==="live"} defaultStaff={session.context.identity.email===process.env.OWNER_2_EMAIL?"maris":"donald"}/>;
}
