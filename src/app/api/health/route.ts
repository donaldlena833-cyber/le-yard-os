import { NextResponse } from "next/server";
import { getServerRuntimeConfiguration } from "@/lib/env.server";
import { buildHealthState } from "@/lib/security/health";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  matchesRuntimeSchemaContract,
  type RuntimeSchemaContract,
} from "@/lib/security/schema-contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SchemaContractPayload = Partial<RuntimeSchemaContract>;

async function schemaContractIsHealthy() {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("schema contract timeout")), 2_000);
  });

  try {
    const request = createAdminClient().rpc("service_runtime_schema_contract");
    const result = await Promise.race([request, timeout]);
    if (result.error || !result.data || typeof result.data !== "object") {
      return false;
    }
    return matchesRuntimeSchemaContract(result.data as SchemaContractPayload);
  } catch {
    return false;
  }
}

export async function GET() {
  const runtime = getServerRuntimeConfiguration();
  const ready =
    runtime.ready &&
    (runtime.mode === "demo" ? runtime.playground : await schemaContractIsHealthy());
  const health = buildHealthState(ready, new Date().toISOString());

  return NextResponse.json(health.body, {
    status: health.statusCode,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
