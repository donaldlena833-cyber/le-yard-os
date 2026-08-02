"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { findWorkspaceChoice } from "@/lib/auth/workspace-context";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { writeWorkspacePreference } from "@/lib/auth/workspace-preference.server";

export type WorkspaceSelectionResult =
  | { ok: true }
  | { ok: false; message: string };

const workspaceSelectionSchema = z
  .object({
    organizationId: z.string().min(1).max(128),
    locationId: z.string().min(1).max(128),
  })
  .strict();

/**
 * Treats the browser's IDs as selectors only. Current authenticated database
 * scope is resolved again before the HTTP-only preference is written.
 */
export async function setWorkspaceSelectionAction(
  input: unknown,
): Promise<WorkspaceSelectionResult> {
  const parsed = workspaceSelectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose an available workspace." };
  }

  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") {
    return { ok: false, message: "Workspace access could not be verified." };
  }

  const selection = findWorkspaceChoice(
    resolution.context.availableWorkspaces,
    parsed.data.organizationId,
    parsed.data.locationId,
  );
  if (!selection) {
    return { ok: false, message: "That workspace is no longer available." };
  }

  await writeWorkspacePreference({
    userId: resolution.context.identity.userId,
    organizationId: selection.choice.organization.id,
    locationId: selection.location.id,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
