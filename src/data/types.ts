import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.generated";

export type UserScopedSupabaseClient = SupabaseClient<Database>;

export type ActorRole = "owner" | "admin" | "manager" | "employee";
export type ActorAal = "aal1" | "aal2";

export interface ActorMembership {
  organizationId: string;
  role: ActorRole;
  locationIds: readonly string[];
  organizationWide: boolean;
}

export interface AuthenticatedActor {
  userId: string;
  aal: ActorAal;
  memberships: readonly ActorMembership[];
}

export type WorkflowErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "database";

export type WorkflowActionResult<T> =
  | {
      ok: true;
      persisted: boolean;
      mode: "live";
      data: T;
    }
  | {
      ok: true;
      persisted: false;
      mode: "demo";
      operation: string;
      message: string;
    }
  | {
      ok: false;
      persisted: false;
      code: WorkflowErrorCode;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };
