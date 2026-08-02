import "server-only";

import type { z } from "zod";
import { isDemoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedActor } from "./actor";
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
  schema: z.ZodType<TInput>;
  input: unknown;
  persists?: boolean;
  run: (context: WorkflowContext, input: TInput) => Promise<TOutput>;
}): Promise<WorkflowActionResult<TOutput>> {
  const parsed = options.schema.safeParse(options.input);
  if (!parsed.success) return validationResult(parsed.error);

  if (isDemoMode) return demoResult(options.operation);

  try {
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
