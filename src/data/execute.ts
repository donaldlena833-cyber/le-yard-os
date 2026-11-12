import "server-only";

import type { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isTenantFeatureEnabled, type TenantFeature } from "@/lib/tenant-service";
import { requireAuthenticatedActor } from "./actor";
import { WorkflowError } from "./errors";
import { demoResult, errorResult, liveResult, validationResult } from "./results";
import type {
  AuthenticatedActor,
  UserScopedSupabaseClient,
  WorkflowActionResult,
} from "./types";

export interface WorkflowContext {
  supabase: UserScopedSupabaseClient;
  actor: AuthenticatedActor;
}

export async function executeWorkflowAction<TInput, TOutput>(options: {
  operation: string;
  requiredTenantFeature?: TenantFeature;
  schema: z.ZodType<TInput>;
  input: unknown;
  persists?: boolean;
  run: (context: WorkflowContext, input: TInput) => Promise<TOutput>;
}): Promise<WorkflowActionResult<TOutput>> {
  const parsed = options.schema.safeParse(options.input);
  if (!parsed.success) return validationResult(parsed.error);

  if (isDemoMode) return demoResult(options.operation);

  try {
    if (options.requiredTenantFeature) {
      const session = await resolveWorkspaceSession();
      if (session.status === "unauthenticated") {
        throw new WorkflowError("unauthenticated", "Sign in to continue.");
      }
      if (session.status !== "ready" || !isTenantFeatureEnabled(session.context, options.requiredTenantFeature)) {
        throw new WorkflowError("forbidden", "This workflow is unavailable in the active workspace.");
      }
      const input = parsed.data;
      if (input && typeof input === "object" && "organizationId" in input &&
        input.organizationId !== session.context.organization.id) {
        throw new WorkflowError("forbidden", "Switch to the workspace that owns this record.");
      }
    }
    const supabase = await createClient();
    const actor = await requireAuthenticatedActor(supabase);
    return liveResult(
      await options.run({ supabase, actor }, parsed.data),
      options.persists ?? true,
    );
  } catch (error) {
    return errorResult(error);
  }
}
