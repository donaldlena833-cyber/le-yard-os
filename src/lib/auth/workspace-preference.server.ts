import "server-only";

import { cookies } from "next/headers";
import {
  decodeWorkspacePreference,
  encodeWorkspacePreference,
  WORKSPACE_PREFERENCE_COOKIE,
} from "@/lib/auth/workspace-preference";
import type { WorkspacePreference } from "@/lib/auth/workspace-context";

export async function readWorkspacePreference(
  authenticatedUserId: string,
): Promise<WorkspacePreference | null> {
  const cookieStore = await cookies();
  const preference = decodeWorkspacePreference(
    cookieStore.get(WORKSPACE_PREFERENCE_COOKIE)?.value,
  );
  return preference?.userId === authenticatedUserId ? preference : null;
}

export async function writeWorkspacePreference(
  preference: WorkspacePreference,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    WORKSPACE_PREFERENCE_COOKIE,
    encodeWorkspacePreference(preference),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
      priority: "medium",
    },
  );
}
